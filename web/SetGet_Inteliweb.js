import { app } from "../../scripts/app.js";

const SET_TYPE = "SetInteliweb";
const GET_TYPE = "GetInteliweb";
const CATEGORY = "Inteliweb/Utils";
const PACKAGE_ID = "maoper11/comfyui_inteliweb_nodes";
const SETTING_PREFIX = "Inteliweb.SetGet.";
const IMPLEMENTATION_VERSION = 4;
const NAME_WIDGET = "name";

const SET_METADATA = Object.freeze({
  displayName: "Set (Inteliweb)",
  description: "Stores a connected value under a variable name so it can be retrieved elsewhere with Get (Inteliweb).",
  searchAliases: ["set node", "set variable", "named variable", "wireless connection"],
});

const GET_METADATA = Object.freeze({
  displayName: "Get (Inteliweb)",
  description: "Retrieves a value stored by Set (Inteliweb) without drawing a long connection across the workflow.",
  searchAliases: ["get node", "get variable", "named variable", "wireless connection"],
});

const defaults = {
  filterGetOptionsByType: true,
  autoColor: true,
};

const pasteRenameMap = new Map();
const graphIndexCache = new WeakMap();
const pendingInitialReconciles = new WeakMap();
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

function graphNodes(graph) {
  return graph?._nodes || graph?.nodes || [];
}

function isSetNode(node) {
  return node?.type === SET_TYPE || node?.comfyClass === SET_TYPE;
}

function isGetNode(node) {
  return node?.type === GET_TYPE || node?.comfyClass === GET_TYPE;
}

function variableWidget(node) {
  return node?.widgets?.find(
    (widget) => widget?.name === NAME_WIDGET || widget?.name === "Constant",
  ) || null;
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
  if (isSetNode(node)) node.properties.previousName ||= previous;
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
  return String(type || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
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

function collectGraphStructure(graph) {
  const root = rootGraph(graph);
  if (!root) {
    return {
      root: null,
      graphs: [],
      parentByGraph: new Map(),
      childrenByGraph: new Map(),
    };
  }

  const graphs = [];
  const seen = new Set();
  const parentByGraph = new Map();
  const childrenByGraph = new Map();
  const queue = [root];

  const addChild = (parent, child) => {
    if (!parent || !child || child === parent) return;
    if (!parentByGraph.has(child)) parentByGraph.set(child, parent);
    let children = childrenByGraph.get(parent);
    if (!children) childrenByGraph.set(parent, (children = []));
    if (!children.includes(child)) children.push(child);
    if (!seen.has(child)) queue.push(child);
  };

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    graphs.push(current);

    for (const node of graphNodes(current)) {
      const child = node?.subgraph || node?._graph;
      if (child && child !== current) addChild(current, child);
    }

    const registered = current._subgraphs || current.subgraphs;
    if (registered?.values) {
      for (const child of registered.values()) {
        if (!parentByGraph.has(child)) addChild(current === root ? root : current, child);
      }
    }
  }

  for (const candidate of graphs) {
    if (candidate !== root && !parentByGraph.has(candidate)) parentByGraph.set(candidate, root);
  }

  return { root, graphs, parentByGraph, childrenByGraph };
}

function buildGraphIndex(graph) {
  const structure = collectGraphStructure(graph);
  const setsByGraph = new Map();
  const getsByGraph = new Map();
  const allSets = [];
  const allGets = [];

  for (const candidate of structure.graphs) {
    const namedSets = new Map();
    const getters = [];
    for (const node of graphNodes(candidate)) {
      if (isSetNode(node)) {
        allSets.push(node);
        const name = nodeVariableName(node);
        if (name && !namedSets.has(name)) namedSets.set(name, node);
      } else if (isGetNode(node)) {
        allGets.push(node);
        getters.push(node);
      }
    }
    setsByGraph.set(candidate, namedSets);
    getsByGraph.set(candidate, getters);
  }

  const ancestorsByGraph = new Map();
  const ancestorsOf = (candidate) => {
    if (ancestorsByGraph.has(candidate)) return ancestorsByGraph.get(candidate);
    const result = [];
    const seen = new Set();
    let current = candidate;
    while (current && !seen.has(current)) {
      seen.add(current);
      result.push(current);
      current = structure.parentByGraph.get(current) || null;
    }
    if (structure.root && !result.includes(structure.root)) result.push(structure.root);
    ancestorsByGraph.set(candidate, result);
    return result;
  };

  const resolveSetter = (candidateGraph, name) => {
    const wanted = String(name || "").trim();
    if (!wanted) return null;
    for (const scopeGraph of ancestorsOf(candidateGraph)) {
      const setter = setsByGraph.get(scopeGraph)?.get(wanted);
      if (setter) return { node: setter, graph: scopeGraph };
    }
    return null;
  };

  const gettersBySetter = new Map();
  for (const getter of allGets) {
    const setter = resolveSetter(getter.graph, nodeVariableName(getter))?.node;
    if (!setter) continue;
    let getters = gettersBySetter.get(setter);
    if (!getters) gettersBySetter.set(setter, (getters = []));
    getters.push(getter);
  }

  return {
    ...structure,
    setsByGraph,
    getsByGraph,
    allSets,
    allGets,
    ancestorsByGraph,
    optionNamesByGraph: new WeakMap(),
    resolveSetter,
    ancestorsOf,
    gettersBySetter,
  };
}

function getGraphIndex(graph, { rebuild = false } = {}) {
  const root = rootGraph(graph);
  if (!root) return buildGraphIndex(null);
  if (!rebuild) {
    const cached = graphIndexCache.get(root);
    if (cached) return cached;
  }
  const index = buildGraphIndex(root);
  graphIndexCache.set(root, index);
  return index;
}

function invalidateGraphIndex(graph) {
  const root = rootGraph(graph);
  if (root) graphIndexCache.delete(root);
}

function descendantGraphs(graph, index = getGraphIndex(graph)) {
  if (!graph) return [];
  const result = [];
  const seen = new Set();
  const queue = [graph];
  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    for (const child of index.childrenByGraph.get(current) || []) queue.push(child);
  }
  return result;
}

