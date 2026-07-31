import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebLoraStack";
const HIDDEN_INPUT = "lora_stack";
const STATE_PROP = "inteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-css";
const REFRESH_PATCH_FLAG = "__inteliwebLoraRefreshPatched";
const NODE_PATCH_FLAG = "__inteliwebLoraPatched";

const DEFAULT_NODE_WIDTH = 280;
const MIN_NODE_WIDTH = 250;
const MIN_CONTENT_WIDTH = 230;
const MIN_NODE_HEIGHT = 110;
const BOTTOM_PADDING = 6;
const FALLBACK_WIDGET_TOP = 96;
const HEADER_HEIGHT = 27;
const ROOT_GAP = 4;
const ROW_HEIGHT = 33;
const ROW_GAP = 4;
const ROOT_PADDING_TOP = 1;
const HEIGHT_RETRY_DELAYS = [0, 50, 150, 400, 1000, 2000, 4000];

const DEFAULT_STATE = Object.freeze({
  version: 1,
  separate_strengths: false,
  loras: [],
});

let cachedLoras = null;
let pendingLoras = null;
let activePicker = null;

function isVueNodes() {
  return Boolean(globalThis.LiteGraph?.vueNodesMode);
}

function portablePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function finiteNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, number)) : fallback;
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

function serializeState(state) {
  return JSON.stringify({
    version: 1,
    separate_strengths: false,
    loras: (state?.loras || []).map((row) => {
      const strength = finiteNumber(row.strength ?? row.strength_model, 1);
      return {
        on: row.on !== false,
        name: portablePath(row.name),
        strength,
        strength_model: strength,
        strength_clip: strength,
      };
    }),
  });
}

function readNodeState(node) {
  if (node.__inteliwebLoraState) return node.__inteliwebLoraState;

  const state = parseState(node.properties?.[STATE_PROP]);
  node.__inteliwebLoraState = state;
  node.properties ||= {};
  node.properties[STATE_PROP] = serializeState(state);
  return state;
}

