import { app } from "../../scripts/app.js";

const SET_TYPE = "SetInteliweb";
const GET_TYPE = "GetInteliweb";
const CATEGORY = "Inteliweb/Logic";
const PACKAGE_ID = "maoper11/comfyui_inteliweb_nodes";
const SETTING_PREFIX = "Inteliweb.SetGet.";
const IMPLEMENTATION_VERSION = 2;
const NAME_WIDGET = "name";

const defaults = {
  filterGetOptionsByType: true,
  autoColor: true,
};

const pasteRenameMap = new Map();
const pendingGraphReconciles = new WeakMap();
let cachedTypeColorMap = null;

function readSetting(name) {
  try {
    return app.ui?.settings?.getSettingValue?.(`${SETTING_PREFIX}${name}`) ?? defaults[name];
  } catch {
    return defaults[name];
  }
}

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  if (typeof graph.getLink === "function") return graph.getLink(linkId) || null;
  if (graph.links instanceof Map) return graph.links.get(linkId) || null;
  if (graph.links?.[linkId]) return graph.links[linkId];
  if (graph._links instanceof Map) return graph._links.get(linkId) || null;
  return graph._links?.[linkId] || null;
}

function rootGraph(graph) {
  return graph?.rootGraph || graph || null;
}

function directChildGraphs(graph) {
  const result = [];
  for (const node of graph?._nodes || graph?.nodes || []) {
    if (node?.subgraph && !result.includes(node.subgraph)) result.push(node.subgraph);
  }
  return result;
}

function allGraphs(graph) {
  const root = rootGraph(graph);
  if (!root) return [];

  const result = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    result.push(current);

    for (const child of directChildGraphs(current)) queue.push(child);
    const registered = current._subgraphs || current.subgraphs;
    if (registered?.values) {
      for (const child of registered.values()) queue.push(child);
    }
  }
  return result;
}

function parentGraphOf(graph) {
  const root = rootGraph(graph);
  if (!graph || !root || graph === root) return null;
  for (const candidate of allGraphs(root)) {
    for (const node of candidate?._nodes || candidate?.nodes || []) {
      if (node?.subgraph === graph) return candidate;
    }
  }
  return root;
}

function graphAncestors(graph) {
  const result = [];
  const seen = new Set();
  let current = graph;
  while (current && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = parentGraphOf(current);
  }
  return result;
}

function isGraphAncestor(ancestor, graph) {
  return graphAncestors(graph).includes(ancestor);
}

function nodesOfType(graph, type) {
  return (graph?._nodes || graph?.nodes || []).filter(
    (node) => node?.type === type || node?.comfyClass === type,
  );
}

function variableWidget(node) {
  return node?.widgets?.find((widget) => widget?.name === NAME_WIDGET || widget?.name === "Constant") || null;
}

function storedVariableName(node) {
  return String(node?.properties?.inteliwebVariableName || "").trim();
}

function nodeVariableName(node) {
  const widgetValue = String(variableWidget(node)?.value ?? "").trim();
  return widgetValue || storedVariableName(node);
}

function setVariableName(node, value, { allowEmpty = false, notify = false } = {}) {
  const normalized = String(value ?? "").trim();
  const previous = nodeVariableName(node);
  if (!normalized && !allowEmpty && previous) return previous;

  const widget = variableWidget(node);
  if (widget) widget.value = normalized;
  node.properties ||= {};
  node.properties.inteliwebVariableName = normalized;
  if (node.type === SET_TYPE || node.comfyClass === SET_TYPE) {
    node.properties.previousName ||= previous;
  }
  if (notify && typeof widget?.callback === "function") widget.callback(normalized, node, widget);
  return normalized;
}

function restoreVariableName(node, serializedData = null) {
  const widget = variableWidget(node);
  const candidates = [
    String(widget?.value ?? "").trim(),
    storedVariableName(node),
    String(serializedData?.properties?.inteliwebVariableName || "").trim(),
    String(serializedData?.widgets_values?.[0] || "").trim(),
    String(node?.properties?.previousName || "").trim(),
  ];
  const restored = candidates.find(Boolean) || "";
  if (restored) setVariableName(node, restored);
  return restored;
}

