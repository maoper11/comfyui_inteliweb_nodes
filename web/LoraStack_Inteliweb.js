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

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, number)) : fallback;
}

function parseState(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.loras)) {
      return cloneDefaultState();
    }

    return {
      version: 1,
      separate_strengths: false,
      loras: parsed.loras
        .filter((row) => row && typeof row === "object")
        .map((row) => {
          const strength = finiteNumber(row.strength ?? row.strength_model, 1);
          return {
            on: row.on !== false,
            name: portablePath(row.name),
            strength,
            strength_model: strength,
            strength_clip: strength,
          };
        }),
    };
  } catch {
    return cloneDefaultState();
  }
}

function stateWidget(node) {
  return node.widgets?.find((widget) => widget.name === "lora_stack");
}

function hideStateWidget(node) {
  const widget = stateWidget(node);
  if (!widget) return;

  widget.__inteliwebHidden = true;
  widget.type = "hidden";
  widget.hidden = true;
  widget.draw = () => {};
  widget.computeSize = () => [0, 0];
  widget.options = { ...(widget.options || {}), hidden: true };

  for (const element of [widget.element, widget.inputEl, widget.el]) {
    if (element?.style) element.style.display = "none";
  }
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
  state.separate_strengths = false;

  const serialized = JSON.stringify({
    version: 1,
    separate_strengths: false,
    loras: state.loras.map((row) => {
      const strength = finiteNumber(row.strength, 1);
      return {
        on: row.on !== false,
        name: portablePath(row.name),
        strength,
        strength_model: strength,
        strength_clip: strength,
      };
    }),
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
  grid-auto-rows: max-content;
  align-content: start;
  gap: 8px;
  width: 100%;
  height: max-content !important;
  min-height: 0 !important;
  box-sizing: border-box;
  padding: 2px 2px 6px;
  overflow: visible !important;
  font: 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e8e8e8;
}
.inteliweb-lora-stack * { box-sizing: border-box; }

/* Hide the serialized STRING widget in Nodes 2.0. */
.lg-node:has(.inteliweb-lora-stack) .lg-node-widget:has(textarea),
.lg-node:has(.inteliweb-lora-stack) .lg-node-widget:has(input[type="text"][value^="{\"version\""]),
.lg-node:has(.inteliweb-lora-stack) textarea {
  display: none !important;
  min-height: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}

.inteliweb-lora-toolbar {
  display: grid;
  grid-template-columns: 1fr;
  align-items: center;
}
.inteliweb-lora-button,
.inteliweb-lora-icon-button {
  min-height: 30px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2d2d2d;
  color: #ededed;
  cursor: pointer;
  font-weight: 600;
}
.inteliweb-lora-button:hover,
.inteliweb-lora-icon-button:hover { background: #3a3a3a; }
.inteliweb-lora-button.primary {
  border-color: #555;
  background: #111111;
  color: #ffffff;
}
.inteliweb-lora-button.primary:hover {
  border-color: #707070;
  background: #1c1c1c;
}
.inteliweb-lora-icon-button {
  width: 30px;
  padding: 0;
}
.inteliweb-lora-icon-button:disabled {
  opacity: .35;
  cursor: default;
}

.inteliweb-lora-summary {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid #4d4d4d;
  border-radius: 6px;
  background: #292929;
  color: #c7c7c7;
}
.inteliweb-lora-rows {
  display: grid;
  grid-auto-rows: max-content;
  gap: 6px;
  align-content: start;
}
.inteliweb-lora-row {
  display: grid;
  grid-template-columns: 40px minmax(180px, 1fr) 78px 30px 30px 30px;
  gap: 5px;
  align-items: center;
  min-height: 44px;
  padding: 6px;
  border: 1px solid #4d4d4d;
  border-radius: 7px;
  background: #252525;
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
.inteliweb-lora-row input[type="number"] {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.inteliweb-lora-empty {
  padding: 12px;
  border: 1px dashed #555;
  border-radius: 7px;
  color: #999;
  text-align: center;
}

.inteliweb-lora-switch-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.inteliweb-lora-switch-control.compact {
  justify-content: center;
  gap: 0;
}
.inteliweb-lora-switch-control input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
}
.inteliweb-lora-switch-track {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 18px;
  flex: 0 0 auto;
  border: 1px solid #666;
  border-radius: 999px;
  background: #3a3a3a;
  transition: background .12s ease, border-color .12s ease;
}
.inteliweb-lora-switch-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #b8b8b8;
  transition: transform .12s ease, background .12s ease;
}
.inteliweb-lora-switch-control input:checked + .inteliweb-lora-switch-track {
  border-color: #8a8a8a;
  background: #666666;
}
.inteliweb-lora-switch-control input:checked + .inteliweb-lora-switch-track::after {
  transform: translateX(16px);
  background: #ffffff;
}
.inteliweb-lora-switch-control input:focus-visible + .inteliweb-lora-switch-track {
  outline: 2px solid #d0d0d0;
  outline-offset: 2px;
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

function switchControl(checked, text = "", compact = false) {
  const label = document.createElement("label");
  label.className = `inteliweb-lora-switch-control${compact ? " compact" : ""}`;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;

  const track = document.createElement("span");
  track.className = "inteliweb-lora-switch-track";
  label.append(input, track);

  if (text) {
    const caption = document.createElement("span");
    caption.textContent = text;
    label.appendChild(caption);
  }

  return { label, input };
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

function measuredRootHeight(root) {
  const style = getComputedStyle(root);
  const children = [...root.children];
  const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const childrenHeight = children.reduce((total, child) => total + child.offsetHeight, 0);
  return Math.ceil(paddingTop + paddingBottom + childrenHeight + Math.max(0, children.length - 1) * gap);
}

function fitNodeToContent(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return;

  const uiHeight = Math.max(70, measuredRootHeight(root));
  node.__inteliwebLoraUiHeight = uiHeight;

  const width = Math.max(520, Number(node.size?.[0]) || 520);
  const height = Math.max(165, uiHeight + 100);
  const currentWidth = Number(node.size?.[0]) || 0;
  const currentHeight = Number(node.size?.[1]) || 0;

  if (Math.abs(currentWidth - width) > 1 || Math.abs(currentHeight - height) > 1) {
    node.setSize?.([width, height]);
  }
  node.setDirtyCanvas?.(true, true);
}

function scheduleFit(node) {
  cancelAnimationFrame(node.__inteliwebLoraFitFrame || 0);
  node.__inteliwebLoraFitFrame = requestAnimationFrame(() => {
    node.__inteliwebLoraFitFrame = requestAnimationFrame(() => fitNodeToContent(node));
  });
}

function renderNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root) return;

  const state = readNodeState(node);
  state.separate_strengths = false;
  const loras = Array.isArray(cachedLoras) ? cachedLoras : [];
  root.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "inteliweb-lora-toolbar";
  const add = button("＋ Add LoRA", "inteliweb-lora-button primary");
  toolbar.appendChild(add);

  const summary = document.createElement("div");
  summary.className = "inteliweb-lora-summary";
  const allEnabled = state.loras.length > 0 && state.loras.every((row) => row.on !== false);
  const someEnabled = state.loras.some((row) => row.on !== false);
  const toggleAllControl = switchControl(allEnabled, "Toggle all");
  toggleAllControl.input.indeterminate = someEnabled && !allEnabled;
  toggleAllControl.input.disabled = state.loras.length === 0;
  summary.appendChild(toggleAllControl.label);

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
    rowElement.className = `inteliweb-lora-row${row.on === false ? " disabled" : ""}`;

    const enabledControl = switchControl(row.on !== false, "", true);
    enabledControl.input.title = "Enable LoRA";

    const select = document.createElement("select");
    select.title = row.name || "Select LoRA";
    populateSelect(select, row.name, loras);

    const strength = numberInput(row.strength, "MODEL and CLIP strength");
    const up = button("↑", "inteliweb-lora-icon-button");
    up.title = "Move up";
    up.disabled = index === 0;
    const down = button("↓", "inteliweb-lora-icon-button");
    down.title = "Move down";
    down.disabled = index === state.loras.length - 1;
    const remove = button("×", "inteliweb-lora-icon-button");
    remove.title = "Remove LoRA";

    rowElement.append(enabledControl.label, select, strength, up, down, remove);
    rows.appendChild(rowElement);

    enabledControl.input.addEventListener("change", () => {
      row.on = enabledControl.input.checked;
      rowElement.classList.toggle("disabled", !row.on);
      writeNodeState(node);
      renderNode(node);
    });

    select.addEventListener("change", () => {
      row.name = portablePath(select.value);
      writeNodeState(node);
      scheduleFit(node);
    });

    strength.addEventListener("change", () => {
      row.strength = finiteNumber(strength.value, 1);
      row.strength_model = row.strength;
      row.strength_clip = row.strength;
      strength.value = String(row.strength);
      writeNodeState(node);
      scheduleFit(node);
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
    add.disabled = true;
    try {
      // Fetch a current list here, so a separate refresh button is unnecessary.
      const available = await fetchLoras(true);
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
    } finally {
      add.disabled = false;
    }
  });

  toggleAllControl.input.addEventListener("change", () => {
    for (const row of state.loras) row.on = toggleAllControl.input.checked;
    writeNodeState(node);
    renderNode(node);
  });

  scheduleFit(node);
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
      getMinHeight: () => node.__inteliwebLoraUiHeight || 70,
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

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      cancelAnimationFrame(this.__inteliwebLoraFitFrame || 0);
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },
});
