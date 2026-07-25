import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLabel";
const DEFAULTS = Object.freeze({
  text: "Label Inteliweb",
  fontSize: 36,
  fontFamily: "Arial",
  fontWeight: "bold",
  textColor: "#000000",
  backgroundColor: "#a3e635",
  textAlign: "center",
  padding: 16,
  borderRadius: 22,
  opacity: 1,
  lineHeight: 1.1,
});

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

function ensureProperties(node) {
  node.properties = node.properties || {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (node.properties[key] === undefined) node.properties[key] = value;
  }
  return node.properties;
}

function readConfig(node) {
  const p = ensureProperties(node);
  return {
    text: String(p.text ?? DEFAULTS.text),
    fontSize: clamp(p.fontSize ?? DEFAULTS.fontSize, 8, 160),
    fontFamily: String(p.fontFamily ?? DEFAULTS.fontFamily),
    fontWeight: p.fontWeight === "normal" ? "normal" : "bold",
    textColor: String(p.textColor ?? DEFAULTS.textColor),
    backgroundColor: String(p.backgroundColor ?? DEFAULTS.backgroundColor),
    textAlign: ["left", "center", "right"].includes(p.textAlign) ? p.textAlign : "center",
    padding: clamp(p.padding ?? DEFAULTS.padding, 0, 96),
    borderRadius: clamp(p.borderRadius ?? DEFAULTS.borderRadius, 0, 96),
    opacity: clamp(p.opacity ?? DEFAULTS.opacity, 0, 1),
    lineHeight: clamp(p.lineHeight ?? DEFAULTS.lineHeight, 0.8, 2),
  };
}

function fontString(config) {
  return `${config.fontWeight} ${config.fontSize}px '${config.fontFamily}', system-ui, sans-serif`;
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

function resizeToContent(node) {
  const measured = measureLabel(readConfig(node));
  node.__inteliwebLabelMeasure = measured;
  if (node.size) {
    node.size[0] = measured.width;
    node.size[1] = measured.height;
  } else {
    node.size = [measured.width, measured.height];
  }
  node.graph?.setDirtyCanvas?.(true, true);
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
.inteliweb-label-range {
  display: grid;
  grid-template-columns: 1fr 48px;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.inteliweb-label-range input[type="range"] {
  width: 100%;
  accent-color: #ff6647;
}
.inteliweb-label-range output {
  color: #f1f1f1;
  text-align: right;
  font-variant-numeric: tabular-nums;
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
    display: isVueNodes() ? "inline-block" : "none",
    width: `${measured.width}px`,
    height: `${measured.height}px`,
    fontFamily: `'${config.fontFamily}', system-ui, sans-serif`,
    fontSize: `${config.fontSize}px`,
    fontWeight: config.fontWeight,
    lineHeight: String(config.lineHeight),
    color: config.textColor,
    textAlign: config.textAlign,
    padding: `${config.padding}px`,
    opacity: String(config.opacity),
    background: config.backgroundColor,
    borderRadius: `${config.borderRadius}px`,
  });
}

function createDomLabel(node) {
  injectCss();
  if (node.__inteliwebLabelElement) {
    applyDomStyle(node);
    return;
  }

  const element = document.createElement("div");
  element.className = "inteliweb-label-dom";
  node.__inteliwebLabelElement = element;

  const widget = node.addDOMWidget?.("label_dom", "INTELIWEB_LABEL", element, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => node.__inteliwebLabelMeasure?.height || 30,
  });
  if (widget?.options) widget.options.canvasOnly = false;
  applyDomStyle(node);
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

function numberInput(value, min, max, step = 1) {
  const input = styleInput(document.createElement("input"));
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return input;
}

function rangeInput(value, min, max, step = 0.05) {
  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-label-range";

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const output = document.createElement("output");
  const updateOutput = () => {
    output.value = Number(input.value).toFixed(2);
    output.textContent = output.value;
  };
  input.addEventListener("input", updateOutput);
  updateOutput();

  Object.defineProperty(wrapper, "value", {
    configurable: true,
    get: () => input.value,
  });

  wrapper.append(input, output);
  return wrapper;
}

function colorInput(value, fallback) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "inteliweb-label-color";
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return input;
}

