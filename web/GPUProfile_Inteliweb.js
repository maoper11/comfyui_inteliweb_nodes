import { app } from "../../scripts/app.js";

const SELECTOR = "InteliwebGPUProfileSelector";
const ROUTER = "InteliwebModelProfileRouter";
const SET_NODE = "SetInteliweb";
const GET_NODE = "GetInteliweb";

const ACTIVE = 0;
const MUTE = 2;
const PROFILES = new Set(["LOW", "MEDIUM", "HIGH", "ULTRA"]);
const PROFILE_INPUTS = ["model", "text_encoder", "vae"];
const PROFILE_PREFIXES = ["low", "medium", "high", "ultra"];

function graphNodes(graph) {
  return graph?._nodes || graph?.nodes || [];
}

function rootGraph(graph) {
  return graph?.rootGraph || graph || null;
}

function allGraphs(graph) {
  const root = rootGraph(graph);
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    for (const node of graphNodes(current)) {
      const child = node?.subgraph || node?._graph;
      if (child && child !== current) queue.push(child);
    }
    const children = current?._subgraphs || current?.subgraphs;
    if (children?.values) for (const child of children.values()) queue.push(child);
  }
  return result;
}

function allNodes(graph) {
  return allGraphs(graph).flatMap((candidate) => graphNodes(candidate));
}

function isClass(node, name) {
  return node?.comfyClass === name || node?.type === name;
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name) || null;
}

function value(node, name, fallback = "") {
  const current = widget(node, name)?.value;
  return current == null || current === "" ? fallback : String(current);
}

function setValue(node, name, next, notify = false) {
  const target = widget(node, name);
  if (!target) return;
  target.value = next;
  if (notify && typeof target.callback === "function") target.callback(next, node, target);
  node.setDirtyCanvas?.(true, true);
}

function normalizeProfile(profile, fallback = "HIGH") {
  const normalized = String(profile || "").toUpperCase();
  return PROFILES.has(normalized) ? normalized : fallback;
}

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  if (typeof graph.getLink === "function") return graph.getLink(linkId) || null;
  if (graph.links instanceof Map) return graph.links.get(linkId) || null;
  return graph.links?.[linkId] || graph._links?.get?.(linkId) || graph._links?.[linkId] || null;
}

function sourceNodeForInput(node, inputName) {
  const input = node?.inputs?.find((slot) => slot?.name === inputName);
  if (!input || input.link == null || !node.graph) return null;
  const link = getLink(node.graph, input.link);
  if (!link) return null;
  return node.graph.getNodeById?.(link.origin_id) || null;
}

function variableName(node) {
  const target = node?.widgets?.find((item) => item?.name === "name" || item?.name === "Constant");
  return String(target?.value ?? node?.properties?.inteliwebVariableName ?? "").trim();
}

function profileFromSource(node, seen = new Set()) {
  if (!node || seen.has(node)) return null;
  seen.add(node);

  if (isClass(node, SELECTOR)) return normalizeProfile(value(node, "profile", "HIGH"));

  if (isClass(node, GET_NODE)) {
    const name = variableName(node);
    if (!name) return null;
    const root = rootGraph(node.graph);
    const setter = allNodes(root).find((candidate) => isClass(candidate, SET_NODE) && variableName(candidate) === name);
    return profileFromSource(setter, seen);
  }

  if (isClass(node, SET_NODE)) {
    const input = node.inputs?.find((slot) => slot?.link != null);
    if (!input || !node.graph) return null;
    const link = getLink(node.graph, input.link);
    const source = link ? node.graph.getNodeById?.(link.origin_id) : null;
    return profileFromSource(source, seen);
  }

  return null;
}

function nextChannel(base, used) {
  const normalized = String(base || "gpu_profile").trim() || "gpu_profile";
  if (!used.has(normalized)) return normalized;
  let index = 1;
  while (used.has(`${normalized}_${index}`)) index += 1;
  return `${normalized}_${index}`;
}

