import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLabel";
const DOM_WIDGET_NAME = "label_dom";
const NODE_PATCH_FLAG = "__inteliwebLabelNodePatched";
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 500;
const MODE_WATCH_INTERVAL_MS = 150;
const MODE_SETTLE_DELAY_MS = 180;

const DEFAULTS = Object.freeze({
  text: "Label Inteliweb",
  fontSize: 36,
  fontFamily: "Arial",
  fontStyle: "bold",
  textColor: "#000000",
  backgroundColor: "#a3e635",
  textAlign: "center",
  padding: 16,
  borderRadius: 22,
  opacity: 1,
  lineHeight: 1.0,
});

const FONT_OPTIONS = Object.freeze([
  ["system-ui", "System UI"],
  ["Arial", "Arial"],
  ["Verdana", "Verdana"],
  ["Tahoma", "Tahoma"],
  ["Georgia", "Georgia"],
  ["Times New Roman", "Times New Roman"],
  ["Courier New", "Courier New"],
  ["Impact", "Impact"],
  ["Inter", "Inter"],
  ["Roboto", "Roboto"],
]);

const FONT_STACKS = Object.freeze({
  "system-ui": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  Arial: "Arial, Helvetica, sans-serif",
  Verdana: "Verdana, Geneva, sans-serif",
  Tahoma: "Tahoma, Verdana, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  "Times New Roman": "'Times New Roman', Times, serif",
  "Courier New": "'Courier New', Courier, monospace",
  Impact: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
  Inter: "Inter, Arial, Helvetica, sans-serif",
  Roboto: "Roboto, Arial, Helvetica, sans-serif",
});

let rendererSyncGeneration = 0;

function isLabel(node) {
  return node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS;
}