function writeNodeState(node) {
  const serialized = serializeState(readNodeState(node));
  node.properties ||= {};
  node.properties[STATE_PROP] = serialized;
  node.__inteliwebLoraState = parseState(serialized);
  node.graph?.setDirtyCanvas?.(true, true);
  return node.__inteliwebLoraState;
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
  gap: ${ROOT_GAP}px;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
  height: max-content !important;
  min-height: 0 !important;
  box-sizing: border-box;
  padding: ${ROOT_PADDING_TOP}px 2px 0;
  overflow: visible !important;
  font: 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e8e8e8;
}
.inteliweb-lora-stack * { box-sizing: border-box; }
.inteliweb-lora-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
  height: ${HEADER_HEIGHT}px;
}
.inteliweb-lora-summary,
.inteliweb-lora-row {
  border: 1px solid #4d4d4d;
  border-radius: 6px;
  background: #292929;
}
.inteliweb-lora-summary {
  display: flex;
  align-items: center;
  min-width: 0;
  height: ${HEADER_HEIGHT}px;
  padding: 2px 5px;
}
.inteliweb-lora-rows {
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  gap: ${ROW_GAP}px;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
  height: max-content;
  min-height: 0;
}
.inteliweb-lora-row {
  display: grid;
  grid-template-columns: 30px minmax(24px, 1fr) 58px 24px;
  gap: 3px;
  align-items: center;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
  min-height: ${ROW_HEIGHT}px;
  height: ${ROW_HEIGHT}px;
  padding: 3px;
  background: #252525;
}
.inteliweb-lora-row > * { min-width: 0; }
.inteliweb-lora-row.disabled { opacity: .55; }
.inteliweb-lora-empty {
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
  min-height: ${ROW_HEIGHT}px;
  padding: 8px;
  border: 1px dashed #555;
  border-radius: 6px;
  color: #999;
  text-align: center;
}
.inteliweb-lora-button,
.inteliweb-lora-icon {
  border: 1px solid #555;
  border-radius: 5px;
  background: #202020;
  color: #eee;
  cursor: pointer;
  font-weight: 600;
}
.inteliweb-lora-button:hover,
.inteliweb-lora-icon:hover { background: #353535; }
.inteliweb-lora-button:disabled,
.inteliweb-lora-icon:disabled { opacity: .4; cursor: default; }
.inteliweb-lora-add {
  height: ${HEADER_HEIGHT}px;
  padding: 0 10px;
  background: #111;
  color: #fff;
  white-space: nowrap;
}
.inteliweb-lora-icon {
  width: 24px;
  min-width: 24px;
  height: 25px;
  padding: 0;
  font-size: 15px;
}
.inteliweb-lora-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.inteliweb-lora-switch.compact { justify-content: center; gap: 0; }
.inteliweb-lora-switch input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.inteliweb-lora-track {
  position: relative;
  width: 30px;
  height: 16px;
  flex: 0 0 auto;
  border: 1px solid #666;
  border-radius: 999px;
  background: #3a3a3a;
}
.inteliweb-lora-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #bbb;
  transition: transform .12s ease;
}
.inteliweb-lora-switch input:checked + .inteliweb-lora-track { background: #666; }
.inteliweb-lora-switch input:checked + .inteliweb-lora-track::after {
  transform: translateX(14px);
  background: #fff;
}
.inteliweb-lora-picker-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 25px;
  padding: 2px 5px;
  border: 1px solid #505050;
  border-radius: 5px;
  background: #191919;
  color: #f0f0f0;
  cursor: pointer;
  text-align: left;
}
.inteliweb-lora-picker-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inteliweb-lora-picker-value.missing { color: #ffcc80; }
.inteliweb-lora-strength {
  display: grid;
  grid-template-columns: 14px minmax(20px, 1fr) 14px;
  width: 100%;
  min-width: 0;
  height: 25px;
  border: 1px solid #505050;
  border-radius: 5px;
  background: #191919;
  overflow: hidden;
}
.inteliweb-lora-strength button {
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  padding: 0;
  font-size: 8px;
}
.inteliweb-lora-strength button:hover { background: #303030; color: #fff; }
.inteliweb-lora-strength input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #f0f0f0;
  text-align: center;
  appearance: textfield;
  -moz-appearance: textfield;
}
.inteliweb-lora-strength input::-webkit-inner-spin-button,
.inteliweb-lora-strength input::-webkit-outer-spin-button {
  appearance: none;
  -webkit-appearance: none;
}
.inteliweb-lora-popover {
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
  box-shadow: 0 12px 32px rgba(0,0,0,.55);
}
.inteliweb-lora-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  gap: 8px;
  padding: 7px;
  border-bottom: 1px solid #404040;
  background: #202020;
}
.inteliweb-lora-search {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid #5a5a5a;
  border-radius: 5px;
  background: #111;
  color: #fff;
}
.inteliweb-lora-options { overflow: auto; padding: 4px; }
.inteliweb-lora-option {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #ededed;
  cursor: pointer;
  text-align: left;
  overflow-wrap: anywhere;
}
.inteliweb-lora-option:hover,
.inteliweb-lora-option.selected { background: #3b3b3b; }
.inteliweb-lora-no-results { padding: 14px; color: #999; text-align: center; }
`;
  document.head.appendChild(style);
}

function makeSwitch(checked, text = "", compact = false) {
  const label = document.createElement("label");
  label.className = `inteliweb-lora-switch${compact ? " compact" : ""}`;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;

  const track = document.createElement("span");
  track.className = "inteliweb-lora-track";
  label.append(input, track);
  if (text) label.append(document.createTextNode(text));
  return { label, input };
}

function closePicker(restoreFocus = false) {
  if (!activePicker) return;
  const { panel, trigger, cleanup } = activePicker;
  activePicker = null;
  cleanup?.();
  panel?.remove();
  trigger?.setAttribute("aria-expanded", "false");
  if (restoreFocus && trigger?.isConnected) trigger.focus();
}

function positionPicker(trigger, panel) {
  if (!trigger?.isConnected || !panel?.isConnected) return;

  const margin = 8;
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
  const width = Math.min(Math.max(240, rect.width), Math.max(220, viewportWidth - margin * 2));

  panel.style.width = `${Math.round(width)}px`;
  panel.style.left = `${Math.round(Math.min(
    Math.max(margin, rect.left),
    Math.max(margin, viewportWidth - width - margin),
  ))}px`;

  const below = viewportHeight - rect.bottom - margin;
  const above = rect.top - margin;
  const height = Math.min(panel.scrollHeight || 420, 420, viewportHeight - margin * 2);
  const openAbove = below < Math.min(220, height) && above > below;
  const top = openAbove
    ? Math.max(margin, rect.top - height - 4)
    : Math.min(rect.bottom + 4, Math.max(margin, viewportHeight - height - margin));
  panel.style.top = `${Math.round(top)}px`;
}

function makePicker(current, onChange) {
  const currentName = portablePath(current);
  const wrapper = document.createElement("div");
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "inteliweb-lora-picker-trigger";
  trigger.setAttribute("aria-expanded", "false");
  trigger.title = currentName || "Select a LoRA";

  const value = document.createElement("span");
  value.className = "inteliweb-lora-picker-value";
  value.textContent = currentName || "Select a LoRA…";

  const caret = document.createElement("span");
  caret.textContent = "▼";
  trigger.append(value, caret);
  wrapper.appendChild(trigger);

  trigger.addEventListener("click", () => {
    if (activePicker?.trigger === trigger) return closePicker(true);
    closePicker();

    const panel = document.createElement("div");
    panel.className = "inteliweb-lora-popover";

    const searchRow = document.createElement("div");
    searchRow.className = "inteliweb-lora-search-row";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "inteliweb-lora-search";
    search.placeholder = "Search LoRAs…";
    search.autocomplete = "off";
    search.spellcheck = false;

    const count = document.createElement("span");
    const options = document.createElement("div");
    options.className = "inteliweb-lora-options";

    searchRow.append(search, count);
    panel.append(searchRow, options);
    document.body.appendChild(panel);
    trigger.setAttribute("aria-expanded", "true");

    const render = () => {
      const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const all = Array.isArray(cachedLoras) ? cachedLoras : [];
      const names = terms.length
        ? all.filter((name) => terms.every((term) => name.toLocaleLowerCase().includes(term)))
        : all;

      count.textContent = `${names.length}/${all.length}`;
      options.replaceChildren();

      if (!names.length) {
        const empty = document.createElement("div");
        empty.className = "inteliweb-lora-no-results";
        empty.textContent = "No matching LoRAs.";
        options.appendChild(empty);
        return;
      }

      for (const name of names) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = `inteliweb-lora-option${name === currentName ? " selected" : ""}`;
        option.textContent = name;
        option.title = name;
        option.addEventListener("click", () => {
          closePicker();
          onChange(name);
        });
        options.appendChild(option);
      }
    };

    const outside = (event) => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) closePicker();
    };
    const escape = (event) => {
      if (event.key === "Escape") closePicker(true);
    };
    const reposition = () => positionPicker(trigger, panel);
    const cleanup = () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };

    activePicker = { panel, trigger, cleanup };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    search.addEventListener("input", render);

    render();
    positionPicker(trigger, panel);
    requestAnimationFrame(() => search.focus());
  });

  return wrapper;
}

function makeStrength(value, onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-lora-strength";

  const left = document.createElement("button");
  left.type = "button";
  left.textContent = "◀";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "-100";
  input.max = "100";
  input.step = "0.05";
  input.value = String(finiteNumber(value, 1));

  const right = document.createElement("button");
  right.type = "button";
  right.textContent = "▶";

  const commit = (next) => {
    const normalized = finiteNumber(next, 1);
    input.value = String(Number(normalized.toFixed(6)));
    onChange(normalized);
  };

  left.addEventListener("click", () => commit(Number(input.value) - 0.05));
  right.addEventListener("click", () => commit(Number(input.value) + 0.05));
  input.addEventListener("change", () => commit(input.value));
  wrapper.append(left, input, right);
  return wrapper;
}

function loraUiWidget(node) {
  return node.widgets?.find((widget) => widget?.name === "lora_stack_ui");
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
  const count = readNodeState(node).loras.length;
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

  const width = Number(node.size?.[0]) || 0;
  if (width > 0 && width < MIN_NODE_WIDTH) node.size[0] = MIN_NODE_WIDTH;
}

function fitNodeToContent(node) {
  if (!node) return false;

  applyMinimums(node);
  const root = node.__inteliwebLoraRoot;
  const uiHeight = Math.max(measuredRootHeight(root), estimatedRootHeight(node));
  node.__inteliwebLoraUiHeight = uiHeight;

  let computedHeight = 0;
  try {
    computedHeight = Number(node.computeSize?.()?.[1]) || 0;
  } catch {
    computedHeight = 0;
  }

  const widgetTop = Number(loraUiWidget(node)?.last_y);
  const fallbackHeight =
    (Number.isFinite(widgetTop) && widgetTop > 0 ? widgetTop : FALLBACK_WIDGET_TOP)
    + uiHeight
    + BOTTOM_PADDING;
  const desiredHeight = Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(computedHeight > 0 ? Math.max(computedHeight + BOTTOM_PADDING, fallbackHeight) : fallbackHeight),
  );
  node.__inteliwebLoraDesiredHeight = desiredHeight;

  const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || DEFAULT_NODE_WIDTH);
  if (Math.abs((Number(node.size?.[1]) || 0) - desiredHeight) > 1) {
    node.setSize?.([width, desiredHeight]);
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
  for (const timeoutId of node.__inteliwebLoraFitTimeouts || []) clearTimeout(timeoutId);
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

  document.fonts?.ready?.then?.(() => scheduleFitRetries(node));
  scheduleFitRetries(node);
}

function renderNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root) return;
  if (activePicker?.trigger && root.contains(activePicker.trigger)) closePicker();

  applyMinimums(node);
  const state = readNodeState(node);
  root.replaceChildren();

  const header = document.createElement("div");
  header.className = "inteliweb-lora-header";

  const summary = document.createElement("div");
  summary.className = "inteliweb-lora-summary";
  const allOn = state.loras.length > 0 && state.loras.every((row) => row.on !== false);
  const anyOn = state.loras.some((row) => row.on !== false);
  const toggleAll = makeSwitch(allOn, "Toggle all");
  toggleAll.input.indeterminate = anyOn && !allOn;
  toggleAll.input.disabled = !state.loras.length;
  summary.appendChild(toggleAll.label);

  const add = document.createElement("button");
  add.type = "button";
  add.className = "inteliweb-lora-button inteliweb-lora-add";
  add.textContent = "＋ Add LoRA";
  header.append(summary, add);

  const rows = document.createElement("div");
  rows.className = "inteliweb-lora-rows";

  if (!state.loras.length) {
    const empty = document.createElement("div");
    empty.className = "inteliweb-lora-empty";
    empty.textContent = "No LoRAs added.";
    rows.appendChild(empty);
  }

  state.loras.forEach((row, index) => {
    const rowElement = document.createElement("div");
    rowElement.className = `inteliweb-lora-row${row.on === false ? " disabled" : ""}`;

    const enabled = makeSwitch(row.on !== false, "", true);
    const picker = makePicker(row.name, (name) => {
      row.name = portablePath(name);
      writeNodeState(node);
      renderNode(node);
    });
    const strength = makeStrength(row.strength, (next) => {
      row.strength = next;
      row.strength_model = next;
      row.strength_clip = next;
      writeNodeState(node);
    });

    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "inteliweb-lora-icon";
    menu.textContent = "⋮";

    const move = (direction) => {
      const target = index + direction;
      if (target < 0 || target >= state.loras.length) return;
      [state.loras[index], state.loras[target]] = [state.loras[target], state.loras[index]];
      writeNodeState(node);
      renderNode(node);
    };

    const openMenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      new LiteGraph.ContextMenu([
        {
          content: row.on === false ? "🟢 Enable" : "⚫ Disable",
          callback: () => {
            row.on = row.on === false;
            writeNodeState(node);
            renderNode(node);
          },
        },
        null,
        { content: "⬆️ Move Up", disabled: index === 0, callback: () => move(-1) },
        {
          content: "⬇️ Move Down",
          disabled: index === state.loras.length - 1,
          callback: () => move(1),
        },
        {
          content: "🗑️ Remove",
          callback: () => {
            state.loras.splice(index, 1);
            writeNodeState(node);
            renderNode(node);
          },
        },
      ], { title: "LORA", event });
    };

    menu.addEventListener("click", openMenu);
    rowElement.addEventListener("contextmenu", openMenu);
    enabled.input.addEventListener("change", () => {
      row.on = enabled.input.checked;
      writeNodeState(node);
      renderNode(node);
    });

    rowElement.append(enabled.label, picker, strength, menu);
    rows.appendChild(rowElement);
  });

  root.append(header, rows);

  toggleAll.input.addEventListener("change", () => {
    for (const row of state.loras) row.on = toggleAll.input.checked;
    writeNodeState(node);
    renderNode(node);
  });

  add.addEventListener("click", async () => {
    add.disabled = true;
    try {
      const available = await fetchLoras(true);
      state.loras.push({
        on: true,
        name: available[0] || "",
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

  scheduleFit(node);
}

function prepareNode(node) {
  injectStyles();
  readNodeState(node);

  if (!node.__inteliwebLoraRoot) {
    const root = document.createElement("div");
    root.className = "inteliweb-lora-stack";
    node.__inteliwebLoraRoot = root;

    if (!node.__inteliwebLoraConfigured) {
      node.size ||= [DEFAULT_NODE_WIDTH, MIN_NODE_HEIGHT];
      node.size[0] = Math.max(DEFAULT_NODE_WIDTH, Number(node.size[0]) || 0);
    }

    const widget = node.addDOMWidget?.("lora_stack_ui", "INTELIWEB_LORA_STACK", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => node.__inteliwebLoraUiHeight || estimatedRootHeight(node),
      getMaxHeight: () => node.__inteliwebLoraUiHeight || estimatedRootHeight(node),
      getMinWidth: () => MIN_CONTENT_WIDTH,
    });

    if (widget) {
      widget.options ||= {};
      widget.options.canvasOnly = false;
      widget.options.minWidth = MIN_CONTENT_WIDTH;
      widget.options.getMinWidth = () => MIN_CONTENT_WIDTH;
      widget.computeLayoutSize = () => ({
        minHeight: node.__inteliwebLoraUiHeight || estimatedRootHeight(node),
        maxHeight: node.__inteliwebLoraUiHeight || estimatedRootHeight(node),
        minWidth: MIN_CONTENT_WIDTH,
      });
    }
  }

  applyMinimums(node);
  installHeightObservers(node);
  renderNode(node);
  scheduleFitRetries(node);

  fetchLoras()
    .then(() => renderNode(node))
    .catch((error) => console.warn("[Inteliweb LoRA Stack] Unable to preload LoRAs:", error));
}

function walkGraph(graph, callback, visited = new WeakSet()) {
  if (!graph || visited.has(graph)) return;
  visited.add(graph);

  for (const node of graph._nodes || graph.nodes || []) {
    if (!node) continue;
    callback(node);
    const inner = node.subgraph || node._graph;
    if (inner && inner !== graph) walkGraph(inner, callback, visited);
  }
}

function buildNodeIndex() {
  const index = new Map();
  const visited = new WeakSet();

  const walk = (graph, prefix = "") => {
    if (!graph || visited.has(graph)) return;
    visited.add(graph);

    for (const node of graph._nodes || graph.nodes || []) {
      if (!node) continue;
      const composite = `${prefix}${node.id}`;
      if (node.comfyClass === NODE_CLASS || node.type === NODE_CLASS) {
        index.set(composite, node);
        if (!index.has(String(node.id))) index.set(String(node.id), node);
      }
      const inner = node.subgraph || node._graph;
      if (inner && inner !== graph) walk(inner, `${composite}:`);
    }
  };

  walk(app.graph);
  return index;
}

function findNode(index, id) {
  const key = String(id);
  if (index.has(key)) return index.get(key);
  const tail = key.includes(":") ? key.slice(key.lastIndexOf(":") + 1) : null;
  return tail ? index.get(tail) : undefined;
}

app.registerExtension({
  name: "inteliweb.lora.stack",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS || nodeType.prototype[NODE_PATCH_FLAG]) return;
    nodeType.prototype[NODE_PATCH_FLAG] = true;

    if (!nodeType.prototype[REFRESH_PATCH_FLAG]) {
      const originalRefresh = nodeType.prototype.refreshComboInNode;
      nodeType.prototype.refreshComboInNode = async function (...args) {
        const result = typeof originalRefresh === "function"
          ? await originalRefresh.apply(this, args)
          : undefined;
        try {
          await fetchLoras(true);
          renderNode(this);
        } catch (error) {
          console.warn("[Inteliweb LoRA Stack] Unable to refresh LoRAs:", error);
        }
        return result;
      };
      nodeType.prototype[REFRESH_PATCH_FLAG] = true;
    }

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      this.__inteliwebLoraConfigured = true;
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
        if (Number.isFinite(this.__inteliwebLoraDesiredHeight)) {
          size[1] = this.__inteliwebLoraDesiredHeight;
        }
      }

      const result = typeof originalResize === "function"
        ? originalResize.call(this, size, ...args)
        : undefined;
      applyMinimums(this);
      return result;
    };

    const originalDrawForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (...args) {
      if (!isVueNodes()) {
        applyMinimums(this);
        const desired = Number(this.__inteliwebLoraDesiredHeight);
        if (Number.isFinite(desired) && Math.abs((Number(this.size?.[1]) || 0) - desired) > 1) {
          this.size[1] = desired;
        }
      }
      return typeof originalDrawForeground === "function"
        ? originalDrawForeground.apply(this, args)
        : undefined;
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
      if (activePicker?.trigger && this.__inteliwebLoraRoot?.contains(activePicker.trigger)) closePicker();
      return typeof originalRemoved === "function"
        ? originalRemoved.apply(this, args)
        : undefined;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },

  loadedGraphNode(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },

  afterConfigureGraph() {
    walkGraph(app.graph, (node) => {
      if (node.comfyClass !== NODE_CLASS && node.type !== NODE_CLASS) return;
      queueMicrotask(() => {
        prepareNode(node);
        scheduleFitRetries(node);
      });
    });
  },
});

// State is stored in node.properties and injected into Python's hidden input only
// when ComfyUI builds the execution prompt. This avoids any visible JSON widget or
// conversion socket in both Classic and Nodes 2.0.
const originalGraphToPrompt = app.graphToPrompt;
app.graphToPrompt = async function (...args) {
  const result = await originalGraphToPrompt.call(app, ...args);
  try {
    const output = result?.output;
    if (!output) return result;

    let index = null;
    for (const id in output) {
      const entry = output[id];
      if (!entry || entry.class_type !== NODE_CLASS) continue;
      index ||= buildNodeIndex();
      const node = findNode(index, id);
      entry.inputs ||= {};
      entry.inputs[HIDDEN_INPUT] = serializeState(node ? readNodeState(node) : DEFAULT_STATE);
    }
  } catch (error) {
    console.warn("[Inteliweb LoRA Stack] Unable to inject state:", error);
  }
  return result;
};