function findSetter(graph, name, index = getGraphIndex(graph)) {
  return index.resolveSetter(graph, name);
}

function gettersOwnedBy(setter, index = getGraphIndex(setter?.graph)) {
  return setter ? index.gettersBySetter.get(setter) || [] : [];
}

function visibleSetEntries(graph, targetTypes = [], index = getGraphIndex(graph)) {
  let graphCache = index.optionNamesByGraph.get(graph);
  if (!graphCache) index.optionNamesByGraph.set(graph, (graphCache = new Map()));
  const typeKey = [...targetTypes].sort().join(",") || "*";
  if (graphCache.has(typeKey)) return graphCache.get(typeKey);

  const entries = [];
  const seenNames = new Set();
  for (const candidateGraph of index.ancestorsOf(graph)) {
    for (const [name, setter] of index.setsByGraph.get(candidateGraph) || []) {
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);
      const type = setterType(setter);
      if (targetTypes.length && !targetTypes.every((target) => typesAreCompatible(type, target))) continue;
      entries.push({ name, setter });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  graphCache.set(typeKey, entries);
  return entries;
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

function getOptionValues(node, index = getGraphIndex(node?.graph)) {
  if (!node?.graph) return [];
  const current = nodeVariableName(node);
  const targets = readSetting("filterGetOptionsByType") ? connectedTargetTypes(node) : [];
  const names = visibleSetEntries(node.graph, targets, index).map((entry) => entry.name);
  return !targets.length && current && !names.includes(current) ? [current, ...names] : names;
}

function makeGetComboOptions(node) {
  const options = { __inteliwebOptimizedOptions: true };
  Object.defineProperty(options, "values", {
    get: () => node.__inteliwebOptionValues || getOptionValues(node),
    enumerable: true,
    configurable: true,
  });
  return options;
}

function attachClassicComboMenu(node, widget) {
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

    const index = getGraphIndex(node.graph);
    const values = getOptionValues(node, index);
    if (!values.length) return;
    const menu = new LiteGraph.ContextMenu(values, {
      scale: Math.max(1, canvas.ds?.scale || 1),
      event: e,
      className: "dark",
      callback: (value) => widget.setValue?.(value, params),
    });
    const entries = menu.root?.querySelectorAll?.(".litemenu-entry");
    values.forEach((name, optionIndex) => {
      const entry = entries?.[optionIndex];
      if (!entry) return;
      const setter = findSetter(node.graph, name, index)?.node;
      entry.style.borderLeft = `4px solid ${menuEntryColor(canvas, setterType(setter))}`;
      entry.style.paddingLeft = "8px";
    });
  };
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

function createGetNameWidget(node) {
  const options = makeGetComboOptions(node);
  const widget = node.addWidget("combo", NAME_WIDGET, storedVariableName(node), (value) => {
    if (node.__inteliwebRepairing || node.__inteliwebRefreshingCombo) return;
    setVariableName(node, value, { allowEmpty: true });
    if (!app.configuringGraph) node.onRename?.();
  }, options);
  node.__inteliwebComboOptions = options;
  attachClassicComboMenu(node, widget);
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
      if (!widget.options?.__inteliwebOptimizedOptions) widget.options = makeGetComboOptions(node);
      node.__inteliwebComboOptions = widget.options;
      attachClassicComboMenu(node, widget);
    }
    widget.name = NAME_WIDGET;

    if (!node.outputs?.length) node.addOutput("*", "*");
    restoreVariableName(node, serializedData);
  } finally {
    node.__inteliwebRepairing = false;
  }
}