function isVueNodes() {
  return Boolean(window.LiteGraph?.vueNodesMode);
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function fontStack(fontFamily) {
  return FONT_STACKS[fontFamily] || `'${fontFamily}', system-ui, sans-serif`;
}

function ensureProperties(node) {
  node.properties = node.properties || {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (node.properties[key] === undefined) node.properties[key] = value;
  }
  return node.properties;
}

function readConfig(node) {
  const p = ensureProperties(node);
  const styleChoice = ["normal", "bold", "italic"].includes(p.fontStyle) ? p.fontStyle : "bold";
  return {
    text: String(p.text ?? DEFAULTS.text),
    fontSize: clamp(p.fontSize ?? DEFAULTS.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
    fontFamily: String(p.fontFamily ?? DEFAULTS.fontFamily),
    styleChoice,
    fontWeight: styleChoice === "bold" ? "bold" : "normal",
    fontStyle: styleChoice === "italic" ? "italic" : "normal",
    textColor: String(p.textColor ?? DEFAULTS.textColor),
    backgroundColor: String(p.backgroundColor ?? DEFAULTS.backgroundColor),
    textAlign: ["left", "center", "right"].includes(p.textAlign) ? p.textAlign : "center",
    padding: clamp(p.padding ?? DEFAULTS.padding, 0, 100),
    borderRadius: clamp(p.borderRadius ?? DEFAULTS.borderRadius, 0, 200),
    opacity: clamp(p.opacity ?? DEFAULTS.opacity, 0, 1),
    lineHeight: clamp(p.lineHeight ?? DEFAULTS.lineHeight, 0.8, 2),
  };
}

function fontString(config) {
  return `${config.fontStyle} ${config.fontWeight} ${config.fontSize}px ${fontStack(config.fontFamily)}`;
}

function measureLabel(config) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = fontString(config);
  const lines = (config.text || " ").split("\n");
  const lineHeightPx = config.fontSize * config.lineHeight;
  let maxWidth = 0;
  for (const line of lines) maxWidth = Math.max(maxWidth, context.measureText(line || " ").width);
  return {
    width: Math.max(60, Math.ceil(maxWidth + config.padding * 2)),
    height: Math.max(30, Math.ceil(lines.length * lineHeightPx + config.padding * 2)),
    lines,
    lineHeightPx,
  };
}

function markNodeDirty(node) {
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function resizeToContent(node) {
  const measured = measureLabel(readConfig(node));
  node.__inteliwebLabelMeasure = measured;
  if (node.size) {
    node.size[0] = measured.width;
    node.size[1] = measured.height;
  } else {
    node.size = [measured.width, measured.height];
  }
  markNodeDirty(node);
  return measured;
}

function renderCanvasLabel(context, config, measured) {
  context.save();
  context.globalAlpha = config.opacity;

  if (config.backgroundColor && config.backgroundColor !== "transparent") {
    context.fillStyle = config.backgroundColor;
    context.beginPath();
    if (context.roundRect) context.roundRect(0, 0, measured.width, measured.height, config.borderRadius);
    else context.rect(0, 0, measured.width, measured.height);
    context.fill();
  }

  context.font = fontString(config);
  context.fillStyle = config.textColor;
  context.textBaseline = "top";
  context.textAlign = config.textAlign;
  let x = config.padding;
  if (config.textAlign === "center") x = measured.width / 2;
  else if (config.textAlign === "right") x = measured.width - config.padding;

  measured.lines.forEach((line, index) => {
    context.fillText(line || " ", x, config.padding + index * measured.lineHeightPx);
  });
  context.restore();
}

function injectCss() {
  if (document.getElementById("inteliweb-label-css")) return;
  const style = document.createElement("style");
  style.id = "inteliweb-label-css";
  style.textContent = `
.inteliweb-label-dom {
  display: inline-block !important;
  box-sizing: border-box !important;
  white-space: pre !important;
  align-self: flex-start !important;
  flex: 0 0 auto !important;
  user-select: none !important;
  pointer-events: none !important;
  overflow: visible !important;
}
.lg-node:has(.inteliweb-label-dom) {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  min-width: 0 !important;
  min-height: 0 !important;
}
.lg-node:has(.inteliweb-label-dom) > div,
.lg-node:has(.inteliweb-label-dom) > div > div {
  min-width: 0 !important;
  min-height: 0 !important;
}
.lg-node:has(.inteliweb-label-dom) .lg-node-content,
.lg-node:has(.inteliweb-label-dom) [class*="component-node-background"] {
  padding: 0 !important;
  gap: 0 !important;
  background: transparent !important;
}
.lg-node:has(.inteliweb-label-dom) .lg-node-widgets {
  grid-template-columns: max-content !important;
  padding: 0 !important;
  gap: 0 !important;
  row-gap: 0 !important;
}
.lg-node:has(.inteliweb-label-dom) .lg-node-widget {
  gap: 0 !important;
  padding: 0 !important;
}
.lg-node:has(.inteliweb-label-dom) .lg-node-widget > *:first-child {
  display: none !important;
}
.lg-node:has(.inteliweb-label-dom) .lg-node-widgets,
.lg-node:has(.inteliweb-label-dom) .lg-node-widgets * {
  pointer-events: none !important;
  overflow: visible !important;
}
.lg-node:has(.inteliweb-label-dom) [class*="component-node-background"] > div:has(.bg-node-component-surface),
.lg-node:has(.inteliweb-label-dom) .bg-node-component-surface,
.lg-node:has(.inteliweb-label-dom) > div.absolute.border:not([data-testid]),
.lg-node:has(.inteliweb-label-dom) > div:has(> svg),
.lg-node:has(.inteliweb-label-dom) > div.h-5.w-5 {
  display: none !important;
}
.lg-node:has(.inteliweb-label-dom) [data-testid="node-state-outline-overlay"],
.lg-node:has(.inteliweb-label-dom) > div.absolute.outline-none {
  inset: -2px !important;
}
.inteliweb-label-color {
  width: 100% !important;
  height: 34px !important;
  min-height: 34px !important;
  padding: 2px !important;
  border: 1px solid #484848 !important;
  border-radius: 6px !important;
  background: #1d1d1d !important;
  cursor: pointer !important;
}
.inteliweb-label-background {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.inteliweb-label-transparent {
  position: relative;
  width: 40px;
  height: 34px;
  padding: 4px;
  border: 1px solid #484848;
  border-radius: 6px;
  background: #242424;
  cursor: pointer;
  box-sizing: border-box;
}
.inteliweb-label-transparent:hover { background: #303030; }
.inteliweb-label-transparent.active {
  border-color: #ff6647;
  box-shadow: 0 0 0 1px #ff6647;
  background: #38241f;
}
.inteliweb-label-transparent-checker {
  position: absolute;
  inset: 5px;
  border-radius: 3px;
  background: conic-gradient(#d0d0d0 25%, #777 0 50%, #d0d0d0 0 75%, #777 0) 0 0 / 10px 10px;
}
.inteliweb-label-transparent-slash {
  position: absolute;
  left: 7px;
  right: 7px;
  top: 16px;
  height: 2px;
  border-radius: 2px;
  background: #ff6647;
  transform: rotate(-35deg);
  transform-origin: center;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.35);
}
.inteliweb-label-range {
  display: grid;
  grid-template-columns: 1fr 78px;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.inteliweb-label-range input[type="range"] {
  width: 100%;
  accent-color: #ff6647;
}
.inteliweb-label-number-control {
  display: grid;
  grid-template-columns: 18px minmax(36px, 1fr) 18px;
  align-items: center;
  width: 78px;
  min-width: 78px;
  height: 34px;
  overflow: hidden;
  border: 1px solid #484848;
  border-radius: 6px;
  background: #1d1d1d;
  box-sizing: border-box;
}
.inteliweb-label-number-control input[type="number"] {
  width: 100% !important;
  min-width: 0 !important;
  height: 32px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  color: #f1f1f1 !important;
  text-align: center !important;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
  -moz-appearance: textfield;
}
.inteliweb-label-number-control input[type="number"]::-webkit-inner-spin-button,
.inteliweb-label-number-control input[type="number"]::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
}
.inteliweb-label-number-step {
  display: grid;
  place-items: center;
  width: 18px;
  min-width: 18px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  font: inherit;
  font-size: 9px;
  line-height: 1;
}
.inteliweb-label-number-step:hover { background: #303030; color: #fff; }
.inteliweb-label-number-step:focus-visible {
  outline: 1px solid #bbb;
  outline-offset: -2px;
}
.inteliweb-label-segmented {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  width: 100%;
  border: 1px solid #484848;
  border-radius: 6px;
  overflow: hidden;
  background: #1d1d1d;
}
.inteliweb-label-segmented button {
  min-height: 34px;
  border: 0;
  border-right: 1px solid #484848;
  background: #2b2b2b;
  color: #cccccc;
  cursor: pointer;
  font-weight: 600;
}
.inteliweb-label-segmented button:last-child { border-right: 0; }
.inteliweb-label-segmented button:hover { background: #373737; }
.inteliweb-label-segmented button.active {
  background: #ff6647;
  color: #ffffff;
}
`;
  document.head.appendChild(style);
}

function applyDomStyle(node) {
  const element = node.__inteliwebLabelElement;
  if (!element) return;

  const config = readConfig(node);
  const measured = resizeToContent(node);
  element.textContent = config.text || " ";
  Object.assign(element.style, {
    display: "inline-block",
    width: `${measured.width}px`,
    height: `${measured.height}px`,
    fontFamily: fontStack(config.fontFamily),
    fontSize: `${config.fontSize}px`,
    fontWeight: config.fontWeight,
    fontStyle: config.fontStyle,
    lineHeight: String(config.lineHeight),
    color: config.textColor,
    textAlign: config.textAlign,
    padding: `${config.padding}px`,
    opacity: String(config.opacity),
    background: config.backgroundColor,
    borderRadius: `${config.borderRadius}px`,
  });
}

function removeDomWidgetArtifacts(node) {
  const elements = new Set();
  if (node.__inteliwebLabelElement) elements.add(node.__inteliwebLabelElement);

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

  node.__inteliwebLabelElement = null;
  node.__inteliwebLabelWidget = null;
}

function mountVueLabel(node) {
  injectCss();

  const widgets = (node.widgets || []).filter((widget) => widget?.name === DOM_WIDGET_NAME);
  if (widgets.length === 1 && node.__inteliwebLabelElement) {
    node.__inteliwebLabelWidget = widgets[0];
    applyDomStyle(node);
    return;
  }

  removeDomWidgetArtifacts(node);

  const element = document.createElement("div");
  element.className = "inteliweb-label-dom";

  const widget = node.addDOMWidget?.(DOM_WIDGET_NAME, "INTELIWEB_LABEL", element, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => node.__inteliwebLabelMeasure?.height || 30,
    getMaxHeight: () => node.__inteliwebLabelMeasure?.height || 30,
  });

  node.__inteliwebLabelElement = element;
  node.__inteliwebLabelWidget = widget || null;
  if (widget?.options) widget.options.canvasOnly = false;
  applyDomStyle(node);
}

function unmountVueLabel(node) {
  removeDomWidgetArtifacts(node);
}

function prepareBaseNode(node, resize = true) {
  ensureProperties(node);
  node.flags = node.flags || {};
  node.flags.no_title = true;
  node.resizable = false;
  node.color = "rgba(0,0,0,0)";
  node.bgcolor = "rgba(0,0,0,0)";
  node.badges = [];
  if (node.inputs?.length) node.inputs.length = 0;
  if (node.outputs?.length) node.outputs.length = 0;
  if (resize || !node.__inteliwebLabelMeasure) resizeToContent(node);
}

function syncLabelRenderer(node, vueMode = isVueNodes(), resize = true) {
  if (!isLabel(node)) return;

  const generation = (node.__inteliwebLabelRendererGeneration || 0) + 1;
  node.__inteliwebLabelRendererGeneration = generation;
  node.__inteliwebLabelRendererMode = "transition";
  prepareBaseNode(node, resize);

  if (vueMode) {
    mountVueLabel(node);
    if (node.__inteliwebLabelRendererGeneration !== generation) return;
    node.__inteliwebLabelRendererMode = "vue";
  } else {
    unmountVueLabel(node);
    if (node.__inteliwebLabelRendererGeneration !== generation) return;
    node.__inteliwebLabelRendererMode = "classic";
  }

  markNodeDirty(node);
}

function styleInput(input) {
  Object.assign(input.style, {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #484848",
    borderRadius: "6px",
    background: "#1d1d1d",
    color: "#f1f1f1",
    padding: "8px 10px",
  });
  return input;
}

function field(labelText, input) {
  const row = document.createElement("label");
  Object.assign(row.style, {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    alignItems: "center",
    gap: "12px",
  });
  const label = document.createElement("span");
  label.textContent = labelText;
  label.style.color = "#cccccc";
  label.style.fontSize = "13px";
  row.append(label, input);
  return row;
}

function selectInput(values, current) {
  const select = styleInput(document.createElement("select"));
  for (const [value, label] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === current;
    select.appendChild(option);
  }
  return select;
}

function segmentedInput(values, current) {
  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-label-segmented";
  let selected = current;

  const updateButtons = () => {
    for (const button of wrapper.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.value === selected);
      button.setAttribute("aria-pressed", String(button.dataset.value === selected));
    }
  };

  for (const [value, label] of values) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = value;
    button.textContent = label;
    button.addEventListener("click", () => {
      selected = value;
      updateButtons();
    });
    wrapper.appendChild(button);
  }

  Object.defineProperty(wrapper, "value", {
    configurable: true,
    get: () => selected,
  });

  updateButtons();
  return wrapper;
}

