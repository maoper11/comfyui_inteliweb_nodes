import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-css";
const MIN_NODE_WIDTH = 520;
const MIN_CONTENT_WIDTH = 500;
const DEFAULT_STATE = Object.freeze({
  version: 1,
  separate_strengths: false,
  loras: [],
});

let cachedLoras = null;
let pendingLoras = null;
let activePicker = null;

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
  min-width: ${MIN_CONTENT_WIDTH}px;
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
  min-width: ${MIN_CONTENT_WIDTH}px;
}
.inteliweb-lora-row {
  display: grid;
  grid-template-columns: 40px minmax(180px, 1fr) 78px 30px 30px 30px;
  gap: 5px;
  align-items: center;
  min-width: ${MIN_CONTENT_WIDTH}px;
  min-height: 44px;
  padding: 6px;
  border: 1px solid #4d4d4d;
  border-radius: 7px;
  background: #252525;
}
.inteliweb-lora-row.disabled { opacity: .55; }
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

.inteliweb-lora-picker {
  position: relative;
  min-width: 0;
}
.inteliweb-lora-picker-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18px;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 4px 7px;
  border: 1px solid #505050;
  border-radius: 5px;
  background: #191919;
  color: #f0f0f0;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.inteliweb-lora-picker-trigger:hover,
