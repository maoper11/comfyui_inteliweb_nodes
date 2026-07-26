import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_CLASS = "InteliwebImageCompare";
const MODES = Object.freeze([
  ["left_right", "Left Right"],
  ["up_down", "Up Down"],
  ["toggle", "Toggle"],
  ["side_by_side", "Side by Side"],
]);

const HEADER_HEIGHT = 38;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 300;
const BUTTON_GAP = 4;
const STATE_VERSION = 3;
const PREVIEW_STATE_VERSION = 1;

function isNodes2() {
  return Boolean(window.LiteGraph?.vueNodesMode);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  return node.widgets?.find((widget) => widget.name === "preview_state");
}

function hidePreviewStateWidget(node) {
  const widget = previewStateWidget(node);
  if (!widget || widget.__inteliwebHidden) return;
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
  return parsePreviewState(previewStateWidget(node)?.value);
}

function writePreviewState(node, bySlot) {
  const widget = previewStateWidget(node);
  if (!widget) return;
  const serialized = JSON.stringify({
    version: PREVIEW_STATE_VERSION,
    a: cleanPreviewDescriptor(bySlot.a, "a"),
    b: cleanPreviewDescriptor(bySlot.b, "b"),
  });
  widget.value = serialized;
  widget.callback?.(serialized, node, widget);
  node.graph?.setDirtyCanvas?.(true, true);
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
  hidePreviewStateWidget(node);
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
  if (rect.width > 0 && rect.height > 0) ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
}

function buttonRects(width, classic = false) {
  const leftPad = classic ? 86 : 8;
  const rightPad = 8;
  const available = width - leftPad - rightPad - BUTTON_GAP * (MODES.length - 1);
  const buttonWidth = Math.max(54, available / MODES.length);
  return MODES.map(([key, label], index) => ({
    key,
    label,
    x: leftPad + index * (buttonWidth + BUTTON_GAP),
    y: 7,
    width: buttonWidth,
    height: 24,
  }));
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function drawToolbar(ctx, node, width, classic = false) {
  const state = ensureState(node);
  ctx.save();
  ctx.fillStyle = "#242424";
  ctx.fillRect(0, 0, width, HEADER_HEIGHT);
  ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const rect of buttonRects(width, classic)) {
    const active = state.compare_mode === rect.key;
    ctx.fillStyle = active ? "#1c1c1c" : "#343434";
    ctx.strokeStyle = active ? "#707070" : "#505050";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 5);
    else ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? "#ffffff" : "#dddddd";
    ctx.fillText(rect.label, rect.x + rect.width / 2, rect.y + rect.height / 2);
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
  const imageArea = { x: 0, y: HEADER_HEIGHT, width, height: Math.max(0, height - HEADER_HEIGHT) };

  ctx.save();
  if (clearCanvas) ctx.clearRect(0, 0, width, height);
  drawToolbar(ctx, node, width, classic);
  ctx.fillStyle = "#111111";
  ctx.fillRect(imageArea.x, imageArea.y, imageArea.width, imageArea.height);

  if (!images.a && !images.b) {
    ctx.fillStyle = "#777777";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Connect images and run to compare", width / 2, HEADER_HEIGHT + imageArea.height / 2);
    ctx.restore();
    return;
  }

  if (!images.a || !images.b) {
    const only = images.a || images.b;
    drawContained(ctx, only, imageArea);
    drawBadge(ctx, images.a ? "A" : "B", 8, HEADER_HEIGHT + 8);
    ctx.restore();
    return;
  }

  if (state.compare_mode === "side_by_side") {
    const gap = 2;
    const half = (width - gap) / 2;
    const left = { x: 0, y: HEADER_HEIGHT, width: half, height: imageArea.height };
    const right = { x: half + gap, y: HEADER_HEIGHT, width: half, height: imageArea.height };
    drawContained(ctx, images.a, left);
    drawContained(ctx, images.b, right);
    ctx.fillStyle = "#555555";
    ctx.fillRect(half, HEADER_HEIGHT, gap, imageArea.height);
    drawBadge(ctx, "A", 8, HEADER_HEIGHT + 8);
    drawBadge(ctx, "B", half + gap + 8, HEADER_HEIGHT + 8);
  } else if (state.compare_mode === "toggle") {
    const selected = state.toggle_image === "b" ? images.b : images.a;
    drawContained(ctx, selected, imageArea);
    drawBadge(ctx, state.toggle_image.toUpperCase(), 8, HEADER_HEIGHT + 8);
  } else if (state.compare_mode === "up_down") {
    const splitY = HEADER_HEIGHT + imageArea.height * state.split_y;
    drawContained(ctx, images.a, imageArea);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, width, splitY - HEADER_HEIGHT);
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
    ctx.rect(0, HEADER_HEIGHT, splitX, imageArea.height);
    ctx.clip();
    drawContained(ctx, images.b, imageArea);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX, HEADER_HEIGHT);
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
    y >= HEADER_HEIGHT &&
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