function applySetType(node, type) {
  const adopted = type || "*";
  if (node.inputs?.[0]) {
    node.inputs[0].type = adopted;
    node.inputs[0].name = "value";
    node.inputs[0].label = adopted;
  }
  if (node.outputs?.[0]) {
    node.outputs[0].type = adopted;
    node.outputs[0].name = adopted;
    node.outputs[0].label = adopted;
  }
  applyTypeColor(node, adopted);
}

function reconcileSetLocal(node) {
  ensureSetIntegrity(node);
  const input = firstWiredInput(node);
  const link = input?.link != null ? getLink(node.graph, input.link) : null;
  const type = sourceTypeFromLink(node, link)
    || input?.type
    || node.inputs?.[0]?.type
    || node.outputs?.[0]?.type
    || "*";
  applySetType(node, type);
  const name = nodeVariableName(node);
  if (name) setVariableName(node, name);
  node.refreshTitle?.();
}

function reconcileGetLocal(node, index, { refreshOptions = true, validateLinks = true } = {}) {
  ensureGetIntegrity(node);
  const name = nodeVariableName(node);
  if (name) setVariableName(node, name);
  const result = findSetter(node.graph, name, index);
  node.currentSetter = result?.node || null;
  node.setType?.(result?.node ? setterType(result.node) : "*", { validateLinks });
  node.refreshTitle?.();
  if (refreshOptions) node._refreshComboOptions?.(false, index);
}

function resolvePreviousOwner(index, graph, previousName, renamedSetter) {
  if (!graph || !previousName || !renamedSetter) return null;
  for (const scopeGraph of index.ancestorsOf(graph)) {
    const namedSetter = index.setsByGraph.get(scopeGraph)?.get(previousName);
    if (namedSetter) return namedSetter;
    if (scopeGraph === renamedSetter.graph) return renamedSetter;
  }
  return null;
}

function refreshGetCombosInGraphs(graphs, index = getGraphIndex(graphs?.[0])) {
  for (const graph of graphs || []) {
    for (const getter of index.getsByGraph.get(graph) || []) getter._refreshComboOptions?.(false, index);
  }
}

function refreshGetCombosForScope(graph, index = getGraphIndex(graph)) {
  refreshGetCombosInGraphs(descendantGraphs(graph, index), index);
}

function propagateSetRename(setter, previousName, newName, oldIndex) {
  if (!setter?.graph || !previousName || previousName === newName) return [];
  const updated = [];
  for (const graph of descendantGraphs(setter.graph, oldIndex)) {
    for (const getter of oldIndex.getsByGraph.get(graph) || []) {
      if (nodeVariableName(getter) !== previousName) continue;
      if (resolvePreviousOwner(oldIndex, graph, previousName, setter) !== setter) continue;
      setVariableName(getter, newName, { allowEmpty: true });
      getter.currentSetter = setter;
      getter.setType?.(setterType(setter));
      getter.refreshTitle?.();
      updated.push(getter);
    }
  }
  return updated;
}

