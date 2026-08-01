import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLoraStack";
const STATE_PROP = "inteliwebLoraStack";
const PATCH_FLAG = "__inteliwebLoraStableStatePatched";
const STYLE_ID = "inteliweb-lora-stack-state-controls-css";

function clampStrength(value, fallback = 1) {
  const number = Number(value);
  const finite = Number.isFinite(number) ? number : fallback;
  return Math.max(-100, Math.min(100, Math.round(finite * 100) / 100));
}

function formatStrength(value, fallback = 1) {
  return clampStrength(value, fallback).toFixed(2);
}

function copyRow(target, source) {
  const strength = clampStrength(source?.strength ?? source?.strength_model, 1);
  target.on = source?.on !== false;
  target.name = String(source?.name ?? "").replaceAll("\\", "/");
  target.strength = strength;
  target.strength_model = strength;
  target.strength_clip = strength;
  return target;
}

function reconcileState(target, source) {
  target.version = 1;
  target.separate_strengths = false;
  target.loras ||= [];

  const incoming = Array.isArray(source?.loras) ? source.loras : [];
  for (let index = 0; index < incoming.length; index += 1) {
    const current = target.loras[index];
    if (current && typeof current === "object") {
      copyRow(current, incoming[index]);
    } else {
      target.loras[index] = copyRow({}, incoming[index]);
    }
  }
  target.loras.length = incoming.length;
  return target;
}

function serializeState(state) {
  return JSON.stringify({
    version: 1,
    separate_strengths: false,
    loras: (state?.loras || []).map((row) => {
      const strength = clampStrength(row?.strength ?? row?.strength_model, 1);
      return {
        on: row?.on !== false,
        name: String(row?.name ?? "").replaceAll("\\", "/"),
        strength,
        strength_model: strength,
        strength_clip: strength,
      };
    }),
  });
}

function installStableState(node) {
  if (!node || node[PATCH_FLAG]) return;
  node[PATCH_FLAG] = true;

  let current = node.__inteliwebLoraState ?? null;
  try {
    Object.defineProperty(node, "__inteliwebLoraState", {
      configurable: true,
      enumerable: false,
      get() {
        return current;
      },
      set(next) {
        if (next == null) {
          current = null;
          return;
        }
        if (!current || typeof current !== "object") {
          current = next;
          return;
        }
        reconcileState(current, next);
      },
    });
  } catch (error) {
    console.warn("[Inteliweb LoRA Stack] Unable to install stable state accessor:", error);
  }
}

function persistStrength(node, input) {
  const rowElement = input.closest(".inteliweb-lora-row");
  const rowsElement = rowElement?.parentElement;
  const index = rowsElement ? [...rowsElement.children].indexOf(rowElement) : -1;
  const row = node.__inteliwebLoraState?.loras?.[index];
  const number = Number(input.value);
  if (!row || !Number.isFinite(number)) return;

  const strength = clampStrength(number, row.strength ?? 1);
  row.strength = strength;
  row.strength_model = strength;
  row.strength_clip = strength;
  node.properties ||= {};
  node.properties[STATE_PROP] = serializeState(node.__inteliwebLoraState);
  node.graph?.setDirtyCanvas?.(true, true);
}

function formatInput(input) {
  if (!(input instanceof HTMLInputElement)) return;
  input.value = formatStrength(input.value, 1);
}

function installRootHandlers(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root || root.__inteliwebStableControlsInstalled) return;
  root.__inteliwebStableControlsInstalled = true;

  const formatAll = () => {
    for (const input of root.querySelectorAll(".inteliweb-lora-strength input")) {
      if (document.activeElement !== input) formatInput(input);
    }
  };

  root.addEventListener("input", (event) => {
    const input = event.target?.closest?.(".inteliweb-lora-strength input");
    if (!input) return;
    persistStrength(node, input);
  }, true);

  root.addEventListener("change", (event) => {
    const input = event.target?.closest?.(".inteliweb-lora-strength input");
    if (!input) return;
    queueMicrotask(() => formatInput(input));
  }, true);

  root.addEventListener("focusout", (event) => {
    const input = event.target?.closest?.(".inteliweb-lora-strength input");
    if (!input) return;
    persistStrength(node, input);
    queueMicrotask(() => formatInput(input));
  }, true);

  root.addEventListener("keydown", (event) => {
    const input = event.target?.closest?.(".inteliweb-lora-strength input");
    if (!input || event.key !== "Enter") return;
    persistStrength(node, input);
    formatInput(input);
    input.blur();
  }, true);

  root.addEventListener("click", (event) => {
    if (!event.target?.closest?.(".inteliweb-lora-strength button")) return;
    queueMicrotask(formatAll);
  }, true);

  const observer = new MutationObserver(formatAll);
  observer.observe(root, { childList: true, subtree: true });
  node.__inteliwebLoraStableControlsObserver = observer;
  queueMicrotask(formatAll);
}

function prepareNode(node) {
  if (node?.comfyClass !== NODE_CLASS && node?.type !== NODE_CLASS) return;
  installStableState(node);
  queueMicrotask(() => installRootHandlers(node));
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-lora-row {
  grid-template-columns: 30px minmax(24px, 1fr) 76px 24px !important;
}
.inteliweb-lora-strength {
  grid-template-columns: 14px minmax(44px, 1fr) 14px !important;
}
.inteliweb-lora-strength input {
  font-variant-numeric: tabular-nums;
  padding: 0 1px;
}
`;
  document.head.appendChild(style);
}

app.registerExtension({
  name: "inteliweb.lora.stack.state-controls-fix",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      this.__inteliwebLoraStableControlsObserver?.disconnect();
      this.__inteliwebLoraStableControlsObserver = null;
      return typeof originalRemoved === "function"
        ? originalRemoved.apply(this, args)
        : undefined;
    };
  },

  nodeCreated(node) {
    injectStyles();
    prepareNode(node);
  },

  loadedGraphNode(node) {
    injectStyles();
    prepareNode(node);
  },

  afterConfigureGraph() {
    injectStyles();
    for (const node of app.graph?._nodes || app.graph?.nodes || []) prepareNode(node);
  },
});