function rangeNumberInput(value, min, max, step = 1, decimals = 0) {
  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-label-range";

  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);

  const number = styleInput(document.createElement("input"));
  number.type = "number";
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);

  const numberControl = document.createElement("div");
  numberControl.className = "inteliweb-label-number-control";

  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.className = "inteliweb-label-number-step";
  decrease.textContent = "◀";
  decrease.title = "Decrease value";
  decrease.setAttribute("aria-label", "Decrease value");

  const increase = document.createElement("button");
  increase.type = "button";
  increase.className = "inteliweb-label-number-step";
  increase.textContent = "▶";
  increase.title = "Increase value";
  increase.setAttribute("aria-label", "Increase value");

  const format = (raw) => {
    const safe = clamp(raw, min, max);
    return decimals > 0 ? safe.toFixed(decimals) : String(Math.round(safe));
  };

  const setBoth = (raw) => {
    const formatted = format(raw);
    range.value = formatted;
    number.value = formatted;
  };

  const adjust = (direction) => {
    const current = Number(number.value);
    const base = Number.isFinite(current) ? current : Number(value) || min;
    setBoth(base + step * direction);
    number.dispatchEvent(new Event("input", { bubbles: true }));
    number.dispatchEvent(new Event("change", { bubbles: true }));
  };

  range.addEventListener("input", () => setBoth(range.value));
  number.addEventListener("input", () => {
    const parsed = Number(number.value);
    if (Number.isFinite(parsed)) range.value = String(clamp(parsed, min, max));
  });
  number.addEventListener("change", () => setBoth(number.value));
  decrease.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    adjust(-1);
  });
  increase.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    adjust(1);
  });
  setBoth(value);

  Object.defineProperty(wrapper, "value", {
    configurable: true,
    get: () => number.value,
  });

  numberControl.append(decrease, number, increase);
  wrapper.append(range, numberControl);
  return wrapper;
}