function refreshAllGetCombos(graph) {
  invalidateGraphIndex(graph);
  const index = getGraphIndex(graph);
  for (const getter of index.allGets) getter._refreshComboOptions?.(true, index);
  app.canvas?.setDirty?.(true, true);
}

function refreshAllNodeColors(graph) {
  const index = getGraphIndex(graph, { rebuild: true });
  for (const setter of index.allSets) applyTypeColor(setter, setterType(setter));
  for (const getter of index.allGets) applyTypeColor(getter, getter.outputs?.[0]?.type || "*");
  app.canvas?.setDirty?.(true, true);
}

function reconcileLoadedWorkflow(graph) {
  const structure = collectGraphStructure(graph);
  if (!structure.root) return;

  // Local repair first. No relationship lookup or widget rebuilding occurs here.
  for (const candidate of structure.graphs) {
    for (const node of graphNodes(candidate)) {
      if (isSetNode(node)) ensureSetIntegrity(node);
      else if (isGetNode(node)) ensureGetIntegrity(node);
    }
  }

  invalidateGraphIndex(structure.root);
  const index = getGraphIndex(structure.root);

  for (const setter of index.allSets) reconcileSetLocal(setter);
  for (const getter of index.allGets) {
    reconcileGetLocal(getter, index, { refreshOptions: false, validateLinks: false });
    getter._primeComboOptions?.(index);
  }
  for (const getter of index.allGets) getter.validateLinks?.();

  app.canvas?.setDirty?.(true, true);
}

function scheduleInitialReconcile(graph) {
  const root = rootGraph(graph);
  if (!root) return;
  const previous = pendingInitialReconciles.get(root);
  if (previous) cancelAnimationFrame(previous);
  const frame = requestAnimationFrame(() => {
    if (pendingInitialReconciles.get(root) !== frame) return;
    pendingInitialReconciles.delete(root);
    reconcileLoadedWorkflow(root);
  });
  pendingInitialReconciles.set(root, frame);
}

function applyRegisteredNodeMetadata(nodeClass, metadata) {
  if (!nodeClass) return;
  nodeClass.category = CATEGORY;
  nodeClass.title = metadata.displayName;
  nodeClass.description = metadata.description;
  nodeClass.search_aliases = [...metadata.searchAliases];
}

function applyVueNodeMetadata(nodeDefs) {
  for (const nodeDef of nodeDefs || []) {
    const metadata = nodeDef?.name === SET_TYPE
      ? SET_METADATA
      : nodeDef?.name === GET_TYPE
        ? GET_METADATA
        : null;
    if (!metadata) continue;
    nodeDef.display_name = metadata.displayName;
    nodeDef.category = CATEGORY;
    nodeDef.description = metadata.description;
    nodeDef.search_aliases = [...metadata.searchAliases];
  }
}

