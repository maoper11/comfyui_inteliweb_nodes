import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-css";
const DEFAULT_STATE = Object.freeze({
  version: 1,
  separate_strengths: false,
  loras: [],
});

let cachedLoras = null;
let pendingLoras = null;

function portablePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function parseState(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.loras)) {
      return cloneDefaultState();
    }
    return {
      version: 1,
      separate_strengths: Boolean(parsed.separate_strengths),
      loras: parsed.loras
        .filter((row) => row && typeof row === "object")
        .map((row) => ({
          on: row.on !== false,
          name: portablePath(row.name),
          strength: finiteNumber(row.strength ?? row.strength_model, 1),
          strength_model: finiteNumber(row.strength_model ?? row.strength, 1),
          strength_clip: finiteNumber(row.strength_clip ?? row.strength, 1),
        })),
    };
  } catch {
    return cloneDefaultState();
  }
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, number)) : fallback;
}

function stateWidget(node) {
  return node.widgets?.find((widget) => widget.name === "lora_stack");
}

function hideStateWidget(node) {
  const widget = stateWidget(node);
  if (!widget || widget.__inteliwebHidden) return;
  widget.__inteliwebHidden = true;
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
}

function readNodeState(node) {
  if (!node.__inteliwebLoraState) {
    node.__inteliwebLoraState = parseState(stateWidget(node)?.value);
  }
  return node.__inteliwebLoraState;
}

function writeNodeState(node) {
  const widget = stateWidget(node);
  if (!widget) return;
  const state = readNodeState(node);
  const serialized = JSON.stringify({
    version: 1,
    separate_strengths: Boolean(state.separate_strengths),
    loras: state.loras.map((row) => ({
      on: row.on !== false,
      name: portablePath(row.name),
      strength: finiteNumber(row.strength, 1),
      strength_model: finiteNumber(row.strength_model, 1),
      strength_clip: finiteNumber(row.strength_clip, 1),
    })),
  });
  widget.value = serialized;
  widget.callback?.(serialized, node, widget);
  node.graph?.setDirtyCanvas?.(true, true);
}