.inteliweb-lora-picker-trigger[aria-expanded="true"] {
  border-color: #737373;
  background: #202020;
}
.inteliweb-lora-picker-trigger:focus-visible {
  outline: 2px solid #d0d0d0;
  outline-offset: 1px;
}
.inteliweb-lora-picker-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inteliweb-lora-picker-value.placeholder { color: #999; }
.inteliweb-lora-picker-value.missing { color: #ffcc80; }
.inteliweb-lora-picker-caret {
  color: #aaa;
  font-size: 10px;
  text-align: center;
}
.inteliweb-lora-picker-popover {
  position: fixed;
  z-index: 100000;
  display: grid;
  grid-template-rows: max-content minmax(0, 1fr);
  min-width: 320px;
  max-width: calc(100vw - 16px);
  max-height: min(420px, calc(100vh - 16px));
  overflow: hidden;
  border: 1px solid #666;
  border-radius: 7px;
  background: #171717;
  color: #f0f0f0;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .55);
  font: 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.inteliweb-lora-picker-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 8px;
  padding: 7px;
  border-bottom: 1px solid #404040;
  background: #202020;
}
.inteliweb-lora-picker-search {
  width: 100%;
  min-width: 0;
  min-height: 31px;
  padding: 5px 8px;
  border: 1px solid #5a5a5a;
  border-radius: 5px;
  outline: none;
  background: #111;
  color: #fff;
  font: inherit;
}
.inteliweb-lora-picker-search:focus {
  border-color: #9a9a9a;
  box-shadow: 0 0 0 1px #9a9a9a;
}
.inteliweb-lora-picker-count {
  min-width: 54px;
  color: #aaa;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.inteliweb-lora-picker-options {
  min-height: 42px;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 4px;
}
.inteliweb-lora-picker-option {
  display: block;
  width: 100%;
  min-height: 30px;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #ededed;
  cursor: pointer;
  font: inherit;
  overflow-wrap: anywhere;
  text-align: left;
}
.inteliweb-lora-picker-option:hover,
.inteliweb-lora-picker-option:focus-visible {
  outline: none;
  background: #343434;
}
.inteliweb-lora-picker-option.selected {
  background: #414141;
  color: #fff;
  font-weight: 600;
}
.inteliweb-lora-picker-option.missing { color: #ffcc80; }
.inteliweb-lora-picker-no-results {
  padding: 14px 10px;
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

function closeActivePicker(restoreFocus = false) {
  if (!activePicker) return;

  const { panel, trigger, cleanup } = activePicker;
  activePicker = null;
  cleanup?.();
  panel?.remove();
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}

function positionPickerPanel(trigger, panel) {
  if (!trigger?.isConnected || !panel?.isConnected) return;

  const margin = 8;
  const gap = 4;
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const width = Math.min(
    Math.max(360, rect.width),
    Math.max(240, viewportWidth - margin * 2),
  );

  panel.style.width = `${Math.round(width)}px`;
  panel.style.left = `${Math.round(Math.min(
    Math.max(margin, rect.left),
    Math.max(margin, viewportWidth - width - margin),
  ))}px`;

  const desiredHeight = Math.min(panel.scrollHeight || 420, 420, viewportHeight - margin * 2);
  const roomBelow = viewportHeight - rect.bottom - margin;
  const roomAbove = rect.top - margin;
  const openAbove = roomBelow < Math.min(220, desiredHeight) && roomAbove > roomBelow;
  const top = openAbove
    ? Math.max(margin, rect.top - desiredHeight - gap)
    : Math.min(rect.bottom + gap, Math.max(margin, viewportHeight - desiredHeight - margin));

  panel.style.top = `${Math.round(top)}px`;
}

function createLoraPicker(current, loras, onChange) {
  const normalizedCurrent = portablePath(current);
  const available = [...new Set(loras.map(portablePath).filter(Boolean))];
  const currentMissing = Boolean(normalizedCurrent && !available.includes(normalizedCurrent));
  const allOptions = currentMissing ? [normalizedCurrent, ...available] : available;

  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-lora-picker";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "inteliweb-lora-picker-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = normalizedCurrent || "Select LoRA";

  const value = document.createElement("span");
  value.className = "inteliweb-lora-picker-value";
  if (!normalizedCurrent) value.classList.add("placeholder");
  if (currentMissing) value.classList.add("missing");
  value.textContent = normalizedCurrent
    ? `${currentMissing ? "⚠ Missing: " : ""}${normalizedCurrent}`
    : "Select a LoRA…";

  const caret = document.createElement("span");
  caret.className = "inteliweb-lora-picker-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▼";
  trigger.append(value, caret);
  wrapper.appendChild(trigger);

  const openPicker = () => {
    if (activePicker?.trigger === trigger) {
      closeActivePicker(true);
      return;
    }

    closeActivePicker(false);

    const panel = document.createElement("div");
    panel.className = "inteliweb-lora-picker-popover";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Select a LoRA");

    const searchRow = document.createElement("div");
    searchRow.className = "inteliweb-lora-picker-search-row";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "inteliweb-lora-picker-search";
    search.placeholder = "Search LoRAs…";
    search.autocomplete = "off";
    search.spellcheck = false;
    search.setAttribute("aria-label", "Search LoRAs");

    const count = document.createElement("span");
    count.className = "inteliweb-lora-picker-count";

    const options = document.createElement("div");
    options.className = "inteliweb-lora-picker-options";
    options.setAttribute("role", "listbox");
    options.setAttribute("aria-label", "LoRAs");

    searchRow.append(search, count);
    panel.append(searchRow, options);
    document.body.appendChild(panel);
    trigger.setAttribute("aria-expanded", "true");

    const renderOptions = () => {
      const terms = search.value
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const filtered = terms.length === 0
        ? allOptions
        : allOptions.filter((name) => {
          const haystack = name.toLocaleLowerCase();
          return terms.every((term) => haystack.includes(term));
        });

      count.textContent = `${filtered.length}/${allOptions.length}`;
      options.replaceChildren();

      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "inteliweb-lora-picker-no-results";
        empty.textContent = "No matching LoRAs.";
        options.appendChild(empty);
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const name of filtered) {
        const optionButton = document.createElement("button");
        optionButton.type = "button";
        optionButton.className = "inteliweb-lora-picker-option";
        optionButton.setAttribute("role", "option");
        optionButton.setAttribute("aria-selected", String(name === normalizedCurrent));
        optionButton.dataset.loraName = name;
        optionButton.title = name;
        optionButton.textContent = name;
        if (name === normalizedCurrent) optionButton.classList.add("selected");
        if (currentMissing && name === normalizedCurrent) optionButton.classList.add("missing");

        optionButton.addEventListener("click", () => {
          closeActivePicker(false);
          onChange(name);
        });
        fragment.appendChild(optionButton);
      }
      options.appendChild(fragment);
    };

    const focusFirstOption = () => {
      options.querySelector(".inteliweb-lora-picker-option")?.focus();
    };

    const onDocumentPointerDown = (event) => {
      if (panel.contains(event.target) || trigger.contains(event.target)) return;
      closeActivePicker(false);
    };
    const onDocumentKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeActivePicker(true);
    };
    const onViewportChange = () => positionPickerPanel(trigger, panel);
    const cleanup = () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };

    activePicker = { panel, trigger, cleanup };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);

    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    panel.addEventListener("keydown", (event) => event.stopPropagation());
    search.addEventListener("input", () => {
      renderOptions();
      positionPickerPanel(trigger, panel);
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusFirstOption();
      } else if (event.key === "Enter") {
        const matches = options.querySelectorAll(".inteliweb-lora-picker-option");
        if (matches.length === 1) {
          event.preventDefault();
          matches[0].click();
        }
      }
    });
    options.addEventListener("keydown", (event) => {
      if (!event.target.classList?.contains("inteliweb-lora-picker-option")) return;
      const buttons = [...options.querySelectorAll(".inteliweb-lora-picker-option")];
      const index = buttons.indexOf(event.target);
      if (event.key === "ArrowDown" && index < buttons.length - 1) {
        event.preventDefault();
        buttons[index + 1].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (index > 0) buttons[index - 1].focus();
        else search.focus();
      }
    });

    renderOptions();
    positionPickerPanel(trigger, panel);
    requestAnimationFrame(() => search.focus());
  };

  trigger.addEventListener("click", openPicker);
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openPicker();
  });

  return wrapper;
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

