import { app } from "../../scripts/app.js";

const SET_TYPE = "SetInteliweb";
const GET_TYPE = "GetInteliweb";
const CATEGORY = "Inteliweb/Logic";
const PACKAGE_ID = "maoper11/comfyui_inteliweb_nodes";

// Coordinates Set/Get renames during a single paste operation.
const pasteRenameMap = new Map();

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  if (graph.links instanceof Map) return graph.links.get(linkId) || null;
  if (graph.links?.[linkId]) return graph.links[linkId];
  if (graph._links instanceof Map) return graph._links.get(linkId) || null;
  return graph._links?.[linkId] || null;
}

function rootGraph(graph) {
  return graph?.rootGraph || graph || null;
}

function directChildGraphs(graph) {
  if (!graph?._nodes) return [];
  const result = [];
  for (const node of graph._nodes) {
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
    for (const node of candidate?._nodes || []) {
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
  return (graph?._nodes || []).filter((node) => node?.type === type);
}

function nodeVariableName(node) {
  return String(node?.widgets?.[0]?.value || "").trim();
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

function visibleSetNames(graph) {
  const names = [];
  const seen = new Set();

  // Nearest scope wins: current graph, then parent, then root.
  for (const candidateGraph of graphAncestors(graph)) {
    for (const node of nodesOfType(candidateGraph, SET_TYPE)) {
      const name = nodeVariableName(node);
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }

  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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

function firstWiredInput(node) {
  if (!node?.inputs) return null;
  for (let index = 0; index < node.inputs.length; index++) {
    const input = node.inputs[index];
    if (input?.link != null) return { ...input, index };
  }
  return null;
}

function sourceTypeFromLink(node, linkInfo) {
  if (!node?.graph || !linkInfo) return null;

  try {
    if (typeof linkInfo.resolve === "function") {
      const resolved = linkInfo.resolve(node.graph);
      const slot = resolved?.subgraphInput ?? resolved?.output;
      if (slot?.type) return slot.type;
    }
  } catch {
    // Fall back to direct link inspection below.
  }

  const source = node.graph.getNodeById?.(linkInfo.origin_id);
  return source?.outputs?.[linkInfo.origin_slot]?.type || null;
}

function targetTypeFromLink(node, linkInfo) {
  if (!node?.graph || !linkInfo) return null;

  try {
    if (typeof linkInfo.resolve === "function") {
      const resolved = linkInfo.resolve(node.graph);
      if (resolved?.input?.type) return resolved.input.type;
    }
  } catch {
    // Fall back to direct link inspection below.
  }

  const target = node.graph.getNodeById?.(linkInfo.target_id);
  return target?.inputs?.[linkInfo.target_slot]?.type || null;
}

function refreshAllGetCombos(graph) {
  for (const candidateGraph of allGraphs(graph)) {
    for (const getter of nodesOfType(candidateGraph, GET_TYPE)) {
      getter._refreshComboOptions?.();
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

      // Stable input name avoids duplicate/phantom slots during renderer rebuilds.
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
      const adoptedType = firstWiredInput(this)?.type || this.inputs?.[0]?.type || "*";
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
      if (app.configuringGraph) return;

      if (slotType === LiteGraph.INPUT) {
        if (isConnect) this.setAdoptedType(sourceTypeFromLink(this, linkInfo) || "*");
        else this.setAdoptedType("*");
      } else if (slotType === LiteGraph.OUTPUT && isConnect) {
        const current = this.inputs?.[0]?.type;
        if (!current || current === "*") {
          this.setAdoptedType(targetTypeFromLink(this, linkInfo) || "*");
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

      const input = firstWiredInput(this);
      this.setAdoptedType(input?.type || this.inputs?.[0]?.type || "*");
      this._justAdded = false;
      this.properties.previousName = nodeVariableName(this);
      this.properties.inteliwebVariableName = nodeVariableName(this);
      this.refreshTitle();
      setTimeout(() => this.updateVariable(), 0);
    }

    clone() {
      const cloned = super.clone();
      cloned.properties.previousName = "";
      if (cloned.inputs?.[0]) {
        cloned.inputs[0].type = "*";
        cloned.inputs[0].label = "*";
      }
      if (cloned.outputs?.[0]) {
        cloned.outputs[0].type = "*";
        cloned.outputs[0].name = "*";
      }
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
          const current = nodeVariableName(this);
          const names = this.graph ? visibleSetNames(this.graph) : [];
          return current && !names.includes(current) ? [current, ...names] : names;
        },
        enumerable: true,
        configurable: true,
      });

      const widget = this.addWidget("combo", "name", "", () => {
        if (!app.configuringGraph) this.onRename();
      }, comboOptions);

      // Classic renderer needs an explicit menu when values are provided by a getter.
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
        new LiteGraph.ContextMenu(values, {
          scale: Math.max(1, canvas.ds?.scale || 1),
          event: e,
          className: "dark",
          callback: (value) => widget.setValue?.(value, { e, node, canvas }),
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

        // Nodes 2.0 re-extracts combo values when the widget reference is reinserted.
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
      this.validateLinks();
    }

    onRename() {
      const name = nodeVariableName(this);
      if (name) this.properties.inteliwebVariableName = name;

      const result = findSetter(this.graph, name);
      this.currentSetter = result?.node || null;
      if (result?.node) {
        const type = firstWiredInput(result.node)?.type || result.node.inputs?.[0]?.type || "*";
        this.setType(type);
      } else {
        this.setType("*");
      }

      this.refreshTitle();
      app.canvas?.setDirty?.(true, true);
    }

    onConnectionsChange() {
      if (!app.configuringGraph) this.validateLinks();
    }

    validateLinks() {
      const output = this.outputs?.[0];
      if (!this.graph || !output?.links || output.type === "*") return;

      for (const linkId of [...output.links]) {
        const link = getLink(this.graph, linkId);
        if (!link) continue;
        const target = this.graph.getNodeById?.(link.target_id);
        const targetType = target?.inputs?.[link.target_slot]?.type;
        if (!targetType || targetType === "*") continue;

        const accepted = String(targetType).split(",");
        if (!accepted.includes(output.type)) this.graph.removeLink?.(linkId);
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

      const source = result.graph.getNodeById?.(link.origin_id);
      return source ? { node: source, slot: link.origin_slot } : undefined;
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
      setTimeout(() => {
        if (this.graph) this.onRename();
      }, 0);
    }

    clone() {
      const cloned = super.clone();
      if (cloned.outputs?.[0]) {
        cloned.outputs[0].type = "*";
        cloned.outputs[0].name = "*";
      }
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

app.registerExtension({
  name: "Inteliweb.SetGet",
  registerCustomNodes() {
    registerSetNode();
    registerGetNode();
  },
});