function firstWiredInput(node) {
  for (let index = 0; index < (node?.inputs?.length || 0); index++) {
    const input = node.inputs[index];
    if (input?.link != null) return { ...input, index };
  }
  return null;
}

function normalizeTypes(type) {
  return String(type || "*").split(",").map((value) => value.trim()).filter(Boolean);
}

function typesAreCompatible(setType, targetType) {
  if (!targetType || targetType === "*" || !setType || setType === "*") return true;
  const available = new Set(normalizeTypes(setType));
  return normalizeTypes(targetType).some((type) => available.has(type));
}

function resolveLink(node, linkInfo) {
  if (!node?.graph || !linkInfo) return null;
  try {
    if (typeof linkInfo.resolve === "function") return linkInfo.resolve(node.graph) || null;
  } catch {
    // Older LiteGraph builds are handled below.
  }
  return null;
}

function sourceTypeFromLink(node, linkInfo) {
  const resolved = resolveLink(node, linkInfo);
  const resolvedSlot = resolved?.subgraphInput ?? resolved?.output;
  if (resolvedSlot?.type) return String(resolvedSlot.type);
  const source = node?.graph?.getNodeById?.(linkInfo?.origin_id);
  return source?.outputs?.[linkInfo?.origin_slot]?.type || linkInfo?.type || null;
}

function targetTypeFromLink(node, linkInfo) {
  const resolved = resolveLink(node, linkInfo);
  const resolvedSlot = resolved?.input ?? resolved?.subgraphOutput;
  if (resolvedSlot?.type) return String(resolvedSlot.type);
  const target = node?.graph?.getNodeById?.(linkInfo?.target_id);
  return target?.inputs?.[linkInfo?.target_slot]?.type || linkInfo?.type || null;
}

function connectedTargetTypes(node) {
  const result = new Set();
  for (const linkId of node?.outputs?.[0]?.links || []) {
    const type = targetTypeFromLink(node, getLink(node.graph, linkId));
    if (type && type !== "*") result.add(type);
  }
  return [...result];
}

function setterType(setter) {
  const input = firstWiredInput(setter);
  if (input?.link != null && setter?.graph) {
    const resolved = sourceTypeFromLink(setter, getLink(setter.graph, input.link));
    if (resolved && resolved !== "*") return resolved;
  }
  return input?.type || setter?.inputs?.[0]?.type || setter?.outputs?.[0]?.type || "*";
}

function findSetter(graph, name) {
  const wanted = String(name || "").trim();
  if (!wanted) return null;
  for (const candidateGraph of graphAncestors(graph)) {
    for (const node of nodesOfType(candidateGraph, SET_TYPE)) {
      if (nodeVariableName(node) === wanted) return { node, graph: candidateGraph };
    }
  }
  return null;
}