function ensureMinimumNodeWidth(node) {
  if (!node) return;

  if (!node.min_size) node.min_size = [MIN_NODE_WIDTH, 0];
  else node.min_size[0] = Math.max(MIN_NODE_WIDTH, Number(node.min_size[0]) || 0);

  const currentWidth = Number(node.size?.[0]) || 0;
  if (currentWidth > 0 && currentWidth < MIN_NODE_WIDTH) {
    node.size[0] = MIN_NODE_WIDTH;
    node.graph?.setDirtyCanvas?.(true, true);
  }
}

function fitNodeToContent(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return;

  ensureMinimumNodeWidth(node);
  const uiHeight = Math.max(70, measuredRootHeight(root));
  node.__inteliwebLoraUiHeight = uiHeight;

  const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
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

  if (activePicker?.trigger && root.contains(activePicker.trigger)) closeActivePicker(false);
  ensureMinimumNodeWidth(node);

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

    const picker = createLoraPicker(row.name, loras, (selectedName) => {
      row.name = portablePath(selectedName);
      writeNodeState(node);
      renderNode(node);
    });

    const strength = numberInput(row.strength, "MODEL and CLIP strength");
    const up = button("↑", "inteliweb-lora-icon-button");
    up.title = "Move up";
    up.disabled = index === 0;
    const down = button("↓", "inteliweb-lora-icon-button");
    down.title = "Move down";
    down.disabled = index === state.loras.length - 1;
    const remove = button("×", "inteliweb-lora-icon-button");
    remove.title = "Remove LoRA";

    rowElement.append(enabledControl.label, picker, strength, up, down, remove);
    rows.appendChild(rowElement);

    enabledControl.input.addEventListener("change", () => {
      row.on = enabledControl.input.checked;
      rowElement.classList.toggle("disabled", !row.on);
      writeNodeState(node);
      renderNode(node);
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
  ensureMinimumNodeWidth(node);

  if (!node.__inteliwebLoraRoot) {
    const root = document.createElement("div");
    root.className = "inteliweb-lora-stack";
    node.__inteliwebLoraRoot = root;

    const widget = node.addDOMWidget?.("lora_stack_ui", "INTELIWEB_LORA_STACK", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => node.__inteliwebLoraUiHeight || 70,
      getMinWidth: () => MIN_CONTENT_WIDTH,
    });
    if (widget?.options) {
      widget.options.canvasOnly = false;
      widget.options.minWidth = MIN_CONTENT_WIDTH;
    }
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

    const originalResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size, ...args) {
      if (size && Number(size[0]) < MIN_NODE_WIDTH) size[0] = MIN_NODE_WIDTH;
      const result = originalResize?.call(this, size, ...args);
      ensureMinimumNodeWidth(this);
      return result;
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      cancelAnimationFrame(this.__inteliwebLoraFitFrame || 0);
      if (activePicker?.trigger && this.__inteliwebLoraRoot?.contains(activePicker.trigger)) {
        closeActivePicker(false);
      }
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },
});
