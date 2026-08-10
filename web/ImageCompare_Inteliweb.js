import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebImageCompare";
const DOM_WIDGET_NAME = "inteliweb_compare";
const NODE_PATCH_FLAG = "__inteliwebImageComparePatched";
const VUE_NODES_SETTING_ID = "Comfy.VueNodes.Enabled";
const MODE_WATCH_FALLBACK_INTERVAL_MS = 1000;
const MODE_SETTLE_DELAY_MS = 180;
const MODES = Object.freeze([
  ["left_right", "↔", "Left / right"],
  ["up_down", "↕", "Up / down"],
  ["toggle", "⇄", "Toggle A / B"],
  ["side_by_side", "▥", "Side by side"],
]);

const HEADER_HEIGHT = 38;
const CLASSIC_TOP_OFFSET = 50;
const MIN_WIDTH = 360;
const MIN_CONTENT_WIDTH = MIN_WIDTH - 20;
const MIN_HEIGHT = 300;
const BUTTON_GAP = 4;
const STATE_VERSION = 3;
const PREVIEW_STATE_VERSION = 1;
const PREVIEW_STATE_PROPERTY = "inteliweb_image_compare_preview";
const LEGACY_PREVIEW_STATE_WIDGET = "preview_state";
const STYLE_ID = "inteliweb-image-compare-css";
let rendererSyncGeneration = 0;

function isNodes2() {
  return Boolean(window.LiteGraph?.vueNodesMode);
}

