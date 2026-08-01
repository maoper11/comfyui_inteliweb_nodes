import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebLoraStack";
const API_PATCH_FLAG = "__inteliwebLoraMissingWarningApiPatched";
const NODE_PATCH_FLAG = "__inteliwebLoraMissingWarningNodePatched";
const GLOBAL_EVENTS_FLAG = "__inteliwebLoraMissingWarningEventsInstalled";
const STYLE_ID = "inteliweb-lora-missing-warning-css";

let cachedLoras = null;
let cachedLoraLookup = null;

function portablePath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function basename(path) {
  const portable = portablePath(path);
  return portable.slice(portable.lastIndexOf("/") + 1);
}

function addLookupValue(map, key, value) {
  if (!key) return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, value);
  } else if (Array.isArray(existing)) {
    if (!existing.includes(value)) existing.push(value);
  } else if (existing !== value) {
    map.set(key, [existing, value]);
  }
}

function lookupMatches(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function buildLoraLookup(names) {
  const exactPaths = new Map();
  const casefoldPaths = new Map();
  const basenames = new Map();

  for (const original of names || []) {
    const actualName = portablePath(original);
    if (!actualName) continue;
    addLookupValue(exactPaths, actualName, actualName);
    addLookupValue(casefoldPaths, actualName.toLocaleLowerCase(), actualName);
    addLookupValue(basenames, basename(actualName).toLocaleLowerCase(), actualName);
  }

  return { exactPaths, casefoldPaths, basenames };
}

function updateLoraCache(data) {
  cachedLoras = [...new Set((Array.isArray(data) ? data : []).map(portablePath).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  cachedLoraLookup = buildLoraLookup(cachedLoras);
}

function uniqueResolution(matches, requestedName, matchType) {
  if (matches.length === 1) {
    return {
      status: "resolved",
      requestedName,
      actualName: matches[0],
      matchType,
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      requestedName,
      matches,
    };
  }
  return null;
}

function resolveLoraStatus(requestedName) {
  const requested = portablePath(requestedName);
  if (!cachedLoraLookup) return { status: "loading", requestedName: requested };
  if (!requested) return { status: "missing", requestedName: requested };

  const exact = lookupMatches(cachedLoraLookup.exactPaths.get(requested));
  if (exact.length === 1) {
    return {
      status: "available",
      requestedName: requested,
      actualName: exact[0],
    };
  }
  if (exact.length > 1) {
    return { status: "ambiguous", requestedName: requested, matches: exact };
  }

  const folded = uniqueResolution(
    lookupMatches(cachedLoraLookup.casefoldPaths.get(requested.toLocaleLowerCase())),
    requested,
    "case-insensitive",
  );
  if (folded) return folded;

  const byFilename = uniqueResolution(
    lookupMatches(cachedLoraLookup.basenames.get(basename(requested).toLocaleLowerCase())),
    requested,
    "filename",
  );
  if (byFilename) return byFilename;

  return { status: "missing", requestedName: requested };
}

function statusLabel(resolution) {
  if (resolution.status === "missing") {
    return `⚠ Missing: ${resolution.requestedName || "Select a LoRA…"}`;
  }
  if (resolution.status === "ambiguous") {
    return `⚠ Ambiguous: ${resolution.requestedName || "Select a LoRA…"}`;
  }
  return resolution.actualName || resolution.requestedName || "Select a LoRA…";
}

function statusTitle(resolution) {
  if (resolution.status === "resolved") {
    return `Saved as: ${resolution.requestedName}\nResolved as: ${resolution.actualName}`;
  }
  if (resolution.status === "missing") {
    return `Missing LoRA: ${resolution.requestedName || "No filename saved"}`;
  }
  if (resolution.status === "ambiguous") {
    const matches = resolution.matches.slice(0, 8).join("\n");
    const suffix = resolution.matches.length > 8 ? "\n…" : "";
    return `Ambiguous LoRA: ${resolution.requestedName}\nMatches:\n${matches}${suffix}`;
  }
  return resolution.actualName || resolution.requestedName || "Select a LoRA";
}

function allLoraNodes() {
  const nodes = [];
  const visited = new WeakSet();
  const walk = (graph) => {
    if (!graph || visited.has(graph)) return;
    visited.add(graph);
    for (const node of graph._nodes || graph.nodes || []) {
      if (!node) continue;
      if (node.comfyClass === NODE_CLASS || node.type === NODE_CLASS) nodes.push(node);
      const inner = node.subgraph || node._graph;
      if (inner && inner !== graph) walk(inner);
    }
  };
  walk(app.graph);
  return nodes;
}

function decorateNode(node) {
  const root = node?.__inteliwebLoraRoot;
  const rows = node?.__inteliwebLoraState?.loras;
  if (!root || !Array.isArray(rows)) return;

  const rowElements = root.querySelectorAll(".inteliweb-lora-row");
  rowElements.forEach((rowElement, index) => {
    const savedName = portablePath(rows[index]?.name);
    const resolution = resolveLoraStatus(savedName);
    const trigger = rowElement.querySelector(".inteliweb-lora-picker-trigger");
    const value = rowElement.querySelector(".inteliweb-lora-picker-value");
    if (!trigger || !value) return;

    value.textContent = statusLabel(resolution);
    value.classList.toggle(
      "missing",
      resolution.status === "missing" || resolution.status === "ambiguous",
    );
    value.classList.toggle("warning", resolution.status === "ambiguous");
    trigger.title = statusTitle(resolution);
    trigger.dataset.inteliwebSavedLora = savedName;
  });
}

function decorateAllNodes() {
  for (const node of allLoraNodes()) decorateNode(node);
}

function activePickerContext() {
  const trigger = document.querySelector(
    ".inteliweb-lora-picker-trigger[aria-expanded='true']",
  );
  if (!trigger) return null;

  for (const node of allLoraNodes()) {
    const root = node.__inteliwebLoraRoot;
    if (!root?.contains(trigger)) continue;
    const rowElement = trigger.closest(".inteliweb-lora-row");
    const rowsElement = rowElement?.parentElement;
    const index = rowsElement ? [...rowsElement.children].indexOf(rowElement) : -1;
    const savedName = portablePath(node.__inteliwebLoraState?.loras?.[index]?.name);
    return { trigger, savedName, resolution: resolveLoraStatus(savedName) };
  }
  return null;
}

function decorateActivePopover() {
  const context = activePickerContext();
  const panel = document.querySelector(".inteliweb-lora-popover");
  const options = panel?.querySelector(".inteliweb-lora-options");
  if (!context || !options) return;

  const { resolution, savedName } = context;
  const warning = resolution.status === "missing" || resolution.status === "ambiguous";
  options.querySelector("[data-inteliweb-saved-lora-warning]")?.remove();
  if (!warning) return;

  const query = panel.querySelector(".inteliweb-lora-search")?.value
    ?.trim()
    .toLocaleLowerCase() || "";
  const label = statusLabel(resolution);
  if (query && !label.toLocaleLowerCase().includes(query)) return;

  const option = document.createElement("button");
  option.type = "button";
  option.className = "inteliweb-lora-option selected warning";
  option.dataset.inteliwebSavedLoraWarning = "true";
  option.textContent = label;
  option.title = statusTitle(resolution);
  option.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  options.prepend(option);

  const count = panel.querySelector(".inteliweb-lora-search-row span");
  if (count && /^\d+\/\d+$/.test(count.textContent || "")) {
    const [shown, total] = count.textContent.split("/").map(Number);
    count.textContent = `${shown + 1}/${total + 1}`;
  }

  option.dataset.inteliwebSavedName = savedName;
}

function scheduleDecoration() {
  queueMicrotask(() => {
    decorateAllNodes();
    decorateActivePopover();
  });
  requestAnimationFrame(() => {
    decorateAllNodes();
    decorateActivePopover();
  });
}

function installApiPatch() {
  if (api[API_PATCH_FLAG]) return;
  api[API_PATCH_FLAG] = true;
  const originalFetchApi = api.fetchApi.bind(api);

  api.fetchApi = async function (route, ...args) {
    const response = await originalFetchApi(route, ...args);
    const routeText = typeof route === "string" ? route : String(route?.url || "");
    if (routeText.includes("/models/loras") && response?.ok && response.clone) {
      response.clone().json()
        .then((data) => {
          updateLoraCache(data);
          scheduleDecoration();
        })
        .catch((error) => {
          console.warn("[Inteliweb LoRA Stack] Unable to index LoRA list:", error);
        });
    }
    return response;
  };
}

function installGlobalEvents() {
  if (globalThis[GLOBAL_EVENTS_FLAG]) return;
  globalThis[GLOBAL_EVENTS_FLAG] = true;

  document.addEventListener("click", (event) => {
    if (!event.target?.closest?.(
      ".inteliweb-lora-stack, .inteliweb-lora-popover, .litecontextmenu",
    )) return;
    scheduleDecoration();
  }, true);

  document.addEventListener("contextmenu", (event) => {
    if (event.target?.closest?.(".inteliweb-lora-stack")) scheduleDecoration();
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target?.matches?.(".inteliweb-lora-search")) scheduleDecoration();
  }, true);
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-lora-picker-value.warning,
.inteliweb-lora-option.warning {
  color: #ffcc80;
}
`;
  document.head.appendChild(style);
}

installApiPatch();
installGlobalEvents();
injectStyles();

app.registerExtension({
  name: "inteliweb.lora.stack.missing-file-warning",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS || nodeType.prototype[NODE_PATCH_FLAG]) return;
    nodeType.prototype[NODE_PATCH_FLAG] = true;

    const originalRefresh = nodeType.prototype.refreshComboInNode;
    nodeType.prototype.refreshComboInNode = async function (...args) {
      const result = typeof originalRefresh === "function"
        ? await originalRefresh.apply(this, args)
        : undefined;
      scheduleDecoration();
      return result;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS && node.type !== NODE_CLASS) return;
    scheduleDecoration();
  },

  loadedGraphNode(node) {
    if (node.comfyClass !== NODE_CLASS && node.type !== NODE_CLASS) return;
    scheduleDecoration();
  },

  afterConfigureGraph() {
    scheduleDecoration();
  },
});
