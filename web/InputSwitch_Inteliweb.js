import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebInputSwitch";
const PREFIX = "input";
const RESERVED = new Set(["select", "sel_mode"]);

function isDataInput(input) {
  return Boolean(input?.name?.startsWith(PREFIX)) && !RESERVED.has(input.name);
}

function dataInputs(node) {
  return Array.isArray(node.inputs) ? node.inputs.filter(isDataInput) : [];
}

function isGraphConfigureCall() {
  const stack = new Error().stack || "";
  return (
    stack.includes("loadGraphData") ||
    stack.includes("pasteFromClipboard") ||
    stack.includes("convertToSubgraph") ||
    stack.includes("Subgraph.configure")
  );
}

function selectedWidget(node) {
  return node.widgets?.find((widget) => widget.name === "select") ?? node.widgets?.[0];
}

function updateSelectRange(node) {
  const widget = selectedWidget(node);
  if (!widget?.options) return;
  const count = Math.max(1, dataInputs(node).length - 1);
  widget.options.min = 1;
  widget.options.max = count;
  widget.value = Math.min(Math.max(Number(widget.value) || 1, 1), count);
}

function connectedType(node) {
  for (const input of dataInputs(node)) {
    if (!input.link || !node.graph) continue;
    const link = node.graph.links?.get?.(input.link) ?? node.graph.links?.[input.link];
    if (!link) continue;
    const source = node.graph.getNodeById?.(link.origin_id);
    const type = source?.outputs?.[link.origin_slot]?.type ?? link.type;
    if (type && type !== "*") return type;
  }
  return "*";
}

function applyConcreteType(node, type) {
  const resolved = type || "*";
  for (const input of dataInputs(node)) input.type = resolved;
  if (node.outputs?.[0]) {
    node.outputs[0].type = resolved;
    node.outputs[0].name = resolved === "*" ? "selected_value" : resolved;
    node.outputs[0].label = resolved === "*" ? "selected_value" : resolved;
  }
}

function renameInputs(node) {
  let index = 1;
  for (const input of dataInputs(node)) {
    input.name = `${PREFIX}${index}`;
    if (!input.label || /^input\d+$/.test(input.label)) input.label = input.name;
    index += 1;
  }
}

function ensureTrailingInput(node) {
  const inputs = dataInputs(node);
  if (inputs.length === 0) {
    node.addInput(`${PREFIX}1`, "*");
    node.addInput(`${PREFIX}2`, "*");
    return;
  }

  const last = inputs[inputs.length - 1];
  if (last.link) node.addInput(`${PREFIX}${inputs.length + 1}`, last.type || "*");
}

function removeEmptyMiddleInputs(node) {
  const inputs = dataInputs(node);
  for (let i = inputs.length - 2; i >= 0; i -= 1) {
    const input = inputs[i];
    if (input.link) continue;
    const actualIndex = node.inputs.indexOf(input);
    if (actualIndex >= 0) node.removeInput(actualIndex);
  }
}

function normalizeNode(node) {
  removeEmptyMiddleInputs(node);
  renameInputs(node);
  ensureTrailingInput(node);
  applyConcreteType(node, connectedType(node));
  updateSelectRange(node);
  node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
  name: "inteliweb.input.switch",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;

    const originalConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (...args) {
      const result = originalConnectionsChange?.apply(this, args);
      if (isGraphConfigureCall()) {
        queueMicrotask(() => normalizeNode(this));
        return result;
      }

      const [, , , linkInfo] = args;
      if (!linkInfo) return result;
      queueMicrotask(() => normalizeNode(this));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalConfigure?.apply(this, args);
      queueMicrotask(() => normalizeNode(this));
      return result;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => normalizeNode(node));
  },
});