function isImageCompare(node) {
  return node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rendererTop(classic) {
  return classic ? CLASSIC_TOP_OFFSET : 0;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.lg-node:has(.inteliweb-image-compare) .lg-node-widget:has(textarea),
.lg-node:has(.inteliweb-image-compare) .lg-node-widget:has(input[type="text"][value^="{\"version\""]),
.lg-node:has(.inteliweb-image-compare) textarea {
  display: none !important;
  min-height: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}
.lg-node:has(.inteliweb-image-compare) .lg-node-widgets {
  row-gap: 0 !important;
}
.inteliweb-image-compare,
.inteliweb-image-compare canvas {
  background: transparent !important;
}
`;
  document.head.appendChild(style);
}

function ensureState(node) {
  node.properties ||= {};
  const state = node.properties;

  if (state.compare_state_version !== STATE_VERSION) {
    state.compare_mode = "left_right";
    state.toggle_image = "a";
    state.split_x = 0;
    state.split_y = 0;
    state.compare_state_version = STATE_VERSION;
  }

  if (!MODES.some(([key]) => key === state.compare_mode)) state.compare_mode = "left_right";
  if (!["a", "b"].includes(state.toggle_image)) state.toggle_image = "a";
  if (!Number.isFinite(Number(state.split_x))) state.split_x = 0;
  if (!Number.isFinite(Number(state.split_y))) state.split_y = 0;

  state.split_x = clamp(Number(state.split_x), 0, 1);
  state.split_y = clamp(Number(state.split_y), 0, 1);
  node.__inteliwebCompareImages ||= { a: null, b: null };
  return state;
}

function previewStateWidget(node) {
  return node.widgets?.find((widget) => widget.name === LEGACY_PREVIEW_STATE_WIDGET);
}

function cleanPreviewDescriptor(data, slot) {
  if (!data || typeof data !== "object" || !data.filename) return null;
  return {
    filename: String(data.filename),
    subfolder: String(data.subfolder || ""),
    type: String(data.type || "temp"),
    slot,
  };
}

function parsePreviewState(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    return {
      version: PREVIEW_STATE_VERSION,
      a: cleanPreviewDescriptor(parsed?.a, "a"),
      b: cleanPreviewDescriptor(parsed?.b, "b"),
    };
  } catch {
    return { version: PREVIEW_STATE_VERSION, a: null, b: null };
  }
}

function readPreviewState(node) {
  node.properties ||= {};
  const state = parsePreviewState(node.properties[PREVIEW_STATE_PROPERTY]);
  node.properties[PREVIEW_STATE_PROPERTY] = JSON.stringify(state);
  return state;
}

function writePreviewState(node, bySlot) {
  node.properties ||= {};
  node.properties[PREVIEW_STATE_PROPERTY] = JSON.stringify({
    version: PREVIEW_STATE_VERSION,
    a: cleanPreviewDescriptor(bySlot.a, "a"),
    b: cleanPreviewDescriptor(bySlot.b, "b"),
  });
  node.graph?.setDirtyCanvas?.(true, true);
}

function migratePreviewState(node, serializedNode) {
  node.properties ||= {};
  if (node.properties[PREVIEW_STATE_PROPERTY] != null) {
    node.properties[PREVIEW_STATE_PROPERTY] = JSON.stringify(
      parsePreviewState(node.properties[PREVIEW_STATE_PROPERTY]),
    );
    return;
  }

  const legacyValue = previewStateWidget(node)?.value ?? serializedNode?.widgets_values?.[0];
  node.properties[PREVIEW_STATE_PROPERTY] = JSON.stringify(parsePreviewState(legacyValue));
}

function removeLegacyPreviewStateArtifacts(node) {
  const elements = new Set();
  for (let index = (node.widgets?.length || 0) - 1; index >= 0; index -= 1) {
    const widget = node.widgets[index];
    if (widget?.name !== LEGACY_PREVIEW_STATE_WIDGET) continue;
    for (const element of [widget.element, widget.inputEl, widget.el]) {
      if (element) elements.add(element);
    }
    widget.onRemove?.();
    node.widgets.splice(index, 1);
  }

  for (const element of elements) {
    const wrapper = element?.closest?.(".lg-node-widget");
    element?.remove?.();
    wrapper?.remove?.();
  }

  for (let index = (node.inputs?.length || 0) - 1; index >= 0; index -= 1) {
    if (node.inputs[index]?.name !== LEGACY_PREVIEW_STATE_WIDGET) continue;
    if (typeof node.removeInput === "function") node.removeInput(index);
    else node.inputs.splice(index, 1);
  }
}

function imageUrl(data) {
  const query = new URLSearchParams({
    filename: data.filename,
    type: data.type || "temp",
    subfolder: data.subfolder || "",
  });
  return api.apiURL(
    `/view?${query.toString()}${app.getPreviewFormatParam?.() || ""}${app.getRandParam?.() || ""}`,
  );
}

function loadImage(data, generation, node) {
  if (!data) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(node.__inteliwebCompareGeneration === generation ? image : null);
    image.onerror = () => resolve(null);
    image.src = imageUrl(data);
  });
}

async function loadPreviewDescriptors(node, bySlot) {
  const generation = (node.__inteliwebCompareGeneration || 0) + 1;
  node.__inteliwebCompareGeneration = generation;
  const [a, b] = await Promise.all([
    loadImage(bySlot.a, generation, node),
    loadImage(bySlot.b, generation, node),
  ]);
  if (node.__inteliwebCompareGeneration !== generation) return;
  node.__inteliwebCompareImages = { a, b };
  markDirty(node);
}

function restorePreviewState(node) {
  const saved = readPreviewState(node);
  const key = JSON.stringify(saved);
  if (node.__inteliwebCompareRestoreKey === key) return;
  node.__inteliwebCompareRestoreKey = key;
  loadPreviewDescriptors(node, saved);
}

function containRect(image, viewport) {
  if (!image?.naturalWidth || !image?.naturalHeight || viewport.width <= 0 || viewport.height <= 0) {
    return { x: viewport.x, y: viewport.y, width: 0, height: 0 };
  }
  const scale = Math.min(viewport.width / image.naturalWidth, viewport.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height,
  };
}

function drawContained(ctx, image, viewport) {
  if (!image) return;
  const rect = containRect(image, viewport);
  if (rect.width > 0 && rect.height > 0) {
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  }
}

function buttonRects(width, classic = false) {
  const top = rendererTop(classic);
  const leftPad = 8;
  const rightPad = 8;
  const available = width - leftPad - rightPad - BUTTON_GAP * (MODES.length - 1);
  const buttonWidth = Math.max(54, available / MODES.length);
  return MODES.map(([key, icon, label], index) => ({
    key,
    icon,
    label,
    x: leftPad + index * (buttonWidth + BUTTON_GAP),
    y: top + 7,
    width: buttonWidth,
    height: 24,
  }));
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function drawToolbar(ctx, node, width, classic = false) {
  const state = ensureState(node);
  const top = rendererTop(classic);
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, .26)";
  ctx.fillRect(0, top, width, HEADER_HEIGHT);
  ctx.font = "600 17px system-ui, -apple-system, 'Segoe UI Symbol', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const rect of buttonRects(width, classic)) {
    const active = state.compare_mode === rect.key;
    ctx.fillStyle = active ? "rgba(0, 0, 0, .52)" : "rgba(0, 0, 0, .24)";
    ctx.strokeStyle = active ? "rgba(255, 255, 255, .7)" : "rgba(255, 255, 255, .28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 5);
    else ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? "#ffffff" : "#dddddd";
    ctx.fillText(rect.icon, rect.x + rect.width / 2, rect.y + rect.height / 2);
  }
  ctx.restore();
}

function drawBadge(ctx, label, x, y) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,.68)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, 24, 20, 5);
  else ctx.rect(x, y, 24, 20);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 12, y + 10);
  ctx.restore();
}

function drawComparer(ctx, node, width, height, { clearCanvas = true, classic = false } = {}) {
  const state = ensureState(node);
  const images = node.__inteliwebCompareImages;
  const top = rendererTop(classic);
  const imageArea = {
    x: 0,
    y: top + HEADER_HEIGHT,
    width,
    height: Math.max(0, height - top - HEADER_HEIGHT),
  };

  ctx.save();
  if (clearCanvas) ctx.clearRect(0, 0, width, height);
  drawToolbar(ctx, node, width, classic);

  if (!images.a && !images.b) {
    ctx.fillStyle = "rgba(255, 255, 255, .58)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Connect images and run to compare", width / 2, imageArea.y + imageArea.height / 2);
    ctx.restore();
    return;
  }

  if (!images.a || !images.b) {
    const only = images.a || images.b;
    drawContained(ctx, only, imageArea);
    drawBadge(ctx, images.a ? "A" : "B", 8, imageArea.y + 8);
    ctx.restore();
    return;
  }

  if (state.compare_mode === "side_by_side") {
    const gap = 2;
    const half = (width - gap) / 2;
    const left = { x: 0, y: imageArea.y, width: half, height: imageArea.height };
    const right = { x: half + gap, y: imageArea.y, width: half, height: imageArea.height };
    drawContained(ctx, images.a, left);
    drawContained(ctx, images.b, right);
    ctx.fillStyle = "rgba(255, 255, 255, .35)";
    ctx.fillRect(half, imageArea.y, gap, imageArea.height);
    drawBadge(ctx, "A", 8, imageArea.y + 8);
    drawBadge(ctx, "B", half + gap + 8, imageArea.y + 8);
  } else if (state.compare_mode === "toggle") {
    const selected = state.toggle_image === "b" ? images.b : images.a;
    drawContained(ctx, selected, imageArea);
    drawBadge(ctx, state.toggle_image.toUpperCase(), 8, imageArea.y + 8);
  } else if (state.compare_mode === "up_down") {
    const splitY = imageArea.y + imageArea.height * state.split_y;
    drawContained(ctx, images.a, imageArea);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, imageArea.y, width, splitY - imageArea.y);
    ctx.clip();
    drawContained(ctx, images.b, imageArea);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, splitY);
    ctx.lineTo(width, splitY);
    ctx.stroke();
  } else {
    const splitX = width * state.split_x;
    drawContained(ctx, images.a, imageArea);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, imageArea.y, splitX, imageArea.height);
    ctx.clip();
    drawContained(ctx, images.b, imageArea);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX, imageArea.y);
    ctx.lineTo(splitX, height);
    ctx.stroke();
  }
  ctx.restore();
}

function markDirty(node) {
  node.graph?.setDirtyCanvas?.(true, true);
  node.__inteliwebCompareRender?.();
}

function handlePointerDown(node, x, y, width, height, classic = false) {
  const state = ensureState(node);
  const imageTop = rendererTop(classic) + HEADER_HEIGHT;

  for (const rect of buttonRects(width, classic)) {
    if (pointInRect(x, y, rect)) {
      state.compare_mode = rect.key;
      if (rect.key === "left_right") state.split_x = 0;
      if (rect.key === "up_down") state.split_y = 0;
      if (rect.key === "toggle") state.toggle_image = "a";
      markDirty(node);
      return true;
    }
  }

  if (
    y >= imageTop &&
    state.compare_mode === "toggle" &&
    node.__inteliwebCompareImages?.a &&
    node.__inteliwebCompareImages?.b
  ) {
    state.toggle_image = state.toggle_image === "a" ? "b" : "a";
    markDirty(node);
    return true;
  }
  return false;
}

function handlePointerMove(node, x, y, width, height, classic = false) {
  const state = ensureState(node);
  const imageTop = rendererTop(classic) + HEADER_HEIGHT;
  if (y < imageTop || !node.__inteliwebCompareImages?.a || !node.__inteliwebCompareImages?.b) {
    return false;
  }

  if (state.compare_mode === "left_right") {
    state.split_x = clamp(x / Math.max(1, width), 0, 1);
    markDirty(node);
    return true;
  }
  if (state.compare_mode === "up_down") {
    state.split_y = clamp((y - imageTop) / Math.max(1, height - imageTop), 0, 1);
    markDirty(node);
    return true;
  }
  return false;
}

async function applyExecution(node, output) {
  const bySlot = { a: null, b: null };
  for (const data of output?.inteliweb_compare || []) {
    if (data?.slot === "a" || data?.slot === "b") bySlot[data.slot] = data;
  }
  writePreviewState(node, bySlot);
  node.__inteliwebCompareRestoreKey = JSON.stringify(parsePreviewState({ a: bySlot.a, b: bySlot.b }));
  await loadPreviewDescriptors(node, bySlot);
}

function installClassic(nodeType) {
  const originalDraw = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function (ctx) {
    originalDraw?.apply(this, arguments);
    if (isNodes2()) return;
    applyMinimums(this, false);
    drawComparer(ctx, this, this.size[0], this.size[1], { clearCanvas: false, classic: true });
  };

  const originalDown = nodeType.prototype.onMouseDown;
  nodeType.prototype.onMouseDown = function (event, pos, canvas) {
    if (!isNodes2() && handlePointerDown(this, pos[0], pos[1], this.size[0], this.size[1], true)) {
      return true;
    }
    return originalDown?.apply(this, arguments) ?? false;
  };

  const originalMove = nodeType.prototype.onMouseMove;
  nodeType.prototype.onMouseMove = function (event, pos, canvas) {
    if (!isNodes2()) handlePointerMove(this, pos[0], pos[1], this.size[0], this.size[1], true);
    return originalMove?.apply(this, arguments);
  };
}

function removeNodes2Widget(node) {
  const elements = new Set();
  const mounted = node.__inteliwebCompareDom;
  mounted?.observer?.disconnect();
  if (mounted?.root) elements.add(mounted.root);

  for (let index = (node.widgets?.length || 0) - 1; index >= 0; index -= 1) {
    const widget = node.widgets[index];
    if (widget?.name !== DOM_WIDGET_NAME) continue;
    for (const element of [widget.element, widget.inputEl, widget.el]) {
      if (element) elements.add(element);
    }
    widget.onRemove?.();
    node.widgets.splice(index, 1);
  }

  for (const element of elements) {
    const wrapper = element?.closest?.(".lg-node-widget");
    element?.remove?.();
    wrapper?.remove?.();
  }

  node.__inteliwebCompareDom = null;
  node.__inteliwebCompareRender = null;
}

function createNodes2Widget(node) {
  if (!node.addDOMWidget) return false;

  const existingWidgets = (node.widgets || []).filter(
    (widget) => widget?.name === DOM_WIDGET_NAME,
  );
  if (existingWidgets.length === 1 && node.__inteliwebCompareDom?.root) {
    const widget = existingWidgets[0];
    widget.options ||= {};
    widget.options.canvasOnly = false;
    node.__inteliwebCompareRender?.();
    return true;
  }

  removeNodes2Widget(node);

  const root = document.createElement("div");
  root.className = "inteliweb-image-compare";
  root.style.cssText =
    "position:relative;width:100%;height:100%;min-height:180px;overflow:hidden;box-sizing:border-box;";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Image comparison viewer");

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;cursor:default;";
  canvas.title = "Image comparison viewer";
  root.appendChild(canvas);

  const widgetHeight = () => Math.max(180, (node.size?.[1] || MIN_HEIGHT) - 86);
  const logicalSize = () => ({
    width: Math.max(1, root.clientWidth || root.offsetWidth || node.size?.[0] || MIN_WIDTH),
    height: Math.max(1, root.clientHeight || root.offsetHeight || widgetHeight()),
  });

  const render = () => {
    const { width, height } = logicalSize();
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawComparer(ctx, node, width, height);
  };

  node.__inteliwebCompareRender = () => requestAnimationFrame(render);

  const localPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    const { width, height } = logicalSize();
    const scaleX = rect.width > 0 ? width / rect.width : 1;
    const scaleY = rect.height > 0 ? height / rect.height : 1;
    return [
      (event.clientX - rect.left) * scaleX,
      (event.clientY - rect.top) * scaleY,
      width,
      height,
    ];
  };

  canvas.addEventListener("pointerdown", (event) => {
    const [x, y, width, height] = localPoint(event);
    if (handlePointerDown(node, x, y, width, height)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const [x, y, width, height] = localPoint(event);
    const toolbarButton = buttonRects(width).find((rect) =>
      pointInRect(x, y, rect),
    );
    if (toolbarButton) {
      canvas.style.cursor = "pointer";
      canvas.title = toolbarButton.label;
    } else if (handlePointerMove(node, x, y, width, height)) {
      canvas.style.cursor = ensureState(node).compare_mode === "up_down" ? "ns-resize" : "ew-resize";
      canvas.title = "Drag to move the comparison divider";
    } else {
      const toggleArea = y >= HEADER_HEIGHT && ensureState(node).compare_mode === "toggle";
      canvas.style.cursor = toggleArea ? "pointer" : "default";
      canvas.title = toggleArea ? "Click to toggle image A / B" : "Image comparison viewer";
    }
  });

  const widget = node.addDOMWidget(DOM_WIDGET_NAME, "INTELIWEB_IMAGE_COMPARE", root, {
    serialize: false,
    hideOnZoom: false,
    margin: 0,
    getMinHeight: widgetHeight,
    getMaxHeight: widgetHeight,
    getHeight: widgetHeight,
    afterResize: () => requestAnimationFrame(render),
  });
  if (!widget) {
    root.remove();
    node.__inteliwebCompareRender = null;
    return false;
  }

  widget.options ||= {};
  widget.options.canvasOnly = false;
  widget.options.margin = 0;
  widget.computeLayoutSize = () => ({
    minHeight: widgetHeight(),
    maxHeight: widgetHeight(),
    minWidth: MIN_CONTENT_WIDTH,
  });

  const observer = globalThis.ResizeObserver ? new ResizeObserver(render) : null;
  observer?.observe(root);
  node.__inteliwebCompareDom = { root, canvas, observer, widget };

  requestAnimationFrame(render);
  return true;
}

function minimumHeight(nodes2 = isNodes2()) {
  return nodes2 ? MIN_HEIGHT : MIN_HEIGHT + CLASSIC_TOP_OFFSET;
}

function applyMinimums(node, nodes2 = isNodes2()) {
  const minHeight = minimumHeight(nodes2);
  node.min_size ||= [MIN_WIDTH, minHeight];
  node.min_size[0] = MIN_WIDTH;
  node.min_size[1] = minHeight;

  node.size ||= [MIN_WIDTH, minHeight];
  node.size[0] = Math.max(Number(node.size[0]) || 0, MIN_WIDTH);
  node.size[1] = Math.max(Number(node.size[1]) || 0, minHeight);
}

function prepareNode(node, nodes2 = isNodes2(), serializedNode) {
  if (!isImageCompare(node)) return;
  injectStyles();
  ensureState(node);
  migratePreviewState(node, serializedNode);
  removeLegacyPreviewStateArtifacts(node);
  applyMinimums(node, nodes2);

  if (nodes2) createNodes2Widget(node);
  else removeNodes2Widget(node);

  requestAnimationFrame(() => {
    if (!isImageCompare(node)) return;
    removeLegacyPreviewStateArtifacts(node);
    applyMinimums(node, isNodes2());
    restorePreviewState(node);
    node.__inteliwebCompareRender?.();
    markDirty(node);
  });
}

function walkGraph(graph, callback, visited = new WeakSet()) {
  if (!graph || visited.has(graph)) return;
  visited.add(graph);
  for (const node of graph._nodes || graph.nodes || []) {
    if (!node) continue;
    callback(node);
    const innerGraph = node.subgraph || node._graph;
    if (innerGraph && innerGraph !== graph) walkGraph(innerGraph, callback, visited);
  }
}

function syncRendererMode(nodes2 = isNodes2()) {
  walkGraph(app.graph, (node) => {
    if (!isImageCompare(node)) return;
    const widgets = (node.widgets || []).filter(
      (widget) => widget?.name === DOM_WIDGET_NAME,
    );
    const rendererReady = nodes2
      ? widgets.length === 1 && Boolean(node.__inteliwebCompareDom?.root)
      : widgets.length === 0 && !node.__inteliwebCompareDom;
    if (!rendererReady) prepareNode(node, nodes2);
  });
}

function scheduleRendererSync(nodes2 = isNodes2()) {
  const generation = ++rendererSyncGeneration;
  const run = () => {
    if (generation !== rendererSyncGeneration || isNodes2() !== nodes2) return;
    syncRendererMode(nodes2);
  };
  queueMicrotask(run);
  requestAnimationFrame(() => requestAnimationFrame(run));
  window.setTimeout(run, MODE_SETTLE_DELAY_MS);
}

function installModeWatcher() {
  if (window.__inteliwebImageCompareModeWatcher) return;
  window.__inteliwebImageCompareModeWatcher = true;
  let lastMode = isNodes2();
  scheduleRendererSync(lastMode);

  const syncChangedMode = () => {
    const currentMode = isNodes2();
    if (currentMode === lastMode) return;
    lastMode = currentMode;
    scheduleRendererSync(currentMode);
  };

  const settings = app.ui?.settings;
  if (typeof settings?.addEventListener === "function") {
    settings.addEventListener(`${VUE_NODES_SETTING_ID}.change`, () => {
      requestAnimationFrame(syncChangedMode);
    });
    return;
  }
  window.setInterval(syncChangedMode, MODE_WATCH_FALLBACK_INTERVAL_MS);
}

app.registerExtension({
  name: "Inteliweb.ImageCompare",

  setup() {
    injectStyles();
    installModeWatcher();
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS || nodeType.prototype[NODE_PATCH_FLAG]) return;
    nodeType.prototype[NODE_PATCH_FLAG] = true;
    installClassic(nodeType);

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = originalCreated?.apply(this, args);
      queueMicrotask(() => prepareNode(this));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalConfigure?.apply(this, args);
      migratePreviewState(this, args[0]);
      removeLegacyPreviewStateArtifacts(this);
      queueMicrotask(() => prepareNode(this, isNodes2(), args[0]));
      return result;
    };

    const originalResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size, ...args) {
      const minHeight = minimumHeight(isNodes2());
      if (Array.isArray(size)) {
        size[0] = Math.max(MIN_WIDTH, Number(size[0]) || MIN_WIDTH);
        size[1] = Math.max(minHeight, Number(size[1]) || minHeight);
      }
      const result = originalResize?.call(this, size, ...args);
      applyMinimums(this, isNodes2());
      this.__inteliwebCompareRender?.();
      return result;
    };

    const originalExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      originalExecuted?.apply(this, arguments);
      applyExecution(this, output);
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      this.__inteliwebCompareGeneration = (this.__inteliwebCompareGeneration || 0) + 1;
      removeNodes2Widget(this);
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (!isImageCompare(node)) return;
    queueMicrotask(() => prepareNode(node));
  },

  loadedGraphNode(node) {
    if (!isImageCompare(node)) return;
    queueMicrotask(() => prepareNode(node));
  },

  afterConfigureGraph() {
    scheduleRendererSync(isNodes2());
  },
});