async function fetchLoras(force = false) {
  if (!force && Array.isArray(cachedLoras)) return cachedLoras;
  if (!force && pendingLoras) return pendingLoras;

  pendingLoras = (async () => {
    const response = await api.fetchApi("/models/loras");
    if (!response.ok) throw new Error(`Unable to load LoRA list (${response.status})`);
    const data = await response.json();
    cachedLoras = [...new Set((Array.isArray(data) ? data : []).map(portablePath).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return cachedLoras;
  })();

  try {
    return await pendingLoras;
  } finally {
    pendingLoras = null;
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-lora-stack {
  display: grid;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 4px 2px 6px;
  font: 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e8e8e8;
}
.inteliweb-lora-stack * { box-sizing: border-box; }
.inteliweb-lora-toolbar {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 6px;
  align-items: center;
}
.inteliweb-lora-button,
.inteliweb-lora-icon-button {
  min-height: 30px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #303030;
  color: #ededed;
  cursor: pointer;
  font-weight: 600;
}
.inteliweb-lora-button:hover,
.inteliweb-lora-icon-button:hover { background: #3a3a3a; }
.inteliweb-lora-button.primary {
  border-color: #ff6647;
  background: #ff6647;
  color: white;
}
.inteliweb-lora-icon-button { width: 32px; padding: 0; }
.inteliweb-lora-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid #4d4d4d;
  border-radius: 6px;
  background: #292929;
  color: #bdbdbd;
}
.inteliweb-lora-summary label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.inteliweb-lora-rows { display: grid; gap: 6px; }
.inteliweb-lora-row {
  display: grid;
  grid-template-columns: 26px minmax(180px, 1fr) 78px 30px 30px 30px;
  gap: 5px;
  align-items: center;
  padding: 6px;
  border: 1px solid #4d4d4d;
  border-radius: 7px;
  background: #252525;
}
.inteliweb-lora-row.separate {
  grid-template-columns: 26px minmax(180px, 1fr) 70px 70px 30px 30px 30px;
}
.inteliweb-lora-row.disabled { opacity: .55; }
.inteliweb-lora-row select,
.inteliweb-lora-row input[type="number"] {
  width: 100%;
  min-height: 30px;
  border: 1px solid #505050;
  border-radius: 5px;
  background: #191919;
  color: #f0f0f0;
  padding: 4px 7px;
}
.inteliweb-lora-row input[type="number"] { text-align: right; font-variant-numeric: tabular-nums; }
.inteliweb-lora-toggle { display: flex; align-items: center; justify-content: center; }
.inteliweb-lora-empty {
  padding: 14px;
  border: 1px dashed #555;
  border-radius: 7px;
  color: #999;
  text-align: center;
}
`;
  document.head.appendChild(style);
}

function button(text, className = "inteliweb-lora-button") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  return element;
}

function numberInput(value, title) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "-100";
  input.max = "100";
  input.step = "0.05";
  input.value = String(finiteNumber(value, 1));
  input.title = title;
  return input;
}

function option(select, value, text = value) {
  const entry = document.createElement("option");
  entry.value = value;
  entry.textContent = text;
  select.appendChild(entry);
}

function populateSelect(select, current, loras) {
  select.replaceChildren();
  const normalizedCurrent = portablePath(current);
  if (!normalizedCurrent) option(select, "", "Select a LoRA…");
  if (normalizedCurrent && !loras.includes(normalizedCurrent)) {
    option(select, normalizedCurrent, `⚠ Missing: ${normalizedCurrent}`);
  }
  for (const name of loras) option(select, name);
  select.value = normalizedCurrent;
}

function renderNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root) return;
  const state = readNodeState(node);
  const loras = Array.isArray(cachedLoras) ? cachedLoras : [];
  root.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "inteliweb-lora-toolbar";
  const add = button("＋ Add LoRA", "inteliweb-lora-button primary");
  const refresh = button("↻", "inteliweb-lora-icon-button");
  refresh.title = "Refresh LoRA list";
  const clear = button("Clear", "inteliweb-lora-button");
  toolbar.append(add, refresh, clear);

  const summary = document.createElement("div");
  summary.className = "inteliweb-lora-summary";
  const toggleLabel = document.createElement("label");
  const toggleAll = document.createElement("input");
  toggleAll.type = "checkbox";
  toggleAll.checked = state.loras.length > 0 && state.loras.every((row) => row.on !== false);
  toggleAll.indeterminate = state.loras.some((row) => row.on !== false) && !toggleAll.checked;
  toggleLabel.append(toggleAll, document.createTextNode("Toggle all"));

  const separateLabel = document.createElement("label");
  const separate = document.createElement("input");
  separate.type = "checkbox";
  separate.checked = state.separate_strengths;
  separateLabel.append(separate, document.createTextNode("Separate MODEL / CLIP"));
  summary.append(toggleLabel, separateLabel);

  const rows = document.createElement("div");
  rows.className = "inteliweb-lora-rows";

  if (state.loras.length === 0) {
    const empty = document.createElement("div");
    empty.className = "inteliweb-lora-empty";
    empty.textContent = "No LoRAs added.";
    rows.appendChild(empty);
  }

  state.loras.forEach((row, index) => {
    const rowElement = document.createElement("div");
    rowElement.className = `inteliweb-lora-row${state.separate_strengths ? " separate" : ""}${row.on === false ? " disabled" : ""}`;

    const enabledWrap = document.createElement("label");
    enabledWrap.className = "inteliweb-lora-toggle";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = row.on !== false;
    enabled.title = "Enable LoRA";
    enabledWrap.appendChild(enabled);

    const select = document.createElement("select");
    select.title = row.name || "Select LoRA";
    populateSelect(select, row.name, loras);

    rowElement.append(enabledWrap, select);

    if (state.separate_strengths) {
      const modelStrength = numberInput(row.strength_model, "MODEL strength");
      const clipStrength = numberInput(row.strength_clip, "CLIP strength");
      rowElement.append(modelStrength, clipStrength);
      modelStrength.addEventListener("change", () => {
        row.strength_model = finiteNumber(modelStrength.value, 1);
        writeNodeState(node);
      });
      clipStrength.addEventListener("change", () => {
        row.strength_clip = finiteNumber(clipStrength.value, 1);
        writeNodeState(node);
      });
    } else {
      const strength = numberInput(row.strength, "MODEL and CLIP strength");
      rowElement.append(strength);
      strength.addEventListener("change", () => {
        row.strength = finiteNumber(strength.value, 1);
        row.strength_model = row.strength;
        row.strength_clip = row.strength;
        writeNodeState(node);
      });
    }

    const up = button("↑", "inteliweb-lora-icon-button");
    up.title = "Move up";
    up.disabled = index === 0;
    const down = button("↓", "inteliweb-lora-icon-button");
    down.title = "Move down";
    down.disabled = index === state.loras.length - 1;
    const remove = button("×", "inteliweb-lora-icon-button");
    remove.title = "Remove LoRA";
    rowElement.append(up, down, remove);
    rows.appendChild(rowElement);

    enabled.addEventListener("change", () => {
      row.on = enabled.checked;
      writeNodeState(node);
      renderNode(node);
    });
    select.addEventListener("change", () => {
      row.name = portablePath(select.value);
      writeNodeState(node);
      renderNode(node);
    });
    up.addEventListener("click", () => {
      if (index <= 0) return;
      [state.loras[index - 1], state.loras[index]] = [state.loras[index], state.loras[index - 1]];
      writeNodeState(node);
      renderNode(node);
    });
    down.addEventListener("click", () => {
      if (index >= state.loras.length - 1) return;
      [state.loras[index + 1], state.loras[index]] = [state.loras[index], state.loras[index + 1]];
      writeNodeState(node);
      renderNode(node);
    });
    remove.addEventListener("click", () => {
      state.loras.splice(index, 1);
      writeNodeState(node);
      renderNode(node);
    });
  });

  root.append(toolbar, summary, rows);

  add.addEventListener("click", async () => {
    try {
      const available = await fetchLoras();
      state.loras.push({
        on: true,
        name: available[0] ?? "",
        strength: 1,
        strength_model: 1,
        strength_clip: 1,
      });
      writeNodeState(node);
      renderNode(node);
    } catch (error) {
      console.error("[Inteliweb LoRA Stack]", error);
      alert(`Unable to load LoRAs: ${error.message}`);
    }
  });

  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    try {
      await fetchLoras(true);
      renderNode(node);
    } catch (error) {
      console.error("[Inteliweb LoRA Stack]", error);
      alert(`Unable to refresh LoRAs: ${error.message}`);
    } finally {
      refresh.disabled = false;
    }
  });

  clear.addEventListener("click", () => {
    if (state.loras.length === 0 || !confirm("Remove all LoRAs from this stack?")) return;
    state.loras.length = 0;
    writeNodeState(node);
    renderNode(node);
  });

  toggleAll.addEventListener("change", () => {
    for (const row of state.loras) row.on = toggleAll.checked;
    writeNodeState(node);
    renderNode(node);
  });

  separate.addEventListener("change", () => {
    state.separate_strengths = separate.checked;
    for (const row of state.loras) {
      if (separate.checked) {
        row.strength_model = finiteNumber(row.strength_model ?? row.strength, 1);
        row.strength_clip = finiteNumber(row.strength_clip ?? row.strength, 1);
      } else {
        row.strength = finiteNumber(row.strength_model ?? row.strength, 1);
      }
    }
    writeNodeState(node);
    renderNode(node);
  });

  queueMicrotask(() => {
    const width = Math.max(520, node.size?.[0] ?? 520);
    const height = Math.max(170, root.scrollHeight + 105);
    node.setSize?.([width, height]);
    node.setDirtyCanvas?.(true, true);
  });
}

function prepareNode(node) {
  injectStyles();
  hideStateWidget(node);
  readNodeState(node);

  if (!node.__inteliwebLoraRoot) {
    const root = document.createElement("div");
    root.className = "inteliweb-lora-stack";
    node.__inteliwebLoraRoot = root;
    const widget = node.addDOMWidget?.("lora_stack_ui", "INTELIWEB_LORA_STACK", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => Math.max(80, root.scrollHeight),
    });
    if (widget?.options) widget.options.canvasOnly = false;
  }

  renderNode(node);
  fetchLoras()
    .then(() => renderNode(node))
    .catch((error) => console.warn("[Inteliweb LoRA Stack] Unable to preload LoRAs:", error));
}

app.registerExtension({
  name: "inteliweb.lora.stack",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = originalCreated?.apply(this, args);
      queueMicrotask(() => prepareNode(this));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalConfigure?.apply(this, args);
      this.__inteliwebLoraState = null;
      queueMicrotask(() => prepareNode(this));
      return result;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },
});
