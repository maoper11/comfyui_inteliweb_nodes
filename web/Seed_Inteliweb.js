import { app } from "../../scripts/app.js";

const NODE_TYPE = "InteliwebSeed";
const STATE_KEY = "inteliwebSeed";
const RANDOM_SENTINEL = -1;
const SEED_MAX = 1125899906842624; // 2^50
const DESCRIPTION =
  "The seed controls image variation. Change it to create alternatives, or reuse it with the same settings to repeat a result.";

function clampSeed(value) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return null;
  if (number === RANDOM_SENTINEL) return RANDOM_SENTINEL;
  return Math.max(0, Math.min(SEED_MAX, number));
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    // 18 high bits + 32 low bits = an exactly representable 50-bit integer.
    return (values[0] & 0x3ffff) * 0x100000000 + values[1];
  }
  return Math.floor(Math.random() * SEED_MAX);
}

function readSeed(node) {
  const saved = clampSeed(node?.properties?.[STATE_KEY]);
  return saved == null ? RANDOM_SENTINEL : saved;
}

function writeSeed(node, seed) {
  node.properties ||= {};
  node.properties[STATE_KEY] = clampSeed(seed) ?? RANDOM_SENTINEL;
  refreshSeedUI(node);
  node.graph?.change?.();
  app.canvas?.setDirty?.(true, true);
}

function displaySeed(seed) {
  return seed === RANDOM_SENTINEL ? "random" : String(seed);
}

function setButtonText(widget, text) {
  if (!widget) return;
  widget.name = text;
  widget.label = text;
}

function refreshSeedUI(node) {
  const seed = readSeed(node);
  if (node._inteliwebSeedWidget) {
    node._inteliwebSeedWidget.value = displaySeed(seed);
  }

  const last = node._inteliwebLastQueuedSeed;
  const hasLast = Number.isSafeInteger(last) && last >= 0;
  if (node._inteliwebLastSeedButton) {
    node._inteliwebLastSeedButton.disabled = !hasLast || seed === last;
    setButtonText(
      node._inteliwebLastSeedButton,
      hasLast ? `♻️ Use Last Queued Seed (${last})` : "♻️ (Use Last Queued Seed)",
    );
  }
  app.canvas?.setDirty?.(true, true);
}

function parseSeedInput(node, rawValue) {
  const text = String(rawValue ?? "").trim().toLowerCase();
  if (text === "random" || text === "-1") {
    writeSeed(node, RANDOM_SENTINEL);
    return;
  }

  const parsed = clampSeed(text);
  if (parsed == null || parsed < 0) {
    refreshSeedUI(node);
    return;
  }
  writeSeed(node, parsed);
}

function setupSeedNode(node) {
  if (node._inteliwebSeedReady) return;
  node._inteliwebSeedReady = true;
  node.properties ||= {};
  if (clampSeed(node.properties[STATE_KEY]) == null) {
    node.properties[STATE_KEY] = RANDOM_SENTINEL;
  }

  node.description = DESCRIPTION;

  const seedWidget = node.addWidget(
    "text",
    "seed",
    displaySeed(readSeed(node)),
    (value) => parseSeedInput(node, value),
    { serialize: false },
  );
  seedWidget.serialize = false;
  seedWidget.options ||= {};
  seedWidget.options.serialize = false;
  node._inteliwebSeedWidget = seedWidget;

  const randomButton = node.addWidget(
    "button",
    "🎲 Randomize Each Time",
    null,
    () => writeSeed(node, RANDOM_SENTINEL),
    { serialize: false },
  );
  randomButton.serialize = false;

  const fixedButton = node.addWidget(
    "button",
    "🎲 New Fixed Random",
    null,
    () => writeSeed(node, randomSeed()),
    { serialize: false },
  );
  fixedButton.serialize = false;

  const lastButton = node.addWidget(
    "button",
    "♻️ (Use Last Queued Seed)",
    null,
    () => {
      const last = node._inteliwebLastQueuedSeed;
      if (Number.isSafeInteger(last) && last >= 0) writeSeed(node, last);
    },
    { serialize: false },
  );
  lastButton.serialize = false;
  lastButton.disabled = true;
  node._inteliwebLastSeedButton = lastButton;

  const originalConfigure = node.onConfigure?.bind(node);
  node.onConfigure = function (info) {
    const result = originalConfigure?.(info);
    queueMicrotask(() => refreshSeedUI(this));
    return result;
  };

  const originalRemoved = node.onRemoved?.bind(node);
  node.onRemoved = function () {
    this._inteliwebSeedReady = false;
    return originalRemoved?.();
  };

  const computed = node.computeSize?.();
  if (computed && node.setSize) {
    node.setSize([Math.max(270, computed[0]), computed[1]]);
  }
  refreshSeedUI(node);
}

function buildSeedNodeIndex() {
  const index = new Map();
  const visited = new Set();

  const visit = (graph) => {
    if (!graph || visited.has(graph)) return;
    visited.add(graph);

    for (const node of graph._nodes || graph.nodes || []) {
      if (!node) continue;
      if (node.comfyClass === NODE_TYPE || node.type === NODE_TYPE) {
        index.set(String(node.id), node);
      }
      if (node.subgraph) visit(node.subgraph);
    }

    const registered = graph._subgraphs || graph.subgraphs;
    if (registered?.values) {
      for (const child of registered.values()) visit(child);
    }
  };

  visit(app.graph);
  return index;
}

function findSeedNode(index, promptId) {
  const id = String(promptId);
  if (index.has(id)) return index.get(id);
  const tail = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : null;
  return tail ? index.get(tail) || null : null;
}

let graphToPromptInstalled = false;
function installGraphToPromptHook() {
  if (graphToPromptInstalled) return;
  graphToPromptInstalled = true;

  const originalGraphToPrompt = app.graphToPrompt.bind(app);
  app.graphToPrompt = async function (...args) {
    const result = await originalGraphToPrompt(...args);

    try {
      const output = result?.output;
      if (!output) return result;

      const nodeIndex = buildSeedNodeIndex();
      for (const promptId of Object.keys(output)) {
        const entry = output[promptId];
        if (!entry || entry.class_type !== NODE_TYPE) continue;

        const node = findSeedNode(nodeIndex, promptId);
        const configuredSeed = node ? readSeed(node) : RANDOM_SENTINEL;
        const runSeed = configuredSeed === RANDOM_SENTINEL ? randomSeed() : configuredSeed;

        entry.inputs ||= {};
        entry.inputs.seed_state = JSON.stringify({ seed: configuredSeed, run_seed: runSeed });

        if (node) {
          node._inteliwebLastQueuedSeed = runSeed;
          refreshSeedUI(node);

          // Preserve the mode/fixed value in the embedded workflow metadata.
          const workflowNode = (result?.workflow?.nodes || []).find(
            (candidate) => String(candidate?.id) === String(node.id),
          );
          if (workflowNode) {
            workflowNode.properties ||= {};
            workflowNode.properties[STATE_KEY] = configuredSeed;
          }
        }
      }
    } catch (error) {
      console.warn("[Inteliweb Seed] Could not resolve queued seed:", error);
    }

    return result;
  };
}

app.registerExtension({
  name: "Inteliweb.Seed",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_TYPE) return;
    nodeData.description = DESCRIPTION;
    nodeType.description = DESCRIPTION;
  },

  nodeCreated(node) {
    if (node.comfyClass === NODE_TYPE || node.type === NODE_TYPE) setupSeedNode(node);
  },

  setup() {
    installGraphToPromptHook();
  },
});
