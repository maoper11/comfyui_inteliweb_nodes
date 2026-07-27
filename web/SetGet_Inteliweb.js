import { app } from "../../scripts/app.js";

const SET_TYPE = "SetInteliweb";
const GET_TYPE = "GetInteliweb";
const CATEGORY = "Inteliweb/Logic";
const PACKAGE_ID = "maoper11/comfyui_inteliweb_nodes";
const SETTING_PREFIX = "Inteliweb.SetGet.";

const defaults = {
  filterGetOptionsByType: true,
  autoColor: true,
};

// Coordinates Set/Get renames during a single paste operation.
const pasteRenameMap = new Map();
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
    if (typeof linkInfo.resolve === "function") {
      return linkInfo.resolve(node.graph) || null;
    }
  } catch {
    // Older LiteGraph builds are handled by direct slot inspection below.
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

  return input?.type
    || setter?.inputs?.[0]?.type
    || setter?.outputs?.[0]?.type
    || "*";
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

  // Nearest scope wins: current graph, then parent, then root.
  for (const candidateGraph of graphAncestors(graph)) {
    for (const setter of nodesOfType(candidateGraph, SET_TYPE)) {
      const name = nodeVariableName(setter);
      if (!name || seen.has(name)) continue;

      // A local Set shadows a parent Set with the same name even when incompatible.
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
  const palette = globalThis.LGraphCanvas?.node_colors || {};
  const colors = getTypeColorMap()[primaryType] || palette.gray;
  if (!colors) return;

  node.color = colors.color ?? null;
  node.bgcolor = colors.bgcolor ?? null;
}

function menuEntryColor(canvas, type) {
  const primaryType = normalizeTypes(type)[0] || "DEFAULT";
  const mapped = getTypeColorMap()[primaryType];
  return canvas?.default_connection_color_byType?.[primaryType]
    || globalThis.LGraphCanvas?.link_type_colors?.[primaryType]
    || mapped?.groupcolor
    || mapped?.bgcolor
    || mapped?.color
    || "#888";
}

function gettersOwnedBy(setter) {
  if (!setter?.graph) return [];
  const name = nodeVariableName(setter);
  if (!name) return [];

  const result = [];
  for (const graph of allGraphs(setter.graph)) {
    for (const getter of nodesOfType(graph, GET_TYPE)) {
      const resolved = findSetter(graph, nodeVariableName(getter));
      if (resolved?.node === setter) result.push(getter);
    }
  }
  return result;
}

function remainingOutputTargetType(node) {
  for (const linkId of node?.outputs?.[0]?.links || []) {
    const link = getLink(node.graph, linkId);
    const type = targetTypeFromLink(node, link);
    if (type) return type;
  }
  return null;
}

function refreshAllGetCombos(graph) {
  for (const candidateGraph of allGraphs(graph)) {
    for (const getter of nodesOfType(candidateGraph, GET_TYPE)) {
      getter._refreshComboOptions?.();
    }
  }
  app.canvas?.setDirty?.(true, true);
}

function refreshAllNodeColors(graph) {
  for (const candidateGraph of allGraphs(graph)) {
    for (const setter of nodesOfType(candidateGraph, SET_TYPE)) {
      applyTypeColor(setter, setterType(setter));
    }
    for (const getter of nodesOfType(candidateGraph, GET_TYPE)) {
      applyTypeColor(getter, getter.outputs?.[0]?.type || "*");
    }
  }
  app.canvas?.setDirty?.(true, true);
}

function updateGettersAfterSetRename(setter, previousName, newName) {
  if (!setter?.graph || !previousName || previousName === newName) return;

  for (const graph of allGraphs(setter.graph)) {
    if (!isGraphAncestor(setter.graph, graph)) continue;

    for (const getter of nodesOfType(graph, GET_TYPE)) {
      if (nodeVariableName(getter) !== previousName) continue;

      // Do not steal a Get that is still owned by another Set with the old name.
      if (!findSetter(graph, previousName)) getter.setName?.(newName);
    }
  }
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

  for (const getter of gettersOwnedBy(node)) reconcileGet(getter);
  refreshAllGetCombos(node.graph);
}

function reconcileGet(node) {
  if (!node?.graph) return;

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

function registerSetNode() {
  const LGraphNode = LiteGraph.LGraphNode;

  class SetInteliwebNode extends LGraphNode {
    static title = "Set (Inteliweb)";
    static category = CATEGORY;

    constructor(title) {
      super(title);
      this.isVirtualNode = true;
      this.serialize_widgets = true;
      this.comfyClass = SET_TYPE;
      this.properties ||= {};
      this.properties.previousName ||= "";
      this.properties.inteliwebVariableName ||= "";
      this.properties["Node name for S&R"] = SET_TYPE;
      this.properties.aux_id = PACKAGE_ID;

      this.addWidget("text", "name", "", () => {
        if (!this.graph || app.configuringGraph) return;
        this.validateName(this.graph);
        this.updateVariable();
      });

      this.addInput("value", "*");
      this.addOutput("*", "*");
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
      let value = nodeVariableName(this);
      if (!value) return false;

      const existing = new Set();
      const scope = sameGraphOnly ? [graph] : graphAncestors(graph);
      for (const candidateGraph of scope) {
        for (const node of nodesOfType(candidateGraph, SET_TYPE)) {
          if (node !== this) existing.add(nodeVariableName(node));
        }
      }

      const original = value;
      const base = this._justAdded ? value.replace(/_\d+$/, "") : value;
      let suffix = 1;
      while (existing.has(value)) value = `${base}_${suffix++}`;

      this.widgets[0].value = value;
      return value !== original;
    }

    updateVariable() {
      if (!this.graph) return;

      const name = nodeVariableName(this);
      const previousName = this.properties.previousName || "";
      const adoptedType = setterType(this);
      this.setAdoptedType(adoptedType);

      updateGettersAfterSetRename(this, previousName, name);
      this.properties.previousName = name;
      this.properties.inteliwebVariableName = name;
      this.refreshTitle();

      for (const getter of gettersOwnedBy(this)) getter.setType?.(adoptedType);
      refreshAllGetCombos(this.graph);
      app.canvas?.setDirty?.(true, true);
    }

    onConnectionsChange(slotType, slot, isConnect, linkInfo) {
      // During ComfyUI multiClone(), a detached node is configured before its
      // subgraph links exist. Preserve the concrete serialized type instead of
      // replacing it with wildcard "*".
      if (isConnect && (!this.graph || !linkInfo)) {
        const preserved = this.inputs?.[0]?.type || this.outputs?.[0]?.type || "*";
        this.setAdoptedType(preserved);
        return;
      }

      if (app.configuringGraph) return;

      if (slotType === LiteGraph.INPUT) {
        if (isConnect) {
          this.setAdoptedType(
            sourceTypeFromLink(this, linkInfo)
              || this.inputs?.[0]?.type
              || this.outputs?.[0]?.type
              || "*",
          );
        } else {
          this.setAdoptedType(remainingOutputTargetType(this) || "*");
        }
      } else if (slotType === LiteGraph.OUTPUT) {
        const inputType = setterType(this);
        if (inputType && inputType !== "*") {
          this.setAdoptedType(inputType);
        } else if (isConnect) {
          this.setAdoptedType(
            targetTypeFromLink(this, linkInfo)
              || this.outputs?.[0]?.type
              || this.inputs?.[0]?.type
              || "*",
          );
        } else {
          this.setAdoptedType(remainingOutputTargetType(this) || "*");
        }
      }

      this.updateVariable();
    }

    // Passthrough output resolves directly to the real upstream source.
    getInputLink() {
      const input = firstWiredInput(this);
      return input?.link != null ? getLink(this.graph, input.link) : null;
    }

    onAdded() {
      this._justAdded = true;
      if (LiteGraph.vueNodesMode && this.graph && !app.configuringGraph) {
        refreshAllGetCombos(this.graph);
      }
    }

    onRemoved() {
      const graph = this.graph;
      const oldName = nodeVariableName(this);
      if (!graph) return;

      setTimeout(() => {
        refreshAllGetCombos(graph);
        for (const candidateGraph of allGraphs(graph)) {
          for (const getter of nodesOfType(candidateGraph, GET_TYPE)) {
            if (nodeVariableName(getter) === oldName) getter.onRename?.();
          }
        }
      }, 0);
    }

    onConfigure() {
      const savedName = this.properties.inteliwebVariableName;
      if (savedName && !nodeVariableName(this)) this.widgets[0].value = savedName;

      if (this._justAdded && this.graph && !app.configuringGraph) {
        const oldName = nodeVariableName(this);
        this.validateName(this.graph, true);
        const newName = nodeVariableName(this);
        if (oldName && newName !== oldName) {
          pasteRenameMap.set(oldName, newName);
          setTimeout(() => pasteRenameMap.delete(oldName), 0);
        }
      }

      const preservedType = firstWiredInput(this)?.type
        || this.inputs?.[0]?.type
        || this.outputs?.[0]?.type
        || "*";
      this.setAdoptedType(preservedType);
      this._justAdded = false;
      this.properties.previousName = nodeVariableName(this);
      this.properties.inteliwebVariableName = nodeVariableName(this);
      this.refreshTitle();
      queueMicrotask(() => reconcileSet(this));
    }

    onGraphConfigured() {
      queueMicrotask(() => reconcileSet(this));
    }

    onAfterGraphConfigured() {
      setTimeout(() => reconcileSet(this), 0);
    }

    clone() {
      const cloned = super.clone();
      if (!cloned) return cloned;
      cloned.properties.previousName = "";
      if (cloned.inputs?.[0]) {
        cloned.inputs[0].type = "*";
        cloned.inputs[0].label = "*";
      }
      if (cloned.outputs?.[0]) {
        cloned.outputs[0].type = "*";
        cloned.outputs[0].name = "*";
      }
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
  const LGraphNode = LiteGraph.LGraphNode;

  class GetInteliwebNode extends LGraphNode {
    static title = "Get (Inteliweb)";
    static category = CATEGORY;

    constructor(title) {
      super(title);
      this.isVirtualNode = true;
      this.serialize_widgets = true;
      this.comfyClass = GET_TYPE;
      this.properties ||= {};
      this.properties.inteliwebVariableName ||= "";
      this.properties["Node name for S&R"] = GET_TYPE;
      this.properties.aux_id = PACKAGE_ID;
      this.currentSetter = null;

      const comboOptions = {};
      Object.defineProperty(comboOptions, "values", {
        get: () => {
          if (!this.graph) return [];

          const current = nodeVariableName(this);
          const targetTypes = readSetting("filterGetOptionsByType")
            ? connectedTargetTypes(this)
            : [];
          const names = visibleSetNames(this.graph, targetTypes);

          return !targetTypes.length && current && !names.includes(current)
            ? [current, ...names]
            : names;
        },
        enumerable: true,
        configurable: true,
      });

      const widget = this.addWidget("combo", "name", "", () => {
        if (!app.configuringGraph) this.onRename();
      }, comboOptions);

      // Classic renderer needs an explicit menu when values use a dynamic getter.
      const originalOnClick = widget.onClick?.bind(widget);
      widget.onClick = (params) => {
        if (LiteGraph.vueNodesMode) return originalOnClick?.(params);

        const { e, canvas, node } = params;
        const x = e.canvasX - node.pos[0];
        const width = widget.width || node.size[0];
        if (x < 40) return widget.decrementValue?.({ e, node, canvas });
        if (x > width - 40) return widget.incrementValue?.({ e, node, canvas });

        const values = comboOptions.values;
        if (!values.length) return;
        const menu = new LiteGraph.ContextMenu(values, {
          scale: Math.max(1, canvas.ds?.scale || 1),
          event: e,
          className: "dark",
          callback: (value) => widget.setValue?.(value, { e, node, canvas }),
        });

        const entries = menu.root?.querySelectorAll?.(".litemenu-entry");
        values.forEach((name, index) => {
          const entry = entries?.[index];
          if (!entry) return;
          const setter = findSetter(this.graph, name)?.node;
          entry.style.borderLeft = `4px solid ${menuEntryColor(canvas, setterType(setter))}`;
          entry.style.paddingLeft = "8px";
        });
      };

      this._refreshComboOptions = () => {
        const currentWidget = this.widgets?.[0];
        if (!currentWidget) return;

        const freshOptions = {};
        Object.defineProperty(
          freshOptions,
          "values",
          Object.getOwnPropertyDescriptor(comboOptions, "values"),
        );
        currentWidget.options = freshOptions;

        // Nodes 2.0 re-extracts combo values when the widget is reinserted.
        const index = this.widgets.indexOf(currentWidget);
        if (index >= 0) {
          this.widgets.splice(index, 1);
          this.widgets.splice(index, 0, currentWidget);
        }
      };

      this.addOutput("*", "*");
      this.refreshTitle();
    }

    refreshTitle() {
      const name = nodeVariableName(this);
      this.title = name ? `Get: ${name}` : "Get (Inteliweb)";
    }

    setName(name) {
      const value = String(name || "").trim();
      this.widgets[0].value = value;
      this.properties.inteliwebVariableName = value;
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
      const name = nodeVariableName(this);
      if (name) this.properties.inteliwebVariableName = name;

      const result = findSetter(this.graph, name);
      this.currentSetter = result?.node || null;
      if (result?.node) this.setType(setterType(result.node));
      else this.setType("*");

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
        const link = getLink(this.graph, linkId);
        const targetType = targetTypeFromLink(this, link);
        if (!targetType || targetType === "*") continue;
        if (!typesAreCompatible(output.type, targetType)) this.graph.removeLink?.(linkId);
      }
    }

    // Same-graph prompt resolution.
    getInputLink() {
      const result = findSetter(this.graph, nodeVariableName(this));
      if (!result || result.graph !== this.graph) return null;
      const input = firstWiredInput(result.node);
      return input?.link != null ? getLink(result.graph, input.link) : null;
    }

    // Subgraph-aware prompt resolution available in modern ComfyUI.
    resolveVirtualOutput() {
      const result = findSetter(this.graph, nodeVariableName(this));
      if (!result || result.graph === this.graph) return undefined;

      const input = firstWiredInput(result.node);
      if (input?.link == null) return undefined;
      const link = getLink(result.graph, input.link);
      if (!link) return undefined;

      const resolved = resolveLink(result.node, link);
      const source = resolved?.outputNode
        || result.graph.getNodeById?.(link.origin_id);
      const slot = resolved?.output
        ? source?.outputs?.indexOf?.(resolved.output)
        : link.origin_slot;
      return source ? { node: source, slot: slot ?? link.origin_slot } : undefined;
    }

    onAdded() {
      this._justAdded = true;
    }

    onConfigure() {
      const savedName = this.properties.inteliwebVariableName;
      if (savedName && !nodeVariableName(this)) this.widgets[0].value = savedName;

      if (this._justAdded && !app.configuringGraph) {
        const renamed = pasteRenameMap.get(nodeVariableName(this));
        if (renamed) this.widgets[0].value = renamed;
      }

      this.properties.inteliwebVariableName = nodeVariableName(this);
      this._justAdded = false;
      queueMicrotask(() => reconcileGet(this));
    }

    onGraphConfigured() {
      queueMicrotask(() => reconcileGet(this));
    }

    onAfterGraphConfigured() {
      setTimeout(() => reconcileGet(this), 0);
    }

    clone() {
      const cloned = super.clone();
      if (!cloned) return cloned;
      if (cloned.outputs?.[0]) {
        cloned.outputs[0].type = "*";
        cloned.outputs[0].name = "*";
      }
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
    queueMicrotask(() => reconcileGraph(subgraph || app.graph));
    setTimeout(() => reconcileGraph(subgraph || app.graph), 0);
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
      queueMicrotask(() => reconcileSet(node));
    } else if (node?.type === GET_TYPE || node?.comfyClass === GET_TYPE) {
      queueMicrotask(() => reconcileGet(node));
    }
  },

  setup() {
    installSubgraphConvertedListener();
    setTimeout(() => {
      installSubgraphConvertedListener();
      reconcileGraph(app.graph);
    }, 0);
  },
});