function colorInput(value, fallback) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "inteliweb-label-color";
  input.value = isHexColor(value) ? value : fallback;
  return input;
}

function backgroundInput(value, rememberedValue = DEFAULTS.backgroundColor) {
  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-label-background";

  const transparent = value === "transparent";
  const rememberedColor = isHexColor(rememberedValue)
    ? rememberedValue
    : isHexColor(value)
      ? value
      : DEFAULTS.backgroundColor;
  const color = colorInput(value, rememberedColor);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "inteliweb-label-transparent";
  button.title = "Transparent background";
  button.setAttribute("aria-label", "Transparent background");

  const checker = document.createElement("span");
  checker.className = "inteliweb-label-transparent-checker";
  const slash = document.createElement("span");
  slash.className = "inteliweb-label-transparent-slash";
  button.append(checker, slash);

  let isTransparent = transparent;
  const refresh = () => {
    button.classList.toggle("active", isTransparent);
    button.setAttribute("aria-pressed", String(isTransparent));
    color.disabled = isTransparent;
    color.style.opacity = isTransparent ? "0.45" : "1";
    color.style.cursor = isTransparent ? "not-allowed" : "pointer";
  };

  button.addEventListener("click", () => {
    isTransparent = !isTransparent;
    refresh();
  });

  Object.defineProperties(wrapper, {
    value: {
      configurable: true,
      get: () => (isTransparent ? "transparent" : color.value),
    },
    colorValue: {
      configurable: true,
      get: () => color.value,
    },
  });

  wrapper.append(color, button);
  refresh();
  return wrapper;
}

