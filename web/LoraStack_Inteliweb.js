import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-css";
const MIN_NODE_WIDTH = 220;
const MIN_CONTENT_WIDTH = 200;
const MIN_NODE_HEIGHT = 110;
const BOTTOM_PADDING = 5;
const FALLBACK_WIDGET_TOP = 96;
const HEADER_HEIGHT = 27;
const ROOT_GAP = 4;
const ROW_HEIGHT = 33;
const ROW_GAP = 4;
const ROOT_PADDING_TOP = 1;
const HEIGHT_RETRY_DELAYS = [0, 50, 150, 400, 1000, 2000];
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

function loraUiWidget(node) {
  return node.widgets?.find((widget) => widget.name === "lora_stack_ui");
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
  gap: 4px;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
  height: max-content !important;
  min-height: 0 !important;
  box-sizing: border-box;
  padding: 1px 2px 0;
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

.inteliweb-lora-header-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
}

.inteliweb-lora-toolbar {
  display: block;
  min-width: 0;
}

.inteliweb-lora-button,
.inteliweb-lora-icon-button {
  border: 1px solid #555;
  border-radius: 5px;
  background: #2d2d2d;
  color: #ededed;
  cursor: pointer;
  font-weight: 600;
}
.inteliweb-lora-button:hover,
.inteliweb-lora-icon-button:hover { background: #3a3a3a; }
.inteliweb-lora-button.primary {
  width: 84px;
  min-height: 27px;
  height: 27px;
  padding: 0 4px;
  border-color: #555;
  background: #111111;
  color: #ffffff;
  font-size: 10px;
  line-height: 25px;
  white-space: nowrap;
}
.inteliweb-lora-button.primary:hover {
  border-color: #707070;
  background: #1c1c1c;
}
.inteliweb-lora-button:disabled,
.inteliweb-lora-icon-button:disabled {
  opacity: .35;
  cursor: default;
}

.inteliweb-lora-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 27px;
  height: 27px;
  padding: 2px 4px 2px 3px;
  border: 1px solid #4d4d4d;
  border-radius: 5px;
  background: #292929;
  color: #c7c7c7;
}

.inteliweb-lora-rows {
  display: grid;
  grid-auto-rows: max-content;
  gap: 4px;
  align-content: start;
  min-width: ${MIN_CONTENT_WIDTH}px;
  height: max-content;
  min-height: 0;
}

.inteliweb-lora-row {
  display: grid;
  grid-template-columns: 30px minmax(24px, 1fr) 58px 24px;
  gap: 3px;
  align-items: center;
  min-width: ${MIN_CONTENT_WIDTH}px;
  min-height: 33px;
  padding: 3px;
  border: 1px solid #4d4d4d;
  border-radius: 6px;
  background: #252525;
}
.inteliweb-lora-row > * { min-width: 0; }
.inteliweb-lora-row.disabled { opacity: .55; }

.inteliweb-lora-empty {
  padding: 7px;
  border: 1px dashed #555;
  border-radius: 6px;
  color: #999;
  text-align: center;
}

