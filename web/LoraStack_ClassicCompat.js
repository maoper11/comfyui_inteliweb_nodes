import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebLoraStack";
const STATE_WIDGET = "lora_stack";
const PATCH_FLAG = "__inteliwebClassicLoraCompat";
let activePicker = null;
let cachedLoras = [];

function isClassicNodes() {
  return !globalThis.LiteGraph?.vueNodesMode;
}

function portablePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function stateWidget(node) {
  return node.widgets?.find((widget) => widget.name === STATE_WIDGET);
}

function parseState(node) {
  const widget = stateWidget(node);
  try {
    const parsed = JSON.parse(String(widget?.value || "{}"));
    return parsed && Array.isArray(parsed.loras)
      ? parsed
      : { version: 1, separate_strengths: false, loras: [] };
  } catch {
    return { version: 1, separate_strengths: false, loras: [] };
  }
}

function writeState(node, state) {
  const widget = stateWidget(node);
  if (!widget) return;

  const serialized = JSON.stringify(state);
  widget.value = serialized;
  widget.callback?.(serialized, node, widget);

  // Keep the state used by the main LoRA Stack frontend synchronized so a
  // later strength/toggle edit cannot restore the previous filename.
  node.__inteliwebLoraState = state;
  node.graph?.setDirtyCanvas?.(true, true);
}

async function fetchLoras() {
  const response = await api.fetchApi("/models/loras");
  if (!response.ok) throw new Error(`Unable to load LoRA list (${response.status})`);
  const data = await response.json();
  cachedLoras = [...new Set((Array.isArray(data) ? data : []).map(portablePath).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return cachedLoras;
}

function closePicker() {
  if (!activePicker) return;
  const { panel, cleanup } = activePicker;
  activePicker = null;
  cleanup?.();
  panel?.remove();
}

function positionPicker(trigger, panel) {
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(Math.max(260, rect.width), window.innerWidth - margin * 2);
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)}px`;

  const desiredHeight = Math.min(420, window.innerHeight - margin * 2);
  const roomBelow = window.innerHeight - rect.bottom - margin;
  panel.style.top = roomBelow >= 220
    ? `${rect.bottom + 4}px`
    : `${Math.max(margin, rect.top - desiredHeight - 4)}px`;
}

function openPicker(node, trigger, rowIndex) {
  closePicker();

  const state = parseState(node);
  const current = portablePath(state.loras?.[rowIndex]?.name);
  const values = current && !cachedLoras.includes(current)
    ? [current, ...cachedLoras]
    : cachedLoras;

  const panel = document.createElement("div");
  panel.className = "inteliweb-lora-picker-popover";

  const searchRow = document.createElement("div");
  searchRow.className = "inteliweb-lora-picker-search-row";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "inteliweb-lora-picker-search";
  search.placeholder = "Search LoRAs…";
  search.autocomplete = "off";
  const count = document.createElement("span");
  count.className = "inteliweb-lora-picker-count";
  searchRow.append(search, count);

  const options = document.createElement("div");
  options.className = "inteliweb-lora-picker-options";
  panel.append(searchRow, options);
  document.body.appendChild(panel);

  const render = () => {
    const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const filtered = terms.length
      ? values.filter((name) => terms.every((term) => name.toLocaleLowerCase().includes(term)))
      : values;

    count.textContent = `${filtered.length}/${values.length}`;
    options.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "inteliweb-lora-picker-no-results";
      empty.textContent = "No matching LoRAs.";
      options.appendChild(empty);
      return;
    }

    for (const name of filtered) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "inteliweb-lora-picker-option";
      option.textContent = name;
      option.title = name;
      if (name === current) option.classList.add("selected");
      option.addEventListener("click", () => {
        const nextState = parseState(node);
        if (!nextState.loras?.[rowIndex]) return closePicker();
        nextState.loras[rowIndex].name = name;
        writeState(node, nextState);

        const value = trigger.querySelector(".inteliweb-lora-picker-value");
        if (value) {
          value.textContent = name;
          value.classList.remove("placeholder", "missing");
        }
        trigger.title = name;
        closePicker();
      });
      options.appendChild(option);
    }
  };

  const onOutside = (event) => {
    if (!panel.contains(event.target) && !trigger.contains(event.target)) closePicker();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closePicker();
  };
  const onViewport = () => positionPicker(trigger, panel);
  const cleanup = () => {
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onViewport);
    window.removeEventListener("scroll", onViewport, true);
  };

  activePicker = { panel, cleanup };
  document.addEventListener("pointerdown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onViewport);
  window.addEventListener("scroll", onViewport, true);
  search.addEventListener("input", render);

  render();
  positionPicker(trigger, panel);
  requestAnimationFrame(() => search.focus());
}

function hideClassicStateWidget(node) {
  const widget = stateWidget(node);
  if (!widget) return;

  widget.hidden = true;
  widget.type = "hidden";
  widget.tooltip = "";
  widget.last_y = -100000;
  widget.draw = () => {};
  widget.computeSize = () => [0, 0];
  widget.options = { ...(widget.options || {}), hidden: true, tooltip: "" };

  // Classic NodeTooltip asks getWidgetOnPos(..., true), so hidden/disabled flags
  // alone do not prevent the invisible STRING widget from being hit-tested.
  if (!node.__inteliwebOriginalGetWidgetOnPos && typeof node.getWidgetOnPos === "function") {
    node.__inteliwebOriginalGetWidgetOnPos = node.getWidgetOnPos;
    node.getWidgetOnPos = function (...args) {
      const found = this.__inteliwebOriginalGetWidgetOnPos.apply(this, args);
      return found?.name === STATE_WIDGET ? undefined : found;
    };
  }
}

function patchNode(node) {
  if (!isClassicNodes() || node?.comfyClass !== NODE_CLASS || node[PATCH_FLAG]) return;
  node[PATCH_FLAG] = true;
  hideClassicStateWidget(node);

  const originalRefresh = node.refreshComboInNode;
  node.refreshComboInNode = async function (...args) {
    const result = typeof originalRefresh === "function"
      ? await originalRefresh.apply(this, args)
      : undefined;
    try {
      await fetchLoras();
    } catch (error) {
      console.warn("[Inteliweb LoRA Stack] Unable to refresh LoRAs:", error);
    }
    hideClassicStateWidget(this);
    return result;
  };
}

// Capture classic picker clicks before the original handler. This lets the
// picker consume the fresh list loaded by Refresh Node Definitions (R).
document.addEventListener("click", (event) => {
  if (!isClassicNodes()) return;
  const trigger = event.target?.closest?.(".inteliweb-lora-picker-trigger");
  if (!trigger) return;

  const root = trigger.closest(".inteliweb-lora-stack");
  const node = app.graph?._nodes?.find((candidate) => candidate.__inteliwebLoraRoot === root);
  if (!node || node.comfyClass !== NODE_CLASS) return;

  const row = trigger.closest(".inteliweb-lora-row");
  const rows = [...root.querySelectorAll(".inteliweb-lora-row")];
  const rowIndex = rows.indexOf(row);
  if (rowIndex < 0) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  openPicker(node, trigger, rowIndex);
}, true);

app.registerExtension({
  name: "inteliweb.lora.stack.classic.compat",

  nodeCreated(node) {
    queueMicrotask(() => patchNode(node));
  },

  setup() {
    fetchLoras().catch((error) =>
      console.warn("[Inteliweb LoRA Stack] Unable to preload classic LoRAs:", error),
    );
    queueMicrotask(() => {
      for (const node of app.graph?._nodes || []) patchNode(node);
    });
  },
});