function openEditor(node) {
  if (node.__inteliwebCloseEditor) return;
  injectCss();
  const config = readConfig(node);

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
  const fontSize = numberInput(config.fontSize, 8, 160);
  const fontFamily = selectInput(
    ["Arial", "Inter", "Roboto", "Verdana", "Tahoma", "Georgia", "Times New Roman", "Courier New", "Impact"].map((name) => [name, name]),
    config.fontFamily,
  );
  const fontWeight = selectInput([["normal", "Normal"], ["bold", "Bold"]], config.fontWeight);
  const textColor = colorInput(config.textColor, "#000000");
  const backgroundColor = colorInput(config.backgroundColor, "#a3e635");
  const textAlign = selectInput([["left", "Left"], ["center", "Center"], ["right", "Right"]], config.textAlign);
  const padding = numberInput(config.padding, 0, 96);
  const radius = numberInput(config.borderRadius, 0, 96);
  const opacity = rangeInput(config.opacity, 0, 1, 0.05);
  const lineHeight = numberInput(config.lineHeight, 0.8, 2, 0.05);

  form.append(
    field("Text", text),
    field("Font size", fontSize),
    field("Font family", fontFamily),
    field("Font weight", fontWeight),
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

  for (const button of [cancel, save]) {
    Object.assign(button.style, {
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
      fontSize: Number(fontSize.value) || DEFAULTS.fontSize,
      fontFamily: fontFamily.value,
      fontWeight: fontWeight.value,
      textColor: textColor.value,
      backgroundColor: backgroundColor.value,
      textAlign: textAlign.value,
      padding: Number(padding.value) || 0,
      borderRadius: Number(radius.value) || 0,
      opacity: Number(opacity.value),
      lineHeight: Number(lineHeight.value) || 1,
    };
    resizeToContent(node);
    if (node.__inteliwebLabelElement) applyDomStyle(node);
    node.graph?.setDirtyCanvas?.(true, true);
    close();
  });

  actions.append(cancel, save);
  panel.append(title, form, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  text.focus();
}

function prepareNode(node, resize = false) {
  ensureProperties(node);
  node.flags = node.flags || {};
  node.flags.no_title = true;
  node.resizable = false;
  node.color = "rgba(0,0,0,0)";
  node.bgcolor = "rgba(0,0,0,0)";
  node.badges = [];
  if (node.inputs?.length) node.inputs.length = 0;
  if (node.outputs?.length) node.outputs.length = 0;
  if (resize) resizeToContent(node);
  if (isVueNodes()) createDomLabel(node);
  else if (node.__inteliwebLabelElement) node.__inteliwebLabelElement.style.display = "none";
}

function installClassicDrawHook() {
  if (window.__inteliwebLabelDrawWrapped) return;
  const prototype = window.LGraphCanvas?.prototype;
  if (typeof prototype?.drawNode !== "function") return;

  window.__inteliwebLabelDrawWrapped = true;
  const originalDrawNode = prototype.drawNode;
  prototype.drawNode = function (node, context) {
    if (!isLabel(node) || isVueNodes() || !context) {
      return originalDrawNode.apply(this, arguments);
    }

    const config = readConfig(node);
    const measured = node.__inteliwebLabelMeasure || resizeToContent(node);
    node.badges = [];

    const originalFill = context.fill;
    const originalFillText = context.fillText;

    // Suppress ComfyUI's node body and internal label/category text. Restore the
    // canvas methods before drawing the actual label so opacity applies equally
    // to the background and text.
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

function syncRendererMode() {
  for (const node of app.graph?._nodes || []) {
    if (!isLabel(node)) continue;
    prepareNode(node, false);
    if (isVueNodes()) {
      createDomLabel(node);
      applyDomStyle(node);
    } else if (node.__inteliwebLabelElement) {
      node.__inteliwebLabelElement.style.display = "none";
    }
    node.setDirtyCanvas?.(true, true);
  }
}

function installModeWatcher() {
  if (window.__inteliwebLabelModeWatcher) return;
  window.__inteliwebLabelModeWatcher = true;
  let lastMode = isVueNodes();
  window.setInterval(() => {
    const currentMode = isVueNodes();
    if (currentMode === lastMode) return;
    lastMode = currentMode;
    requestAnimationFrame(() => requestAnimationFrame(syncRendererMode));
  }, 250);
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

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    nodeType.title_mode = LiteGraph.NO_TITLE;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const result = originalCreated?.apply(this, args);
      queueMicrotask(() => prepareNode(this, true));
      return result;
    };

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (...args) {
      const result = originalConfigure?.apply(this, args);
      queueMicrotask(() => prepareNode(this, false));
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
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (!isLabel(node)) return;
    queueMicrotask(() => prepareNode(node, true));
  },
});

if (!window.__inteliwebLabelDblClickInstalled) {
  window.__inteliwebLabelDblClickInstalled = true;
  document.addEventListener("dblclick", (event) => {
    if (!isVueNodes()) return;
    for (const node of app.graph?._nodes || []) {
      if (!isLabel(node)) continue;
      const element = node.__inteliwebLabelElement;
      if (!element?.isConnected) continue;
      const rect = element.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        openEditor(node);
        break;
      }
    }
  }, true);
}