function ensureUniqueGlobalChannels(graph) {
  const used = new Set();
  for (const node of allNodes(graph).filter((candidate) => isClass(candidate, SELECTOR))) {
    if (value(node, "scope", "GLOBAL") !== "GLOBAL") continue;
    const requested = String(value(node, "global_channel", "gpu_profile")).trim() || "gpu_profile";
    const assigned = nextChannel(requested, used);
    if (assigned !== requested) setValue(node, "global_channel", assigned, false);
    used.add(assigned);
  }
}

function globalProfile(graph, channel) {
  const owner = allNodes(graph).find(
    (node) =>
      isClass(node, SELECTOR) &&
      value(node, "scope", "GLOBAL") === "GLOBAL" &&
      value(node, "global_channel", "gpu_profile") === channel,
  );
  return owner ? normalizeProfile(value(owner, "profile", "HIGH")) : null;
}

function effectiveProfile(router) {
  const externalSource = sourceNodeForInput(router, "profile_in");
  if (externalSource) {
    const external = profileFromSource(externalSource);
    if (external) return { profile: external, source: "INPUT" };
    // Unknown runtime source: do not guess and do not auto-mute this router.
    return { profile: null, source: "INPUT" };
  }

  const selected = String(value(router, "profile", "GLOBAL")).toUpperCase();
  if (selected !== "GLOBAL") return { profile: normalizeProfile(selected), source: "LOCAL" };

  const channel = value(router, "global_channel", "gpu_profile");
  const global = globalProfile(router.graph, channel);
  if (global) {
    setValue(router, "global_profile", global, false);
    return { profile: global, source: "GLOBAL" };
  }
  return { profile: normalizeProfile(value(router, "global_profile", "HIGH")), source: "GLOBAL" };
}

function setNodeMode(node, mode) {
  if (!node || node.mode === mode) return;
  if (typeof node.changeMode === "function") node.changeMode(mode);
  else node.mode = mode;
  node.setDirtyCanvas?.(true, true);
}

function syncRouters(graph) {
  const routers = allNodes(graph).filter((node) => isClass(node, ROUTER));
  const activeNodes = new Set();
  const inactiveNodes = new Set();

  for (const router of routers) {
    const effective = effectiveProfile(router);
    router.properties ||= {};
    router.properties.inteliwebEffectiveProfile = effective.profile || "?";
    router.properties.inteliwebProfileSource = effective.source;

    if (!effective.profile) continue;
    const activePrefix = effective.profile.toLowerCase();

    for (const prefix of PROFILE_PREFIXES) {
      for (const suffix of PROFILE_INPUTS) {
        const producer = sourceNodeForInput(router, `${prefix}_${suffix}`);
        if (!producer) continue;
        if (prefix === activePrefix) activeNodes.add(producer);
        else inactiveNodes.add(producer);
      }
    }
    router.setDirtyCanvas?.(true, true);
  }

  // A loader used by any active profile must never be muted by another inactive
  // connection. This is intentionally resolved across every router in the graph.
  for (const node of inactiveNodes) if (!activeNodes.has(node)) setNodeMode(node, MUTE);
  for (const node of activeNodes) setNodeMode(node, ACTIVE);
}

function hideWidget(target, hidden) {
  if (!target) return;
  if (!target.__inteliwebOriginalComputeSize) {
    target.__inteliwebOriginalComputeSize = target.computeSize;
    target.__inteliwebOriginalType = target.type;
  }
  target.hidden = hidden;
  if (hidden) {
    target.computeSize = () => [0, -4];
    target.type = "hidden";
  } else {
    target.computeSize = target.__inteliwebOriginalComputeSize;
    target.type = target.__inteliwebOriginalType;
  }
}