function registerSetNode() {
  const existing = LiteGraph.registered_node_types?.[SET_TYPE];
  if (existing?.__inteliwebImplementationVersion === IMPLEMENTATION_VERSION) {
    applyRegisteredNodeMetadata(existing, SET_METADATA);
    return;
  }

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
      applySetType(this, type);
    }

    validateName(graph, sameGraphOnly = false) {
      const widget = variableWidget(this);
      let value = String(widget?.value || "").trim();
      if (!value) return false;

      const index = getGraphIndex(graph);
      const existingNames = new Set();
      const scopeGraphs = sameGraphOnly ? [graph] : index.ancestorsOf(graph);
      for (const candidateGraph of scopeGraphs) {
        for (const [name, node] of index.setsByGraph.get(candidateGraph) || []) {
          if (node !== this) existingNames.add(name);
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
      const oldIndex = getGraphIndex(this.graph);
      const adoptedType = setterType(this);
      this.setAdoptedType(adoptedType);
      propagateSetRename(this, previousName, name, oldIndex);
      this.properties.previousName = name;
      setVariableName(this, name);
      this.refreshTitle();

      invalidateGraphIndex(this.graph);
      const newIndex = getGraphIndex(this.graph);
      for (const getter of gettersOwnedBy(this, newIndex)) {
        getter.currentSetter = this;
        getter.setType?.(adoptedType);
        getter.refreshTitle?.();
      }
      refreshGetCombosForScope(this.graph, newIndex);
      app.canvas?.setDirty?.(true, true);
    }

    onConnectionsChange(slotType, slot, isConnect, linkInfo) {
      ensureSetIntegrity(this);
      if (app.configuringGraph) return;

      let adoptedType = setterType(this);
      if (slotType === LiteGraph.INPUT) {
        adoptedType = isConnect
          ? sourceTypeFromLink(this, linkInfo) || this.inputs?.[0]?.type || "*"
          : this.outputs?.[0]?.links?.length ? this.outputs[0].type : "*";
      } else if (slotType === LiteGraph.OUTPUT && adoptedType === "*") {
        adoptedType = isConnect ? targetTypeFromLink(this, linkInfo) || "*" : "*";
      }
      this.setAdoptedType(adoptedType);

      invalidateGraphIndex(this.graph);
      const index = getGraphIndex(this.graph);
      for (const getter of gettersOwnedBy(this, index)) {
        getter.currentSetter = this;
        getter.setType?.(adoptedType);
        getter.refreshTitle?.();
        getter._refreshComboOptions?.(false, index);
      }
      app.canvas?.setDirty?.(true, true);
    }

    getInputLink() {
      const input = firstWiredInput(this);
      return input?.link != null ? getLink(this.graph, input.link) : null;
    }

    onAdded() {
      this._justAdded = true;
      ensureSetIntegrity(this);
      if (!this.graph || app.configuringGraph) return;
      invalidateGraphIndex(this.graph);
      const index = getGraphIndex(this.graph);
      refreshGetCombosForScope(this.graph, index);
    }

    onRemoved() {
      const graph = this.graph;
      if (!graph) return;
      setTimeout(() => {
        invalidateGraphIndex(graph);
        const index = getGraphIndex(graph);
        refreshGetCombosForScope(graph, index);
        app.canvas?.setDirty?.(true, true);
      }, 0);
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
      reconcileSetLocal(this);
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
      const index = getGraphIndex(this.graph);
      const getters = gettersOwnedBy(this, index);
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
  applyRegisteredNodeMetadata(SetInteliwebNode, SET_METADATA);
}

function registerGetNode() {
  const existing = LiteGraph.registered_node_types?.[GET_TYPE];
  if (existing?.__inteliwebImplementationVersion === IMPLEMENTATION_VERSION) {
    applyRegisteredNodeMetadata(existing, GET_METADATA);
    return;
  }

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
      this._primeComboOptions = (index = getGraphIndex(this.graph)) => {
        const values = getOptionValues(this, index);
        this.__inteliwebOptionValues = values;
        this.__inteliwebOptionsSignature = values.join("\u0000");
      };

      this._refreshComboOptions = (force = false, index = getGraphIndex(this.graph)) => {
        ensureGetIntegrity(this);
        const widget = variableWidget(this);
        if (!widget || this.__inteliwebRefreshingCombo) return false;

        const values = getOptionValues(this, index);
        const signature = values.join("\u0000");
        if (!force && signature === this.__inteliwebOptionsSignature) return false;

        const currentName = nodeVariableName(this);
        this.__inteliwebRefreshingCombo = true;
        try {
          this.__inteliwebOptionValues = values;
          this.__inteliwebOptionsSignature = signature;
          const options = makeGetComboOptions(this);
          this.__inteliwebComboOptions = options;
          widget.options = options;
          attachClassicComboMenu(this, widget);

          if (LiteGraph.vueNodesMode) {
            const widgetIndex = this.widgets.indexOf(widget);
            if (widgetIndex >= 0) {
              this.widgets.splice(widgetIndex, 1);
              this.widgets.splice(widgetIndex, 0, widget);
            }
          }
          if (currentName) setVariableName(this, currentName);
        } finally {
          this.__inteliwebRefreshingCombo = false;
        }
        return true;
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

    setType(type, { validateLinks = true } = {}) {
      const adopted = type || "*";
      if (this.outputs?.[0]) {
        this.outputs[0].type = adopted;
        this.outputs[0].name = adopted;
        this.outputs[0].label = adopted;
      }
      applyTypeColor(this, adopted);
      if (validateLinks) this.validateLinks();
    }

    onRename() {
      if (this.__inteliwebRefreshingCombo || this.__inteliwebRepairing) return;
      const name = nodeVariableName(this);
      if (name) setVariableName(this, name);
      invalidateGraphIndex(this.graph);
      const index = getGraphIndex(this.graph);
      reconcileGetLocal(this, index, { refreshOptions: true, validateLinks: true });
      app.canvas?.setDirty?.(true, true);
    }

    onConnectionsChange() {
      if (app.configuringGraph) return;
      const index = getGraphIndex(this.graph);
      this._refreshComboOptions?.(false, index);
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
      const index = getGraphIndex(this.graph);
      const result = findSetter(this.graph, nodeVariableName(this), index);
      if (!result || result.graph !== this.graph) return null;
      const input = firstWiredInput(result.node);
      return input?.link != null ? getLink(result.graph, input.link) : null;
    }

    resolveVirtualOutput() {
      const index = getGraphIndex(this.graph);
      const result = findSetter(this.graph, nodeVariableName(this), index);
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
      if (!this.graph || app.configuringGraph) return;
      queueMicrotask(() => {
        invalidateGraphIndex(this.graph);
        const index = getGraphIndex(this.graph);
        reconcileGetLocal(this, index);
        app.canvas?.setDirty?.(true, true);
      });
    }

    onRemoved() {
      const graph = this.graph;
      if (graph) setTimeout(() => invalidateGraphIndex(graph), 0);
    }

    onConfigure(serializedData) {
      ensureGetIntegrity(this, serializedData);
      this._installRefreshCombo();
      if (this._justAdded && !app.configuringGraph) {
        const renamed = pasteRenameMap.get(nodeVariableName(this));
        if (renamed) setVariableName(this, renamed);
      }
      this._justAdded = false;
      if (!app.configuringGraph && this.graph) {
        invalidateGraphIndex(this.graph);
        reconcileGetLocal(this, getGraphIndex(this.graph));
      }
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
  applyRegisteredNodeMetadata(GetInteliwebNode, GET_METADATA);
}

function installSubgraphConvertedListener() {
  const canvasElement = app.canvas?.canvas;
  if (!canvasElement || canvasElement._inteliwebSetGetSubgraphListener) return;
  canvasElement._inteliwebSetGetSubgraphListener = true;
  canvasElement.addEventListener("subgraph-converted", (event) => {
    const subgraph = event?.detail?.subgraphNode?.subgraph;
    invalidateGraphIndex(subgraph || app.graph);
    scheduleInitialReconcile(subgraph || app.graph);
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

  beforeRegisterVueAppNodeDefs(nodeDefs) {
    applyVueNodeMetadata(nodeDefs);
  },

  registerCustomNodes() {
    registerSetNode();
    registerGetNode();
  },

  nodeCreated(node) {
    if (isSetNode(node)) ensureSetIntegrity(node);
    else if (isGetNode(node)) {
      ensureGetIntegrity(node);
      node._installRefreshCombo?.();
    }
  },

  loadedGraphNode(node) {
    if (isSetNode(node)) ensureSetIntegrity(node);
    else if (isGetNode(node)) {
      ensureGetIntegrity(node);
      node._installRefreshCombo?.();
    }
  },

  setup() {
    applyRegisteredNodeMetadata(LiteGraph.registered_node_types?.[SET_TYPE], SET_METADATA);
    applyRegisteredNodeMetadata(LiteGraph.registered_node_types?.[GET_TYPE], GET_METADATA);
    installSubgraphConvertedListener();
  },

  afterConfigureGraph() {
    installSubgraphConvertedListener();
    scheduleInitialReconcile(app.graph);
  },
});