.inteliweb-lora-picker {
  position: relative;
  min-width: 0;
  max-width: 100%;
}
.inteliweb-lora-picker-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 11px;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: 25px;
  height: 25px;
  padding: 2px 3px;
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
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inteliweb-lora-picker-value.placeholder { color: #999; }
.inteliweb-lora-picker-value.missing { color: #ffcc80; }
.inteliweb-lora-picker-caret {
  color: #aaa;
  font-size: 9px;
  text-align: center;
}

.inteliweb-lora-picker-popover {
  position: fixed;
  z-index: 100000;
  display: grid;
  grid-template-rows: max-content minmax(0, 1fr);
  min-width: 240px;
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
  gap: 6px;
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
  width: 30px;
  height: 16px;
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
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #b8b8b8;
  transition: transform .12s ease, background .12s ease;
}
.inteliweb-lora-switch-control input:checked + .inteliweb-lora-switch-track {
  border-color: #8a8a8a;
  background: #666666;
}
.inteliweb-lora-switch-control input:checked + .inteliweb-lora-switch-track::after {
  transform: translateX(14px);
  background: #ffffff;
}
.inteliweb-lora-switch-control input:focus-visible + .inteliweb-lora-switch-track {
  outline: 2px solid #d0d0d0;
  outline-offset: 2px;
}

.inteliweb-lora-strength-control {
  display: grid;
  grid-template-columns: 14px minmax(20px, 1fr) 14px;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 25px;
  overflow: hidden;
  border: 1px solid #505050;
  border-radius: 5px;
  background: #191919;
}
.inteliweb-lora-strength-control input[type="number"] {
  width: 100%;
  min-width: 0;
  min-height: 23px;
  height: 23px;
  padding: 1px 0;
  border: 0;
  border-radius: 0;
  outline: 0;
  background: transparent;
  color: #f0f0f0;
  font: inherit;
  font-size: 10px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
  -moz-appearance: textfield;
}
.inteliweb-lora-strength-control input[type="number"]::-webkit-inner-spin-button,
.inteliweb-lora-strength-control input[type="number"]::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
}
.inteliweb-lora-strength-step {
  display: grid;
  place-items: center;
  width: 14px;
  min-width: 14px;
  height: 23px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  font: inherit;
  font-size: 8px;
  line-height: 1;
}
.inteliweb-lora-strength-step:hover {
  background: #303030;
  color: #fff;
}
.inteliweb-lora-strength-step:focus-visible {
  outline: 1px solid #bbb;
  outline-offset: -2px;
}

.inteliweb-lora-actions {
  width: 24px;
  min-width: 24px;
  min-height: 25px;
  height: 25px;
  padding: 0;
  font-size: 15px;
  line-height: 22px;
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
    Math.max(240, rect.width),
    Math.max(220, viewportWidth - margin * 2),
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

function createStrengthControl(value, title, onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-lora-strength-control";

  const decrease = button("◀", "inteliweb-lora-strength-step");
  decrease.title = "Decrease strength";
  decrease.setAttribute("aria-label", "Decrease LoRA strength");

  const input = document.createElement("input");
  input.type = "number";
  input.min = "-100";
  input.max = "100";
  input.step = "0.05";
  input.value = String(finiteNumber(value, 1));
  input.title = title;

  const increase = button("▶", "inteliweb-lora-strength-step");
  increase.title = "Increase strength";
  increase.setAttribute("aria-label", "Increase LoRA strength");

  const commit = (nextValue = input.value) => {
    const normalized = finiteNumber(nextValue, 1);
    input.value = String(Number(normalized.toFixed(6)));
    onChange(normalized);
  };

  const stepBy = (direction) => {
    const current = finiteNumber(input.value, 1);
    const step = Number(input.step) || 0.05;
    commit(current + step * direction);
  };

  decrease.addEventListener("click", (event) => {
    event.stopPropagation();
    stepBy(-1);
  });
  increase.addEventListener("click", (event) => {
    event.stopPropagation();
    stepBy(1);
  });
  input.addEventListener("change", () => commit());

  wrapper.append(decrease, input, increase);
  return wrapper;
}

function showRowMenu(event, { enabled, canMoveUp, canMoveDown, onToggle, onMoveUp, onMoveDown, onRemove }) {
  event.preventDefault();
  event.stopPropagation();

  const items = [
    {
      content: `${enabled ? "⚫" : "🟢"} ${enabled ? "Disable" : "Enable"}`,
      callback: onToggle,
    },
    null,
    {
      content: "⬆️ Move Up",
      disabled: !canMoveUp,
      callback: onMoveUp,
    },
    {
      content: "⬇️ Move Down",
      disabled: !canMoveDown,
      callback: onMoveDown,
    },
    {
      content: "🗑️ Remove",
      callback: onRemove,
    },
  ];

  new LiteGraph.ContextMenu(items, {
    title: "LORA",
    event,
  });
}

function measuredRootHeight(root) {
  if (!root?.isConnected) return 0;

  const style = getComputedStyle(root);
  const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const children = [...root.children].filter((child) => {
    const childStyle = getComputedStyle(child);
    return childStyle.display !== "none" && childStyle.position !== "absolute";
  });
  const childrenHeight = children.reduce(
    (total, child) => total + (Number(child.offsetHeight) || 0),
    0,
  );
  return Math.ceil(
    paddingTop + paddingBottom + childrenHeight + Math.max(0, children.length - 1) * gap,
  );
}

function estimatedRootHeight(node) {
  const state = readNodeState(node);
  const count = Array.isArray(state?.loras) ? state.loras.length : 0;
  const rowsHeight = count > 0
    ? count * ROW_HEIGHT + Math.max(0, count - 1) * ROW_GAP
    : ROW_HEIGHT;

  return ROOT_PADDING_TOP + HEADER_HEIGHT + ROOT_GAP + rowsHeight;
}

function applyMinimums(node) {
  if (!node) return;

  node.min_size ||= [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
  node.min_size[0] = MIN_NODE_WIDTH;
  node.min_size[1] = MIN_NODE_HEIGHT;

  const widget = loraUiWidget(node);
  if (widget) {
    widget.options ||= {};
    widget.options.minWidth = MIN_CONTENT_WIDTH;
    widget.options.getMinWidth = () => MIN_CONTENT_WIDTH;
    widget.getMinWidth = () => MIN_CONTENT_WIDTH;
  }

  const currentWidth = Number(node.size?.[0]) || 0;
  if (currentWidth > 0 && currentWidth < MIN_NODE_WIDTH) {
    node.size[0] = MIN_NODE_WIDTH;
  }
}

function fitNodeToContent(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return false;

  applyMinimums(node);
  const uiHeight = Math.max(measuredRootHeight(root), estimatedRootHeight(node));
  node.__inteliwebLoraUiHeight = uiHeight;

  const computed = node.computeSize?.();
  const computedHeight = Number(computed?.[1]);
  const widgetTop = Number(loraUiWidget(node)?.last_y);
  const fallbackHeight =
    (Number.isFinite(widgetTop) && widgetTop > 0 ? widgetTop : FALLBACK_WIDGET_TOP) +
    uiHeight +
    BOTTOM_PADDING;
  const height = Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(
      Number.isFinite(computedHeight) && computedHeight > 0
        ? Math.max(computedHeight + BOTTOM_PADDING, fallbackHeight)
        : fallbackHeight,
    ),
  );
  node.__inteliwebLoraDesiredHeight = height;

  const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
  const currentHeight = Number(node.size?.[1]) || 0;
  if (Math.abs(currentHeight - height) > 1) {
    node.setSize?.([width, height]);
  }
  node.setDirtyCanvas?.(true, true);
  return true;
}

function scheduleFit(node) {
  cancelAnimationFrame(node.__inteliwebLoraFitFrame || 0);
  fitNodeToContent(node);
  node.__inteliwebLoraFitFrame = requestAnimationFrame(() => fitNodeToContent(node));
}

function clearFitRetries(node) {
  for (const timeoutId of node.__inteliwebLoraFitTimeouts || []) {
    clearTimeout(timeoutId);
  }
  node.__inteliwebLoraFitTimeouts = [];
}

function scheduleFitRetries(node) {
  clearFitRetries(node);
  node.__inteliwebLoraFitTimeouts = HEIGHT_RETRY_DELAYS.map((delay) => setTimeout(() => {
    node.__inteliwebLoraFitFrame = requestAnimationFrame(() => fitNodeToContent(node));
  }, delay));
}

function installHeightObservers(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root || node.__inteliwebLoraHeightObserversInstalled) return;
  node.__inteliwebLoraHeightObserversInstalled = true;

  const mutationObserver = new MutationObserver(() => scheduleFitRetries(node));
  mutationObserver.observe(root, { childList: true, subtree: true });
  node.__inteliwebLoraMutationObserver = mutationObserver;

  if (globalThis.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => fitNodeToContent(node));
    resizeObserver.observe(root);
    node.__inteliwebLoraResizeObserver = resizeObserver;
  }

  if (globalThis.IntersectionObserver) {
    const intersectionObserver = new IntersectionObserver(() => fitNodeToContent(node));
    intersectionObserver.observe(root);
    node.__inteliwebLoraIntersectionObserver = intersectionObserver;
  }

  scheduleFitRetries(node);
}

function renderNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root) return;

  if (activePicker?.trigger && root.contains(activePicker.trigger)) closeActivePicker(false);
  applyMinimums(node);

  const state = readNodeState(node);
  state.separate_strengths = false;
  const loras = Array.isArray(cachedLoras) ? cachedLoras : [];
  root.replaceChildren();

  const header = document.createElement("div");
  header.className = "inteliweb-lora-header-row";

  const summary = document.createElement("div");
  summary.className = "inteliweb-lora-summary";
  const allEnabled = state.loras.length > 0 && state.loras.every((row) => row.on !== false);
  const someEnabled = state.loras.some((row) => row.on !== false);
  const toggleAllControl = switchControl(allEnabled, "Toggle all");
  toggleAllControl.input.indeterminate = someEnabled && !allEnabled;
  toggleAllControl.input.disabled = state.loras.length === 0;
  summary.appendChild(toggleAllControl.label);

  const toolbar = document.createElement("div");
  toolbar.className = "inteliweb-lora-toolbar";
  const add = button("＋ Add LoRA", "inteliweb-lora-button primary");
  toolbar.appendChild(add);
  header.append(summary, toolbar);

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

    const strength = createStrengthControl(
      row.strength,
      "MODEL and CLIP strength",
      (nextStrength) => {
        row.strength = nextStrength;
        row.strength_model = nextStrength;
        row.strength_clip = nextStrength;
        writeNodeState(node);
      },
    );

    const moveUp = () => {
      if (index <= 0) return;
      [state.loras[index - 1], state.loras[index]] = [state.loras[index], state.loras[index - 1]];
      writeNodeState(node);
      renderNode(node);
    };
    const moveDown = () => {
      if (index >= state.loras.length - 1) return;
      [state.loras[index + 1], state.loras[index]] = [state.loras[index], state.loras[index + 1]];
      writeNodeState(node);
      renderNode(node);
    };
    const remove = () => {
      state.loras.splice(index, 1);
      writeNodeState(node);
      renderNode(node);
    };
    const toggle = () => {
      row.on = !row.on;
      writeNodeState(node);
      renderNode(node);
    };

    const actions = button("⋮", "inteliweb-lora-icon-button inteliweb-lora-actions");
    actions.title = "LoRA actions";
    actions.setAttribute("aria-label", "LoRA actions");
    const openMenu = (event) => showRowMenu(event, {
      enabled: row.on !== false,
      canMoveUp: index > 0,
      canMoveDown: index < state.loras.length - 1,
      onToggle: toggle,
      onMoveUp: moveUp,
      onMoveDown: moveDown,
      onRemove: remove,
    });
    actions.addEventListener("click", openMenu);
    rowElement.addEventListener("contextmenu", openMenu);

    rowElement.append(enabledControl.label, picker, strength, actions);
    rows.appendChild(rowElement);

    enabledControl.input.addEventListener("change", () => {
      row.on = enabledControl.input.checked;
      writeNodeState(node);
      renderNode(node);
    });
  });

  root.append(header, rows);

  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
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
  applyMinimums(node);

  if (!node.__inteliwebLoraRoot) {
    const root = document.createElement("div");
    root.className = "inteliweb-lora-stack";
    node.__inteliwebLoraRoot = root;

    const widget = node.addDOMWidget?.("lora_stack_ui", "INTELIWEB_LORA_STACK", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => node.__inteliwebLoraUiHeight || estimatedRootHeight(node),
      getMinWidth: () => MIN_CONTENT_WIDTH,
    });
    if (widget?.options) {
      widget.options.canvasOnly = false;
      widget.options.minWidth = MIN_CONTENT_WIDTH;
      widget.options.getMinWidth = () => MIN_CONTENT_WIDTH;
    }
    if (widget) widget.getMinWidth = () => MIN_CONTENT_WIDTH;
  }

  applyMinimums(node);
  installHeightObservers(node);
  renderNode(node);
  scheduleFitRetries(node);
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
      const result = typeof originalCreated === "function"
        ? originalCreated.apply(this, args)
        : undefined;
      queueMicrotask(() => prepareNode(this));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = typeof originalConfigure === "function"
        ? originalConfigure.apply(this, args)
        : undefined;
      this.__inteliwebLoraState = null;
      queueMicrotask(() => prepareNode(this));
      return result;
    };

    const originalResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size, ...args) {
      if (Array.isArray(size)) {
        size[0] = Math.max(MIN_NODE_WIDTH, Number(size[0]) || MIN_NODE_WIDTH);
        const desiredHeight = Number(this.__inteliwebLoraDesiredHeight);
        if (Number.isFinite(desiredHeight)) size[1] = desiredHeight;
      }

      const result = typeof originalResize === "function"
        ? originalResize.call(this, size, ...args)
        : undefined;
      applyMinimums(this);
      this.graph?.setDirtyCanvas?.(true, true);
      return result;
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      cancelAnimationFrame(this.__inteliwebLoraFitFrame || 0);
      clearFitRetries(this);
      this.__inteliwebLoraMutationObserver?.disconnect();
      this.__inteliwebLoraResizeObserver?.disconnect();
      this.__inteliwebLoraIntersectionObserver?.disconnect();
      this.__inteliwebLoraMutationObserver = null;
      this.__inteliwebLoraResizeObserver = null;
      this.__inteliwebLoraIntersectionObserver = null;
      this.__inteliwebLoraHeightObserversInstalled = false;
      if (activePicker?.trigger && this.__inteliwebLoraRoot?.contains(activePicker.trigger)) {
        closeActivePicker(false);
      }
      return typeof originalRemoved === "function"
        ? originalRemoved.apply(this, args)
        : undefined;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },
});
