import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "Inteliweb.GroupHeaderQueueFix";
const QUEUE_COMMAND = "Comfy.QueueSelectedOutputNodes";

const state = {
  queueNodeIds: null,
  commandManager: null,
  originalCommandExecute: null,
  apiWrapped: false,
};

function isNode(item) {
  return Boolean(
    item &&
    typeof item === "object" &&
    (
      "mode" in item ||
      Array.isArray(item.inputs) ||
      Array.isArray(item.outputs) ||
      item.constructor?.nodeData
    )
  );
}

function isOutputNode(node) {
  const never = globalThis.LiteGraph?.NEVER ?? 2;
  return Boolean(
    node?.mode !== never &&
    (
      node?.constructor?.nodeData?.output_node ||
      node?.constructor?.nodeData?.outputNode ||
      node?.output_node
    )
  );
}

function selectedNodes(canvas = app.canvas) {
  const result = [];
  const visited = new Set();

  const add = (item) => {
    if (!isNode(item) || visited.has(item)) return;
    visited.add(item);
    result.push(item);
  };

  const selectedItems = canvas?.selectedItems;
  if (selectedItems?.[Symbol.iterator]) {
    for (const item of selectedItems) add(item);
  }

  for (const item of Object.values(canvas?.selected_nodes || {})) add(item);
  return result;
}

function groupNodes(group, recompute = false) {
  if (!group) return [];

  if (recompute) {
    try {
      group.recomputeInsideNodes?.();
    } catch (error) {
      console.warn("[Inteliweb] Could not recompute group members before queueing:", error);
    }
  }

  const result = [];
  const visitedNodes = new Set();
  const visitedGroups = new Set();

  const addNode = (node) => {
    if (!isNode(node) || visitedNodes.has(node)) return;
    visitedNodes.add(node);
    result.push(node);

    const childNodes = node.subgraph?._nodes || node.subgraph?.nodes;
    if (childNodes?.[Symbol.iterator]) {
      for (const child of childNodes) addNode(child);
    }
  };

  const addGroup = (candidate) => {
    if (!candidate || visitedGroups.has(candidate)) return;
    visitedGroups.add(candidate);

    const children = candidate.children || candidate._children;
    if (children?.[Symbol.iterator]) {
      for (const item of children) {
        if (isNode(item)) addNode(item);
        else if (item?.children || item?._children || item?._groups) addGroup(item);
      }
    }

    const fallbackNodes = Array.isArray(candidate.nodes)
      ? candidate.nodes
      : Array.isArray(candidate._nodes)
        ? candidate._nodes
        : [];
    for (const node of fallbackNodes) addNode(node);
  };

  addGroup(group);
  return result;
}

function graphGroups() {
  const graph = app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph;
  const groups = graph?._groups || graph?.groups;
  if (Array.isArray(groups)) return groups;
  if (groups?.values) return [...groups.values()];
  return [];
}

function sameNodeSet(left, right) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right.map((node) => String(node.id)));
  return left.every((node) => rightIds.has(String(node.id)));
}

function selectedGroupOutputs() {
  const outputs = selectedNodes().filter(isOutputNode);
  if (!outputs.length) return null;

  // The Inteliweb Run button temporarily selects every active output in one group.
  // Restrict the compatibility path to exactly that shape so normal queue commands
  // elsewhere in ComfyUI keep their native behavior.
  for (const group of graphGroups()) {
    const outputsInGroup = groupNodes(group, true).filter(isOutputNode);
    if (outputsInGroup.length && sameNodeSet(outputs, outputsInGroup)) return outputsInGroup;
  }

  return null;
}

function recursivelyAddUpstream(nodeId, oldOutput, newOutput, visiting = new Set()) {
  const currentId = String(nodeId);
  if (newOutput[currentId] != null || visiting.has(currentId)) return;

  const currentNode = oldOutput?.[currentId];
  if (!currentNode) return;

  visiting.add(currentId);
  newOutput[currentId] = currentNode;

  for (const inputValue of Object.values(currentNode.inputs || {})) {
    if (Array.isArray(inputValue) && inputValue.length) {
      recursivelyAddUpstream(inputValue[0], oldOutput, newOutput, visiting);
    }
  }

  visiting.delete(currentId);
}

function installApiQueueFilter() {
  if (state.apiWrapped || api.queuePrompt?.__inteliwebGroupQueueFilter) return;

  const originalQueuePrompt = api.queuePrompt;
  if (typeof originalQueuePrompt !== "function") return;

  const wrappedQueuePrompt = async function (index, prompt, ...args) {
    if (state.queueNodeIds?.length && prompt?.output) {
      const oldOutput = prompt.output;
      const newOutput = {};

      for (const nodeId of state.queueNodeIds) {
        recursivelyAddUpstream(nodeId, oldOutput, newOutput);
      }

      prompt.output = newOutput;
    }

    return await originalQueuePrompt.call(this, index, prompt, ...args);
  };

  wrappedQueuePrompt.__inteliwebGroupQueueFilter = true;
  wrappedQueuePrompt.__inteliwebOriginalQueuePrompt = originalQueuePrompt;
  api.queuePrompt = wrappedQueuePrompt;
  state.apiWrapped = true;
}

async function queueGroupOutputs(outputs) {
  // Prefer rgthree's mature implementation when it is installed. It queues all
  // requested output branches through app.queuePrompt, preserving seed updates.
  if (typeof window.rgthree?.queueOutputNodes === "function") {
    await window.rgthree.queueOutputNodes(outputs);
    return;
  }

  const nodeIds = [...new Set(outputs.map((node) => String(node.id)))];
  if (!nodeIds.length || typeof app.queuePrompt !== "function") {
    throw new Error("ComfyUI queuePrompt is unavailable.");
  }

  installApiQueueFilter();
  state.queueNodeIds = nodeIds;
  try {
    // Calling the normal application queue lifecycle is important: seed widgets
    // configured as randomize/increment/decrement update during this serialization.
    await app.queuePrompt(0);
  } finally {
    state.queueNodeIds = null;
  }
}

function installCommandHook() {
  const command = app.extensionManager?.command;
  if (!command || typeof command.execute !== "function") return false;
  if (command.execute.__inteliwebGroupHeaderQueueFix) return true;

  const originalExecute = command.execute.bind(command);
  const wrappedExecute = async function (commandId, ...args) {
    if (commandId === QUEUE_COMMAND) {
      const outputs = selectedGroupOutputs();
      if (outputs?.length) {
        try {
          await queueGroupOutputs(outputs);
          return;
        } catch (error) {
          console.error("[Inteliweb] Group output queue compatibility path failed:", error);
          // Preserve ComfyUI's native command as a safe fallback.
        }
      }
    }

    return await originalExecute(commandId, ...args);
  };

  wrappedExecute.__inteliwebGroupHeaderQueueFix = true;
  wrappedExecute.__inteliwebOriginalExecute = originalExecute;
  command.execute = wrappedExecute;

  state.commandManager = command;
  state.originalCommandExecute = originalExecute;
  return true;
}

function startIntegration() {
  installApiQueueFilter();
  if (installCommandHook()) return;

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    installApiQueueFilter();
    if (installCommandHook() || attempts >= 120) clearInterval(timer);
  }, 250);
}

app.registerExtension({
  name: EXTENSION_NAME,
  setup() {
    startIntegration();
  },
});