function visibleSetNames(graph, targetTypes = []) {
  const names = [];
  const seen = new Set();
  for (const candidateGraph of graphAncestors(graph)) {
    for (const setter of nodesOfType(candidateGraph, SET_TYPE)) {
      const name = nodeVariableName(setter);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const type = setterType(setter);
      if (targetTypes.length && !targetTypes.every((target) => typesAreCompatible(type, target))) continue;
      names.push(name);
    }
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getTypeColorMap() {
  if (cachedTypeColorMap) return cachedTypeColorMap;
  const palette = globalThis.LGraphCanvas?.node_colors || {};
  cachedTypeColorMap = {
    DEFAULT: palette.gray,
    MODEL: palette.blue,
    LATENT: palette.purple,
    VAE: palette.red,
    WANVAE: palette.red,
    CONDITIONING: palette.brown,
    IMAGE: palette.pale_blue,
    CLIP: palette.yellow,
    FLOAT: palette.green,
    MASK: { color: "#1c5715", bgcolor: "#1f401b" },
    INT: { color: "#1b4669", bgcolor: "#29699c" },
    CONTROL_NET: { color: "#156653", bgcolor: "#1c453b" },
    NOISE: { color: "#2e2e2e", bgcolor: "#242121" },
    GUIDER: { color: "#3c7878", bgcolor: "#1c453b" },
    SAMPLER: { color: "#614a4a", bgcolor: "#3b2c2c" },
    SIGMAS: { color: "#485248", bgcolor: "#272e27" },
  };
  return cachedTypeColorMap;
}

function applyTypeColor(node, type) {
  if (!node) return;
  if (!readSetting("autoColor") || !type || type === "*") {
    node.color = null;
    node.bgcolor = null;
    return;
  }
  const primaryType = normalizeTypes(type)[0] || "DEFAULT";
  const colors = getTypeColorMap()[primaryType] || globalThis.LGraphCanvas?.node_colors?.gray;
  if (!colors) return;
  node.color = colors.color ?? null;
  node.bgcolor = colors.bgcolor ?? null;
}

function menuEntryColor(canvas, type) {
  const primaryType = normalizeTypes(type)[0] || "DEFAULT";
  const mapped = getTypeColorMap()[primaryType];
  return canvas?.default_connection_color_byType?.[primaryType]
    || globalThis.LGraphCanvas?.link_type_colors?.[primaryType]
    || mapped?.groupcolor || mapped?.bgcolor || mapped?.color || "#888";
}

function gettersOwnedBy(setter) {
  if (!setter?.graph) return [];
  const name = nodeVariableName(setter);
  if (!name) return [];
  const result = [];
  for (const graph of allGraphs(setter.graph)) {
    for (const getter of nodesOfType(graph, GET_TYPE)) {
      if (findSetter(graph, nodeVariableName(getter))?.node === setter) result.push(getter);
    }
  }
  return result;
}

function updateGettersAfterSetRename(setter, previousName, newName) {
  if (!setter?.graph || !previousName || previousName === newName) return;
  for (const graph of allGraphs(setter.graph)) {
    if (!isGraphAncestor(setter.graph, graph)) continue;
    for (const getter of nodesOfType(graph, GET_TYPE)) {
      if (nodeVariableName(getter) !== previousName) continue;
      if (!findSetter(graph, previousName)) getter.setName?.(newName);
    }
  }
}

function createSetNameWidget(node) {
  return node.addWidget("text", NAME_WIDGET, storedVariableName(node), (value) => {
    if (node.__inteliwebRepairing || node.__inteliwebRefreshingCombo) return;
    setVariableName(node, value, { allowEmpty: true });
    if (!node.graph || app.configuringGraph) return;
    node.validateName?.(node.graph);
    node.updateVariable?.();
  });
}

function makeGetComboOptions(node) {
  const options = {};
  Object.defineProperty(options, "values", {
    get: () => {
      if (!node.graph) return [];
      const current = nodeVariableName(node);
      const targets = readSetting("filterGetOptionsByType") ? connectedTargetTypes(node) : [];
      const names = visibleSetNames(node.graph, targets);
      return !targets.length && current && !names.includes(current) ? [current, ...names] : names;
    },
    enumerable: true,
    configurable: true,
  });
  return options;
}

function attachClassicComboMenu(node, widget, comboOptions) {
  if (!widget || widget.__inteliwebClassicMenuAttached) return;
  widget.__inteliwebClassicMenuAttached = true;
  const originalOnClick = widget.onClick;
  widget.onClick = (params) => {
    if (LiteGraph.vueNodesMode) {
      return typeof originalOnClick === "function" ? originalOnClick.call(widget, params) : undefined;
    }
    const { e, canvas } = params;
    const x = e.canvasX - node.pos[0];
    const width = widget.width || node.size[0];
    if (x < 40) return widget.decrementValue?.(params);
    if (x > width - 40) return widget.incrementValue?.(params);

    const values = comboOptions.values;
    if (!values.length) return;
    const menu = new LiteGraph.ContextMenu(values, {
      scale: Math.max(1, canvas.ds?.scale || 1),
      event: e,
      className: "dark",
      callback: (value) => widget.setValue?.(value, params),
    });
    const entries = menu.root?.querySelectorAll?.(".litemenu-entry");
    values.forEach((name, index) => {
      const entry = entries?.[index];
      if (!entry) return;
      const setter = findSetter(node.graph, name)?.node;
      entry.style.borderLeft = `4px solid ${menuEntryColor(canvas, setterType(setter))}`;
      entry.style.paddingLeft = "8px";
    });
  };
}

function createGetNameWidget(node) {
  const comboOptions = makeGetComboOptions(node);
  const widget = node.addWidget("combo", NAME_WIDGET, storedVariableName(node), (value) => {
    if (node.__inteliwebRepairing || node.__inteliwebRefreshingCombo) return;
    setVariableName(node, value, { allowEmpty: true });
    if (!app.configuringGraph) node.onRename?.();
  }, comboOptions);
  node.__inteliwebComboOptions = comboOptions;
  attachClassicComboMenu(node, widget, comboOptions);
  return widget;
}

function ensureSetIntegrity(node, serializedData = null) {
  if (!node) return;
  node.__inteliwebRepairing = true;
  try {
    node.properties ||= {};
    node.properties["Node name for S&R"] = SET_TYPE;
    node.properties.aux_id = PACKAGE_ID;
    node.properties.previousName ||= "";
    node.properties.inteliwebVariableName ||= "";
    node.isVirtualNode = true;
    node.serialize_widgets = true;
    node.comfyClass = SET_TYPE;

    let widget = variableWidget(node);
    if (!widget || widget.type !== "text") {
      if (widget) node.widgets.splice(node.widgets.indexOf(widget), 1);
      widget = createSetNameWidget(node);
    }
    widget.name = NAME_WIDGET;

    if (!node.inputs?.length) node.addInput("value", "*");
    if (!node.outputs?.length) node.addOutput("*", "*");
    restoreVariableName(node, serializedData);
  } finally {
    node.__inteliwebRepairing = false;
  }
}

function ensureGetIntegrity(node, serializedData = null) {
  if (!node) return;
  node.__inteliwebRepairing = true;
  try {
    node.properties ||= {};
    node.properties["Node name for S&R"] = GET_TYPE;
    node.properties.aux_id = PACKAGE_ID;
    node.properties.inteliwebVariableName ||= "";
    node.isVirtualNode = true;
    node.serialize_widgets = true;
    node.comfyClass = GET_TYPE;
    node.currentSetter ||= null;

    let widget = variableWidget(node);
    if (!widget || widget.type !== "combo") {
      if (widget) node.widgets.splice(node.widgets.indexOf(widget), 1);
      widget = createGetNameWidget(node);
    } else {
      const options = node.__inteliwebComboOptions || makeGetComboOptions(node);
      node.__inteliwebComboOptions = options;
      widget.options = options;
      attachClassicComboMenu(node, widget, options);
    }
    widget.name = NAME_WIDGET;

    if (!node.outputs?.length) node.addOutput("*", "*");
    restoreVariableName(node, serializedData);
  } finally {
    node.__inteliwebRepairing = false;
  }
}

function reconcileSetType(node) {
  ensureSetIntegrity(node);
  const input = firstWiredInput(node);
  const link = input?.link != null ? getLink(node.graph, input.link) : null;
  const type = sourceTypeFromLink(node, link) || input?.type || node.inputs?.[0]?.type || node.outputs?.[0]?.type || "*";
  node.setAdoptedType?.(type);
}

function reconcileSetName(node) {
  const current = nodeVariableName(node);
  if (!current) return;
  setVariableName(node, current);
  node.properties.previousName = current;
  node.refreshTitle?.();
}

function reconcileSet(node) {
  if (!node?.graph) return;
  ensureSetIntegrity(node);
  reconcileSetType(node);
  reconcileSetName(node);
  for (const getter of gettersOwnedBy(node)) reconcileGet(getter);
}

function reconcileGet(node) {
  if (!node?.graph) return;
  ensureGetIntegrity(node);
  const name = nodeVariableName(node);
  if (name) setVariableName(node, name);
  const result = findSetter(node.graph, name);
  node.currentSetter = result?.node || null;
  node.setType?.(result?.node ? setterType(result.node) : "*");
  node.refreshTitle?.();
  node._refreshComboOptions?.();
}

function reconcileGraphNow(graph) {
  if (!graph) return;
  for (const candidate of allGraphs(graph)) {
    for (const setter of nodesOfType(candidate, SET_TYPE)) reconcileSet(setter);
    for (const getter of nodesOfType(candidate, GET_TYPE)) reconcileGet(getter);
  }
  app.canvas?.setDirty?.(true, true);
}

function scheduleGraphReconcile(graph) {
  const root = rootGraph(graph);
  if (!root || pendingGraphReconciles.has(root)) return;
  const token = {};
  pendingGraphReconciles.set(root, token);
  queueMicrotask(() => {
    if (pendingGraphReconciles.get(root) !== token) return;
    pendingGraphReconciles.delete(root);
    reconcileGraphNow(root);
  });
}

function refreshAllGetCombos(graph) {
  for (const candidate of allGraphs(graph)) {
    for (const getter of nodesOfType(candidate, GET_TYPE)) getter._refreshComboOptions?.();
  }
  app.canvas?.setDirty?.(true, true);
}

function refreshAllNodeColors(graph) {
  for (const candidate of allGraphs(graph)) {
    for (const setter of nodesOfType(candidate, SET_TYPE)) applyTypeColor(setter, setterType(setter));
    for (const getter of nodesOfType(candidate, GET_TYPE)) applyTypeColor(getter, getter.outputs?.[0]?.type || "*");
  }
  app.canvas?.setDirty?.(true, true);
}

function registerSetNode() {
  const existing = LiteGraph.registered_node_types?.[SET_TYPE];
  if (existing?.__inteliwebImplementationVersion === IMPLEMENTATION_VERSION) return;

  class SetInteliwebNode extends LiteGraph.LGraphNode {
    static title = "Set (Inteliweb)";
    static category = CATEGORY;
    static __inteliwebImplementationVersion = IMPLEMENTATION_VERSION;

    constructor(title) {
      super(title);
      ensureSetIntegrity(this);
      this.refreshTitle();
    }

    refreshTitle() {
      const name = nodeVariableName(this);
      this.title = name ? `Set: ${name}` : "Set (Inteliweb)";
    }

    setAdoptedType(type) {
      const adopted = type || "*";
      if (this.inputs?.[0]) {
        this.inputs[0].type = adopted;
        this.inputs[0].name = "value";
        this.inputs[0].label = adopted;
      }
      if (this.outputs?.[0]) {
        this.outputs[0].type = adopted;
        this.outputs[0].name = adopted;
        this.outputs[0].label = adopted;
      }
      applyTypeColor(this, adopted);
    }

    validateName(graph, sameGraphOnly = false) {
      const widget = variableWidget(this);
      let value = String(widget?.value || "").trim();
      if (!value) return false;
      const existingNames = new Set();
      const scope = sameGraphOnly ? [graph] : graphAncestors(graph);
      for (const candidateGraph of scope) {
        for (const node of nodesOfType(candidateGraph, SET_TYPE)) {
          if (node !== this) existingNames.add(nodeVariableName(node));
        }
      }
      const original = value;
      const base = this._justAdded ? value.replace(/_\d+$/, "") : value;
      let suffix = 1;
      while (existingNames.has(value)) value = `${base}_${suffix++}`;
      setVariableName(this, value);
      return value !== original;
    }

    updateVariable() {
      if (!this.graph) return;
      const name = nodeVariableName(this);
      if (!name) {
        this.refreshTitle();
        return;
      }
      const previousName = String(this.properties.previousName || "").trim();
      const adoptedType = setterType(this);
      this.setAdoptedType(adoptedType);
      updateGettersAfterSetRename(this, previousName, name);
      this.properties.previousName = name;
      setVariableName(this, name);
      this.refreshTitle();
      for (const getter of gettersOwnedBy(this)) getter.setType?.(adoptedType);
      refreshAllGetCombos(this.graph);
      app.canvas?.setDirty?.(true, true);
    }

    onConnectionsChange(slotType, slot, isConnect, linkInfo) {
      ensureSetIntegrity(this);
      if (app.configuringGraph) return;
      if (slotType === LiteGraph.INPUT) {
        this.setAdoptedType(isConnect
          ? sourceTypeFromLink(this, linkInfo) || this.inputs?.[0]?.type || "*"
          : this.outputs?.[0]?.links?.length ? this.outputs[0].type : "*");
      } else if (slotType === LiteGraph.OUTPUT) {
        const inputType = setterType(this);
        this.setAdoptedType(inputType !== "*"
          ? inputType
          : isConnect ? targetTypeFromLink(this, linkInfo) || "*" : "*");
      }
      this.updateVariable();
    }

    getInputLink() {
      const input = firstWiredInput(this);
      return input?.link != null ? getLink(this.graph, input.link) : null;
    }

    onAdded() {
      this._justAdded = true;
      ensureSetIntegrity(this);
      if (LiteGraph.vueNodesMode && this.graph && !app.configuringGraph) refreshAllGetCombos(this.graph);
    }

    onRemoved() {
      const graph = this.graph;
      if (graph) setTimeout(() => scheduleGraphReconcile(graph), 0);
    }

    onConfigure(serializedData) {
      ensureSetIntegrity(this, serializedData);
      if (this._justAdded && this.graph && !app.configuringGraph) {
        const oldName = nodeVariableName(this);
        this.validateName(this.graph, true);
        const newName = nodeVariableName(this);
        if (oldName && newName !== oldName) {
          pasteRenameMap.set(oldName, newName);
          setTimeout(() => pasteRenameMap.delete(oldName), 0);
        }
      }
      this._justAdded = false;
      reconcileSetType(this);
      reconcileSetName(this);
      scheduleGraphReconcile(this.graph);
    }

    onSerialize(data) {
      ensureSetIntegrity(this);
      const name = nodeVariableName(this);
      data.properties ||= {};
      if (name) {
        data.properties.inteliwebVariableName = name;
        data.properties.previousName = name;
        data.widgets_values ||= [];
        data.widgets_values[0] = name;
      }
    }

    onGraphConfigured() {
      ensureSetIntegrity(this);
      scheduleGraphReconcile(this.graph);
    }

    onAfterGraphConfigured() {
      setTimeout(() => scheduleGraphReconcile(this.graph), 0);
    }

    clone() {
      const cloned = super.clone();
      if (!cloned) return cloned;
      cloned.properties ||= {};
      cloned.properties.previousName = "";
      if (cloned.inputs?.[0]) cloned.inputs[0].type = "*";
      if (cloned.outputs?.[0]) cloned.outputs[0].type = "*";
      cloned.color = null;
      cloned.bgcolor = null;
      return cloned;
    }

    getExtraMenuOptions(_, options) {
      const getters = gettersOwnedBy(this);
      options.unshift({
        content: "Add paired Get (Inteliweb)",
        callback: () => {
          const getter = LiteGraph.createNode(GET_TYPE);
          if (!getter || !this.graph) return;
          getter.pos = [this.pos[0] + this.size[0] + 30, this.pos[1]];
          this.graph.add(getter);
          getter.setName?.(nodeVariableName(this));
          app.canvas?.selectNode?.(getter, false);
          app.canvas?.setDirty?.(true, true);
        },
      });
      options.unshift({
        content: `Select paired Gets (${getters.length})`,
        disabled: getters.length === 0,
        callback: () => {
          app.canvas?.deselectAllNodes?.();
          for (const getter of getters) app.canvas?.selectNode?.(getter, true);
          app.canvas?.setDirty?.(true, true);
        },
      });
    }
  }

  LiteGraph.registerNodeType(SET_TYPE, SetInteliwebNode);
}

function registerGetNode() {
  const existing = LiteGraph.registered_node_types?.[GET_TYPE];
  if (existing?.__inteliwebImplementationVersion === IMPLEMENTATION_VERSION) return;

  class GetInteliwebNode extends LiteGraph.LGraphNode {
    static title = "Get (Inteliweb)";
    static category = CATEGORY;
    static __inteliwebImplementationVersion = IMPLEMENTATION_VERSION;

    constructor(title) {
      super(title);
      ensureGetIntegrity(this);
      this._installRefreshCombo();
      this.refreshTitle();
    }

    _installRefreshCombo() {
      this._refreshComboOptions = () => {
        ensureGetIntegrity(this);
        const widget = variableWidget(this);
        if (!widget || this.__inteliwebRefreshingCombo) return;
        const currentName = nodeVariableName(this);
        this.__inteliwebRefreshingCombo = true;
        try {
          const options = makeGetComboOptions(this);
          this.__inteliwebComboOptions = options;
          widget.options = options;
          attachClassicComboMenu(this, widget, options);
          if (LiteGraph.vueNodesMode) {
            const index = this.widgets.indexOf(widget);
            if (index >= 0) {
              this.widgets.splice(index, 1);
              this.widgets.splice(index, 0, widget);
            }
          }
          if (currentName) setVariableName(this, currentName);
        } finally {
          this.__inteliwebRefreshingCombo = false;
        }
      };
    }

    refreshTitle() {
      const name = nodeVariableName(this);
      this.title = name ? `Get: ${name}` : "Get (Inteliweb)";
    }

    setName(name) {
      setVariableName(this, name, { allowEmpty: true });
      this.onRename();
    }

    setType(type) {
      const adopted = type || "*";
      if (this.outputs?.[0]) {
        this.outputs[0].type = adopted;
        this.outputs[0].name = adopted;
        this.outputs[0].label = adopted;
      }
      applyTypeColor(this, adopted);
      this.validateLinks();
    }

    onRename() {
      if (this.__inteliwebRefreshingCombo || this.__inteliwebRepairing) return;
      const name = nodeVariableName(this);
      if (name) setVariableName(this, name);
      const result = findSetter(this.graph, name);
      this.currentSetter = result?.node || null;
      this.setType(result?.node ? setterType(result.node) : "*");
      this.refreshTitle();
      this._refreshComboOptions?.();
      app.canvas?.setDirty?.(true, true);
    }

    onConnectionsChange() {
      if (app.configuringGraph) return;
      this._refreshComboOptions?.();
      this.validateLinks();
      app.canvas?.setDirty?.(true, true);
    }

    validateLinks() {
      const output = this.outputs?.[0];
      if (!this.graph || !output?.links || output.type === "*") return;
      for (const linkId of [...output.links]) {
        const targetType = targetTypeFromLink(this, getLink(this.graph, linkId));
        if (targetType && targetType !== "*" && !typesAreCompatible(output.type, targetType)) {
          this.graph.removeLink?.(linkId);
        }
      }
    }

    getInputLink() {
      const result = findSetter(this.graph, nodeVariableName(this));
      if (!result || result.graph !== this.graph) return null;
      const input = firstWiredInput(result.node);
      return input?.link != null ? getLink(result.graph, input.link) : null;
    }

    resolveVirtualOutput() {
      const result = findSetter(this.graph, nodeVariableName(this));
      if (!result || result.graph === this.graph) return undefined;
      const input = firstWiredInput(result.node);
      if (input?.link == null) return undefined;
      const link = getLink(result.graph, input.link);
      if (!link) return undefined;
      const resolved = resolveLink(result.node, link);
      const source = resolved?.outputNode || result.graph.getNodeById?.(link.origin_id);
      const slot = resolved?.output ? source?.outputs?.indexOf?.(resolved.output) : link.origin_slot;
      return source ? { node: source, slot: slot ?? link.origin_slot } : undefined;
    }

    onAdded() {
      this._justAdded = true;
      ensureGetIntegrity(this);
      this._installRefreshCombo();
    }

    onConfigure(serializedData) {
      ensureGetIntegrity(this, serializedData);
      this._installRefreshCombo();
      if (this._justAdded && !app.configuringGraph) {
        const renamed = pasteRenameMap.get(nodeVariableName(this));
        if (renamed) setVariableName(this, renamed);
      }
      this._justAdded = false;
      scheduleGraphReconcile(this.graph);
    }

    onSerialize(data) {
      ensureGetIntegrity(this);
      const name = nodeVariableName(this);
      data.properties ||= {};
      if (name) {
        data.properties.inteliwebVariableName = name;
        data.widgets_values ||= [];
        data.widgets_values[0] = name;
      }
    }

    onGraphConfigured() {
      ensureGetIntegrity(this);
      this._installRefreshCombo();
      scheduleGraphReconcile(this.graph);
    }

    onAfterGraphConfigured() {
      setTimeout(() => scheduleGraphReconcile(this.graph), 0);
    }

    clone() {
      const cloned = super.clone();
      if (!cloned) return cloned;
      if (cloned.outputs?.[0]) cloned.outputs[0].type = "*";
      cloned.color = null;
      cloned.bgcolor = null;
      return cloned;
    }

    getExtraMenuOptions(_, options) {
      const result = findSetter(this.graph, nodeVariableName(this));
      if (!result?.node) return;
      options.unshift({
        content: "Jump to paired Set (Inteliweb)",
        callback: () => {
          const canvas = app.canvas;
          const setter = result.node;
          if (result.graph !== this.graph && canvas?.setGraph) {
            canvas.setGraph(result.graph);
            setTimeout(() => {
              canvas.centerOnNode?.(setter);
              canvas.selectNode?.(setter, false);
              canvas.setDirty?.(true, true);
            }, 0);
          } else {
            canvas?.centerOnNode?.(setter);
            canvas?.selectNode?.(setter, false);
            canvas?.setDirty?.(true, true);
          }
        },
      });
    }
  }

  LiteGraph.registerNodeType(GET_TYPE, GetInteliwebNode);
}

function installSubgraphConvertedListener() {
  const canvasElement = app.canvas?.canvas;
  if (!canvasElement || canvasElement._inteliwebSetGetSubgraphListener) return;
  canvasElement._inteliwebSetGetSubgraphListener = true;
  canvasElement.addEventListener("subgraph-converted", (event) => {
    const subgraph = event?.detail?.subgraphNode?.subgraph;
    scheduleGraphReconcile(subgraph || app.graph);
    setTimeout(() => scheduleGraphReconcile(subgraph || app.graph), 0);
  });
}

app.registerExtension({
  name: "Inteliweb.SetGet",
  settings: [
    {
      id: `${SETTING_PREFIX}filterGetOptionsByType`,
      name: "Filter Get node options by type",
      type: "boolean",
      defaultValue: defaults.filterGetOptionsByType,
      tooltip: "When a Get node is connected, only shows Set variables compatible with the destination input type.",
      category: ["Inteliweb", "Set & Get Nodes", "Filter Get node options by type"],
      onChange: () => refreshAllGetCombos(app.graph),
    },
    {
      id: `${SETTING_PREFIX}autoColor`,
      name: "Auto-color nodes",
      type: "boolean",
      defaultValue: defaults.autoColor,
      tooltip: "Automatically colors Set and Get nodes according to the stored ComfyUI data type.",
      category: ["Inteliweb", "Set & Get Nodes", "Auto-color nodes"],
      onChange: () => refreshAllNodeColors(app.graph),
    },
  ],

  registerCustomNodes() {
    registerSetNode();
    registerGetNode();
  },

  nodeCreated(node) {
    if (node?.type === SET_TYPE || node?.comfyClass === SET_TYPE) {
      ensureSetIntegrity(node);
      scheduleGraphReconcile(node.graph || app.graph);
    } else if (node?.type === GET_TYPE || node?.comfyClass === GET_TYPE) {
      ensureGetIntegrity(node);
      node._installRefreshCombo?.();
      scheduleGraphReconcile(node.graph || app.graph);
    }
  },

  loadedGraphNode(node) {
    if (node?.type === SET_TYPE || node?.comfyClass === SET_TYPE) ensureSetIntegrity(node);
    else if (node?.type === GET_TYPE || node?.comfyClass === GET_TYPE) ensureGetIntegrity(node);
  },

  setup() {
    installSubgraphConvertedListener();
    setTimeout(() => {
      installSubgraphConvertedListener();
      scheduleGraphReconcile(app.graph);
    }, 0);
  },

  afterConfigureGraph() {
    scheduleGraphReconcile(app.graph);
    setTimeout(() => scheduleGraphReconcile(app.graph), 0);
  },
});