function openEditor(node) {
  if (node.__inteliwebCloseEditor) return;
  injectCss();
  const config = readConfig(node);
  const properties = ensureProperties(node);

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "100000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.68)",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    width: "min(620px, calc(100vw - 40px))",
    maxHeight: "calc(100vh - 40px)",
    overflow: "auto",
    border: "1px solid #454545",
    borderRadius: "10px",
    background: "#252525",
    color: "#f4f4f4",
    boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
    padding: "18px",
    fontFamily: "Arial, sans-serif",
  });

  const title = document.createElement("div");
  title.textContent = "Label Editor — Inteliweb";
  Object.assign(title.style, { fontSize: "17px", fontWeight: "700", marginBottom: "16px" });

  const form = document.createElement("div");
  Object.assign(form.style, { display: "grid", gap: "10px" });

  const text = styleInput(document.createElement("textarea"));
  text.value = config.text;
  text.rows = 4;
  text.style.resize = "vertical";
  const fontSize = rangeNumberInput(config.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, 1, 0);
  const fontFamily = selectInput(FONT_OPTIONS, config.fontFamily);
  const fontStyle = segmentedInput(
    [["normal", "Normal"], ["bold", "Bold"], ["italic", "Italic"]],
    config.styleChoice,
  );
  const textColor = colorInput(config.textColor, DEFAULTS.textColor);
  const backgroundColor = backgroundInput(
    config.backgroundColor,
    properties.backgroundColorBeforeTransparent,
  );
  const textAlign = segmentedInput(
    [["left", "Left"], ["center", "Center"], ["right", "Right"]],
    config.textAlign,
  );
  const padding = rangeNumberInput(config.padding, 0, 100, 1, 0);
  const radius = rangeNumberInput(config.borderRadius, 0, 200, 1, 0);
  const opacity = rangeNumberInput(config.opacity, 0, 1, 0.05, 2);
  const lineHeight = rangeNumberInput(config.lineHeight, 0.8, 2, 0.05, 2);

  form.append(
    field("Text", text),
    field("Font size", fontSize),
    field("Font family", fontFamily),
    field("Font style", fontStyle),
    field("Text color", textColor),
    field("Background", backgroundColor),
    field("Alignment", textAlign),
    field("Padding", padding),
    field("Border radius", radius),
    field("Opacity", opacity),
    field("Line height", lineHeight),
  );

  const actions = document.createElement("div");
  Object.assign(actions.style, {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    marginTop: "18px",
  });

  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  const save = document.createElement("button");
  save.textContent = "Save";

  for (const actionButton of [cancel, save]) {
    Object.assign(actionButton.style, {
      border: "0",
      borderRadius: "6px",
      padding: "9px 16px",
      cursor: "pointer",
      fontWeight: "600",
    });
  }
  cancel.style.background = "#3a3a3a";
  cancel.style.color = "#eeeeee";
  save.style.background = "#ff6647";
  save.style.color = "white";

  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
    node.__inteliwebCloseEditor = null;
  };
  node.__inteliwebCloseEditor = close;
  cancel.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKeyDown);

  save.addEventListener("click", () => {
    node.properties = {
      ...ensureProperties(node),
      text: text.value,
      fontSize: clamp(fontSize.value, FONT_SIZE_MIN, FONT_SIZE_MAX),
      fontFamily: fontFamily.value,
      fontStyle: fontStyle.value,
      textColor: textColor.value,
      backgroundColor: backgroundColor.value,
      backgroundColorBeforeTransparent: backgroundColor.colorValue,
      textAlign: textAlign.value,
      padding: Number(padding.value) || 0,
      borderRadius: Number(radius.value) || 0,
      opacity: Number(opacity.value),
      lineHeight: Number(lineHeight.value) || DEFAULTS.lineHeight,
    };
    resizeToContent(node);
    if (node.__inteliwebLabelRendererMode === "vue") applyDomStyle(node);
    markNodeDirty(node);
    close();
  });

  actions.append(cancel, save);
  panel.append(title, form, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  text.focus();
}

