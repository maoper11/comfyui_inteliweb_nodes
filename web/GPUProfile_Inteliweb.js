import { app } from "../../scripts/app.js";

const SELECTOR = "InteliwebGPUProfileSelector";
const ROUTER = "InteliwebModelProfileRouter";
const SET_NODE = "SetInteliweb";
const GET_NODE = "GetInteliweb";

const ACTIVE = 0;
const MUTE = 2;
const NO_GLOBAL_CHANNEL = "none";
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
  if (!target || target.value === next) return;
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

function availableGlobalChannels(graph) {
  const channels = [];
  const seen = new Set();
  for (const node of allNodes(graph).filter((candidate) => isClass(candidate, SELECTOR))) {
    if (value(node, "scope", "GLOBAL") !== "GLOBAL") continue;
    const channel = String(value(node, "global_channel", "gpu_profile")).trim();
    if (!channel || seen.has(channel)) continue;
    seen.add(channel);
    channels.push(channel);
  }
  return channels;
}

function setComboValues(target, values) {
  if (!target) return;
  target.options ||= {};
  target.options.values = values;
}

function syncRouterChannelChoices(graph) {
  const channels = availableGlobalChannels(graph);
  const channelSet = new Set(channels);
  const options = [NO_GLOBAL_CHANNEL, ...channels];

  for (const router of allNodes(graph).filter((node) => isClass(node, ROUTER))) {
    const target = widget(router, "global_channel");
    if (!target) continue;

    setComboValues(target, options);

    const current = String(target.value ?? NO_GLOBAL_CHANNEL).trim() || NO_GLOBAL_CHANNEL;
    const selected = String(value(router, "profile", "HIGH")).toUpperCase();
    const hasProfileInput = Boolean(sourceNodeForInput(router, "profile_in"));
    const channelIsValid = current === NO_GLOBAL_CHANNEL || channelSet.has(current);

    // Never migrate a router silently to another global channel. If the channel it
    // listened to disappears, fall back to the explicit safe state HIGH • LOCAL.
    if (!channelIsValid) {
      setValue(router, "global_channel", NO_GLOBAL_CHANNEL, false);
      if (!hasProfileInput && selected === "GLOBAL") {
        setValue(router, "profile", "HIGH", false);
      }
      continue;
    }

    // GLOBAL without an actual channel is contradictory. Keep the UI and execution
    // state aligned by turning it into HIGH • LOCAL. PROFILE IN remains authoritative
    // when connected, so we do not rewrite the local selector in that case.
    if (!hasProfileInput && selected === "GLOBAL" && current === NO_GLOBAL_CHANNEL) {
      setValue(router, "profile", "HIGH", false);
    }
  }
}

function globalProfile(graph, channel) {
  if (!channel || channel === NO_GLOBAL_CHANNEL) return null;
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
    return { profile: null, source: "INPUT" };
  }

  const selected = String(value(router, "profile", "HIGH")).toUpperCase();
  if (selected !== "GLOBAL") return { profile: normalizeProfile(selected), source: "LOCAL" };

  const channel = value(router, "global_channel", NO_GLOBAL_CHANNEL);
  const global = globalProfile(router.graph, channel);
  if (global) return { profile: global, source: "GLOBAL" };
  return { profile: "HIGH", source: "LOCAL" };
}

function setNodeMode(node, mode) {
  if (!node || node.mode === mode) return;
  if (typeof node.changeMode === "function") node.changeMode(mode);
  else node.mode = mode;
  node.setDirtyCanvas?.(true, true);
}

function syncRouters(graph) {
  syncRouterChannelChoices(graph);
  const routers = allNodes(graph).filter((node) => isClass(node, ROUTER));
  const activeNodes = new Set();
  const inactiveNodes = new Set();

  for (const router of routers) {
    const effective = effectiveProfile(router);
    router.properties ||= {};
    router.properties.inteliwebEffectiveProfile = effective.profile || "?";
    router.properties.inteliwebProfileSource = effective.source;

    const status = `${effective.profile || "?"} • ${effective.source}`;
    setValue(router, "effective_profile", status, false);

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

  for (const node of inactiveNodes) if (!activeNodes.has(node)) setNodeMode(node, MUTE);
  for (const node of activeNodes) setNodeMode(node, ACTIVE);
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

function markReadOnly(target) {
  if (!target) return;
  target.disabled = true;
  target.options ||= {};
  target.options.disabled = true;
  target.options.readOnly = true;
}

function hideClassicWidget(target) {
  if (!target || target.__inteliwebClassicHidden) return;
  target.__inteliwebClassicHidden = true;
  target.__inteliwebOriginalComputeSize = target.computeSize;
  target.computeSize = () => [0, -4];
}

function setupSelector(node) {
  const refresh = () => {
    ensureUniqueGlobalChannels(node.graph);
    syncRouterChannelChoices(node.graph);
    syncRouters(node.graph);
  };
  wrapWidgetCallback(node, "scope", refresh);
  wrapWidgetCallback(node, "profile", refresh);
  wrapWidgetCallback(node, "global_channel", refresh);
}

function setupRouter(node) {
  const effective = widget(node, "effective_profile");
  markReadOnly(effective);
  hideClassicWidget(effective);

  syncRouterChannelChoices(node.graph);
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
        syncRouterChannelChoices(this.graph);
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
        syncRouterChannelChoices(node.graph);
        syncRouters(node.graph);
      });
    }
  },

  afterConfigureGraph() {
    ensureUniqueGlobalChannels(app.graph);
    syncRouterChannelChoices(app.graph);
    syncRouters(app.graph);
  },
});
