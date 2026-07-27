import { app } from "../../scripts/app.js";

const SET_TYPE = "SetInteliweb";
const GET_TYPE = "GetInteliweb";
const SETTING_ID = "Inteliweb.SetGet.filterGetOptionsByType";

function readFilterSetting() {
  try {
    return app.ui?.settings?.getSettingValue?.(SETTING_ID) ?? true;
  } catch {
    return true;
  }
}

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  if (typeof graph.getLink === "function") return graph.getLink(linkId) || null;
  if (graph.links instanceof Map) return graph.links.get(linkId) || null;
  if (graph._links instanceof Map) return graph._links.get(linkId) || null;
  return graph.links?.[linkId] || graph._links?.[linkId] || null;
}

function rootGraph(graph) {
  return graph?.rootGraph || graph || null;
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

    for (const node of current._nodes || current.nodes || []) {
      if (node?.subgraph) queue.push(node.subgraph);
    }

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
    for (const node of candidate._nodes || candidate.nodes || []) {
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

function nodesOfType(graph, type) {
  return (graph?._nodes || graph?.nodes || []).filter((node) => node?.type === type);
}

function nodeVariableName(node) {
  return String(node?.widgets?.[0]?.value || "").trim();
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
  if (!targetType || targetType === "*") return true;
  if (!setType || setType === "*") return true;
  const available = new Set(normalizeTypes(setType));
  return normalizeTypes(targetType).some((type) => available.has(type));
}

function resolveLink(node, linkInfo) {
  if (!node?.graph || !linkInfo) return null;
  try {
    if (typeof linkInfo.resolve === "function") return linkInfo.resolve(node.graph) || null;
  } catch {
    // Direct inspection below is enough for older LiteGraph builds.
  }
  return null;
}

function sourceTypeFromLink(node, linkInfo) {
  if (!node?.graph || !linkInfo) return null;
  const resolved = resolveLink(node, linkInfo);
  const resolvedSlot = resolved?.subgraphInput ?? resolved?.output;
  if (resolvedSlot?.type) return String(resolvedSlot.type);

  const source = node.graph.getNodeById?.(linkInfo.origin_id);
  return source?.outputs?.[linkInfo.origin_slot]?.type || linkInfo.type || null;
}

function targetTypeFromLink(node, linkInfo) {
  if (!node?.graph || !linkInfo) return null;
  const resolved = resolveLink(node, linkInfo);
  const resolvedSlot = resolved?.input ?? resolved?.subgraphOutput;
  if (resolvedSlot?.type) return String(resolvedSlot.type);

  const target = node.graph.getNodeById?.(linkInfo.target_id);
  return target?.inputs?.[linkInfo.target_slot]?.type || linkInfo.type || null;
}

function connectedTargetTypes(node) {
  const result = new Set();
  for (const linkId of node?.outputs?.[0]?.links || []) {
    const link = getLink(node.graph, linkId);
    const type = targetTypeFromLink(node, link);
    if (type && type !== "*") result.add(type);
  }
  return [...result];
}

function setterType(setter) {
  const input = firstWiredInput(setter);
  if (input?.link != null && setter?.graph) {
    const link = getLink(setter.graph, input.link);
    const resolvedType = sourceTypeFromLink(setter, link);
    if (resolvedType && resolvedType !== "*") return resolvedType;
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
      if (targetTypes.length && !targetTypes.every((target) => typesAreCompatible(type, target))) {
        continue;
      }
      names.push(name);
    }
  }

  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function installGetComboFilter(node) {
  const widget = node?.widgets?.[0];
  if (!widget || widget._inteliwebSubgraphFilterInstalled) return;
  widget._inteliwebSubgraphFilterInstalled = true;

  const options = {};
  Object.defineProperty(options, "values", {
    get: () => {
      if (!node.graph) return [];
      const current = nodeVariableName(node);
      const targetTypes = readFilterSetting() ? connectedTargetTypes(node) : [];
      const names = visibleSetNames(node.graph, targetTypes);
      return !targetTypes.length && current && !names.includes(current)
        ? [current, ...names]
        : names;
    },
    enumerable: true,
    configurable: true,
  });

  widget.options = options;
  node._refreshComboOptions?.();
}

function reconcileSet(node) {
  if (!node?.graph) return;
  const input = firstWiredInput(node);
  const link = input?.link != null ? getLink(node.graph, input.link) : null;
  const type = sourceTypeFromLink(node, link)
    || input?.type
    || node.inputs?.[0]?.type
    || node.outputs?.[0]?.type
    || "*";

  node.setAdoptedType?.(type);
  node.properties ||= {};
  node.properties.previousName = nodeVariableName(node);
  node.properties.inteliwebVariableName = nodeVariableName(node);
  node.refreshTitle?.();

  for (const graph of allGraphs(node.graph)) {
    for (const getter of nodesOfType(graph, GET_TYPE)) {
      const resolved = findSetter(graph, nodeVariableName(getter));
      if (resolved?.node === node) reconcileGet(getter);
    }
  }
}

function reconcileGet(node) {
  if (!node?.graph) return;
  installGetComboFilter(node);
  const result = findSetter(node.graph, nodeVariableName(node));
  node.currentSetter = result?.node || null;
  node.setType?.(result?.node ? setterType(result.node) : "*");
  node.refreshTitle?.();
  node._refreshComboOptions?.();
}

function reconcileGraph(graph) {
  if (!graph) return;
  for (const candidate of allGraphs(graph)) {
    for (const setter of nodesOfType(candidate, SET_TYPE)) reconcileSet(setter);
    for (const getter of nodesOfType(candidate, GET_TYPE)) reconcileGet(getter);
  }
  app.canvas?.setDirty?.(true, true);
}

function patchSetPrototype() {
  const nodeType = globalThis.LiteGraph?.registered_node_types?.[SET_TYPE];
  const proto = nodeType?.prototype;
  if (!proto || proto._inteliwebSubgraphTypesPatched) return;
  proto._inteliwebSubgraphTypesPatched = true;

  const originalConnectionsChange = proto.onConnectionsChange;
  proto.onConnectionsChange = function (slotType, slot, isConnect, linkInfo, ...rest) {
    // During multiClone(), ComfyUI configures a detached node. Keep the concrete
    // serialized socket type instead of replacing it with wildcard "*".
    if (isConnect && (!this.graph || !linkInfo)) {
      const preserved = this.inputs?.[0]?.type || this.outputs?.[0]?.type || "*";
      this.setAdoptedType?.(preserved);
      return;
    }
    return originalConnectionsChange?.call(this, slotType, slot, isConnect, linkInfo, ...rest);
  };

  const originalConfigure = proto.onConfigure;
  proto.onConfigure = function (...args) {
    const result = originalConfigure?.apply(this, args);
    queueMicrotask(() => reconcileSet(this));
    return result;
  };

  proto.onGraphConfigured = function () {
    queueMicrotask(() => reconcileSet(this));
  };
  proto.onAfterGraphConfigured = function () {
    setTimeout(() => reconcileSet(this), 0);
  };
}

function patchGetPrototype() {
  const nodeType = globalThis.LiteGraph?.registered_node_types?.[GET_TYPE];
  const proto = nodeType?.prototype;
  if (!proto || proto._inteliwebSubgraphTypesPatched) return;
  proto._inteliwebSubgraphTypesPatched = true;

  proto.validateLinks = function () {
    const output = this.outputs?.[0];
    if (!this.graph || !output?.links || output.type === "*") return;

    for (const linkId of [...output.links]) {
      const link = getLink(this.graph, linkId);
      const targetType = targetTypeFromLink(this, link);
      if (!targetType || targetType === "*") continue;
      if (!typesAreCompatible(output.type, targetType)) this.graph.removeLink?.(linkId);
    }
  };

  const originalConnectionsChange = proto.onConnectionsChange;
  proto.onConnectionsChange = function (...args) {
    const result = originalConnectionsChange?.apply(this, args);
    installGetComboFilter(this);
    this._refreshComboOptions?.();
    return result;
  };

  const originalConfigure = proto.onConfigure;
  proto.onConfigure = function (...args) {
    const result = originalConfigure?.apply(this, args);
    queueMicrotask(() => reconcileGet(this));
    return result;
  };

  proto.onGraphConfigured = function () {
    queueMicrotask(() => reconcileGet(this));
  };
  proto.onAfterGraphConfigured = function () {
    setTimeout(() => reconcileGet(this), 0);
  };
}

function installSubgraphConvertedListener() {
  const canvasElement = app.canvas?.canvas;
  if (!canvasElement || canvasElement._inteliwebSetGetSubgraphListener) return;
  canvasElement._inteliwebSetGetSubgraphListener = true;
  canvasElement.addEventListener("subgraph-converted", (event) => {
    const subgraph = event?.detail?.subgraphNode?.subgraph;
    queueMicrotask(() => reconcileGraph(subgraph || app.graph));
    setTimeout(() => reconcileGraph(subgraph || app.graph), 0);
  });
}

function installPatches() {
  patchSetPrototype();
  patchGetPrototype();
  installSubgraphConvertedListener();
  reconcileGraph(app.graph);
}

app.registerExtension({
  name: "Inteliweb.SetGet.SubgraphTypesFix",

  nodeCreated(node) {
    if (node?.type === GET_TYPE) queueMicrotask(() => reconcileGet(node));
    if (node?.type === SET_TYPE) queueMicrotask(() => reconcileSet(node));
  },

  setup() {
    installPatches();
    setTimeout(installPatches, 0);
  },
});