function installClassicDrawHook() {
  if (window.__inteliwebLabelDrawWrapped) return;
  const prototype = window.LGraphCanvas?.prototype;
  if (typeof prototype?.drawNode !== "function") return;

  window.__inteliwebLabelDrawWrapped = true;
  const originalDrawNode = prototype.drawNode;
  prototype.drawNode = function (node, context) {
    if (
      !isLabel(node)
      || isVueNodes()
      || node.__inteliwebLabelRendererMode !== "classic"
      || !context
    ) {
      return originalDrawNode.apply(this, arguments);
    }

    const config = readConfig(node);
    const measured = node.__inteliwebLabelMeasure || resizeToContent(node);
    node.badges = [];

    const originalFill = context.fill;
    const originalFillText = context.fillText;
    context.fill = function () {};
    context.fillText = function () {};

    let result;
    try {
      result = originalDrawNode.apply(this, arguments);
    } finally {
      context.fill = originalFill;
      context.fillText = originalFillText;
    }

    renderCanvasLabel(context, config, measured);
    return result;
  };
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

function syncRendererMode(vueMode = isVueNodes()) {
  walkGraph(app.graph, (node) => {
    if (isLabel(node)) syncLabelRenderer(node, vueMode, true);
  });
}

function scheduleRendererSync(vueMode = isVueNodes()) {
  const generation = ++rendererSyncGeneration;
  const run = () => {
    if (generation !== rendererSyncGeneration || isVueNodes() !== vueMode) return;
    syncRendererMode(vueMode);
  };

  queueMicrotask(run);
  requestAnimationFrame(() => requestAnimationFrame(run));
  window.setTimeout(run, MODE_SETTLE_DELAY_MS);
}

function installModeWatcher() {
  if (window.__inteliwebLabelModeWatcher) return;
  window.__inteliwebLabelModeWatcher = true;
  let lastMode = isVueNodes();
  scheduleRendererSync(lastMode);

  window.setInterval(() => {
    const currentMode = isVueNodes();
    if (currentMode === lastMode) return;
    lastMode = currentMode;
    scheduleRendererSync(currentMode);
  }, MODE_WATCH_INTERVAL_MS);
}

app.registerExtension({
  name: "inteliweb.label",

  setup() {
    injectCss();
    installClassicDrawHook();
    installModeWatcher();
  },

  getNodeMenuItems(node) {
    if (!isLabel(node)) return [];
    return [null, { content: "✏️ Edit Label (Inteliweb)", callback: () => openEditor(node) }];
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS || nodeType.prototype[NODE_PATCH_FLAG]) return;
    nodeType.prototype[NODE_PATCH_FLAG] = true;
    nodeType.title_mode = LiteGraph.NO_TITLE;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = originalCreated?.apply(this, args);
      queueMicrotask(() => syncLabelRenderer(this, isVueNodes(), true));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalConfigure?.apply(this, args);
      queueMicrotask(() => syncLabelRenderer(this, isVueNodes(), true));
      return result;
    };

    nodeType.prototype.computeSize = function (out) {
      const measured = this.__inteliwebLabelMeasure || measureLabel(readConfig(this));
      if (out) {
        out[0] = measured.width;
        out[1] = measured.height;
        return out;
      }
      return [measured.width, measured.height];
    };

    nodeType.prototype.onDrawForeground = function () {};

    nodeType.prototype.onDblClick = function () {
      openEditor(this);
      return true;
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      this.__inteliwebCloseEditor?.();
      this.__inteliwebLabelRendererMode = "removed";
      unmountVueLabel(this);
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (!isLabel(node)) return;
    queueMicrotask(() => syncLabelRenderer(node, isVueNodes(), true));
  },

  loadedGraphNode(node) {
    if (!isLabel(node)) return;
    queueMicrotask(() => syncLabelRenderer(node, isVueNodes(), true));
  },

  afterConfigureGraph() {
    scheduleRendererSync(isVueNodes());
  },
});

if (!window.__inteliwebLabelDblClickInstalled) {
  window.__inteliwebLabelDblClickInstalled = true;
  document.addEventListener("dblclick", (event) => {
    if (!isVueNodes()) return;
    walkGraph(app.graph, (node) => {
      if (event.__inteliwebLabelHandled || !isLabel(node)) return;
      const element = node.__inteliwebLabelElement;
      if (!element?.isConnected) return;
      const rect = element.getBoundingClientRect();
      if (
        event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom
      ) {
        event.__inteliwebLabelHandled = true;
        openEditor(node);
      }
    });
  }, true);
}