function installAdvanced(node, { alwaysHidden = [] } = {}) {
  if (node.__inteliwebAdvancedInstalled) return;
  node.__inteliwebAdvancedInstalled = true;
  node.properties ||= {};
  node.properties.inteliwebAdvancedOpen ??= false;

  for (const name of alwaysHidden) hideWidget(widget(node, name), true);
  hideWidget(widget(node, "global_channel"), !node.properties.inteliwebAdvancedOpen);

  node.addWidget("button", node.properties.inteliwebAdvancedOpen ? "Advanced ▾" : "Advanced ▸", null, () => {
    node.properties.inteliwebAdvancedOpen = !node.properties.inteliwebAdvancedOpen;
    const opened = node.properties.inteliwebAdvancedOpen;
    hideWidget(widget(node, "global_channel"), !opened);
    const button = node.widgets?.find((item) => item?.name === "Advanced ▸" || item?.name === "Advanced ▾");
    if (button) button.name = opened ? "Advanced ▾" : "Advanced ▸";
    node.setSize?.(node.computeSize?.() || node.size);
    node.setDirtyCanvas?.(true, true);
  });
}

function wrapWidgetCallback(node, name, callback) {
  const target = widget(node, name);
  if (!target || target.__inteliwebWrapped) return;
  target.__inteliwebWrapped = true;
  const original = target.callback;
  target.callback = function (...args) {
    const result = original?.apply(this, args);
    callback();
    return result;
  };
}

function setupSelector(node) {
  installAdvanced(node);
  const refresh = () => {
    ensureUniqueGlobalChannels(node.graph);
    syncRouters(node.graph);
  };
  wrapWidgetCallback(node, "scope", refresh);
  wrapWidgetCallback(node, "profile", refresh);
  wrapWidgetCallback(node, "global_channel", refresh);
}

function setupRouter(node) {
  installAdvanced(node, { alwaysHidden: ["global_profile"] });
  const refresh = () => syncRouters(node.graph);
  wrapWidgetCallback(node, "profile", refresh);
  wrapWidgetCallback(node, "global_channel", refresh);
}

app.registerExtension({
  name: "inteliweb.gpu.profile",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (![SELECTOR, ROUTER].includes(nodeData?.name)) return;

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalConfigure?.apply(this, args);
      queueMicrotask(() => {
        if (isClass(this, SELECTOR)) setupSelector(this);
        if (isClass(this, ROUTER)) setupRouter(this);
        ensureUniqueGlobalChannels(this.graph);
        syncRouters(this.graph);
      });
      return result;
    };

    if (nodeData?.name === ROUTER) {
      const originalConnectionsChange = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function (...args) {
        const result = originalConnectionsChange?.apply(this, args);
        queueMicrotask(() => syncRouters(this.graph));
        return result;
      };

      const originalDrawForeground = nodeType.prototype.onDrawForeground;
      nodeType.prototype.onDrawForeground = function (ctx, ...args) {
        originalDrawForeground?.call(this, ctx, ...args);
        if (this.flags?.collapsed) return;
        const profile = this.properties?.inteliwebEffectiveProfile;
        const source = this.properties?.inteliwebProfileSource;
        if (!profile || !source) return;
        ctx.save();
        ctx.font = "11px sans-serif";
        ctx.globalAlpha = 0.75;
        ctx.textAlign = "right";
        ctx.fillStyle = "#ddd";
        ctx.fillText(`${profile} • ${source}`, this.size[0] - 8, -7);
        ctx.restore();
      };
    }
  },

  nodeCreated(node) {
    if (isClass(node, SELECTOR)) setupSelector(node);
    if (isClass(node, ROUTER)) setupRouter(node);
    if (isClass(node, SELECTOR) || isClass(node, ROUTER)) {
      queueMicrotask(() => {
        ensureUniqueGlobalChannels(node.graph);
        syncRouters(node.graph);
      });
    }
  },

  afterConfigureGraph() {
    ensureUniqueGlobalChannels(app.graph);
    syncRouters(app.graph);
  },
});