function handlePointerMove(node, x, y, width, height) {
  const state = ensureState(node);
  if (y < HEADER_HEIGHT || !node.__inteliwebCompareImages?.a || !node.__inteliwebCompareImages?.b) return false;
  if (state.compare_mode === "left_right") {
    state.split_x = clamp(x / Math.max(1, width), 0, 1);
    markDirty(node);
    return true;
  }
  if (state.compare_mode === "up_down") {
    state.split_y = clamp((y - HEADER_HEIGHT) / Math.max(1, height - HEADER_HEIGHT), 0, 1);
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
    drawComparer(ctx, this, this.size[0], this.size[1], { clearCanvas: false, classic: true });
  };

  const originalDown = nodeType.prototype.onMouseDown;
  nodeType.prototype.onMouseDown = function (event, pos, canvas) {
    if (!isNodes2() && handlePointerDown(this, pos[0], pos[1], this.size[0], this.size[1], true)) return true;
    return originalDown?.apply(this, arguments) ?? false;
  };

  const originalMove = nodeType.prototype.onMouseMove;
  nodeType.prototype.onMouseMove = function (event, pos, canvas) {
    if (!isNodes2()) handlePointerMove(this, pos[0], pos[1], this.size[0], this.size[1]);
    return originalMove?.apply(this, arguments);
  };
}

function createNodes2Widget(node) {
  if (!node.addDOMWidget || node.__inteliwebCompareDom) return;
  const root = document.createElement("div");
  root.className = "inteliweb-image-compare";
  root.style.cssText = "position:relative;width:100%;height:100%;min-height:240px;flex:1 1 0;overflow:hidden;box-sizing:border-box;";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;cursor:default;";
  root.appendChild(canvas);

  const render = () => {
    const rect = root.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
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
    return [event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height];
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
    if (handlePointerMove(node, x, y, width, height)) {
      canvas.style.cursor = ensureState(node).compare_mode === "up_down" ? "ns-resize" : "ew-resize";
    } else {
      canvas.style.cursor = y < HEADER_HEIGHT || ensureState(node).compare_mode === "toggle" ? "pointer" : "default";
    }
  });

  const observer = new ResizeObserver(render);
  observer.observe(root);
  node.__inteliwebCompareDom = { root, canvas, observer };
  const widget = node.addDOMWidget("inteliweb_compare", "inteliweb_compare", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => MIN_HEIGHT - HEADER_HEIGHT,
  });
  widget.computeLayoutSize = () => ({ minHeight: MIN_HEIGHT - HEADER_HEIGHT, minWidth: 1 });
  requestAnimationFrame(render);
}

app.registerExtension({
  name: "Inteliweb.ImageCompare",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_CLASS) return;
    installClassic(nodeType);

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      originalCreated?.apply(this, arguments);
      ensureState(this);
      hidePreviewStateWidget(this);
      this.size = [Math.max(this.size?.[0] || 0, MIN_WIDTH), Math.max(this.size?.[1] || 0, MIN_HEIGHT)];
      if (isNodes2()) createNodes2Widget(this);
      requestAnimationFrame(() => restorePreviewState(this));
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      originalConfigure?.apply(this, arguments);
      ensureState(this);
      hidePreviewStateWidget(this);
      if (isNodes2()) createNodes2Widget(this);
      requestAnimationFrame(() => restorePreviewState(this));
    };

    const originalExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      originalExecuted?.apply(this, arguments);
      applyExecution(this, output);
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this.__inteliwebCompareGeneration = (this.__inteliwebCompareGeneration || 0) + 1;
      this.__inteliwebCompareDom?.observer?.disconnect();
      this.__inteliwebCompareDom = null;
      this.__inteliwebCompareRender = null;
      originalRemoved?.apply(this, arguments);
    };
  },
});
