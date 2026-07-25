import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLabel";
const CONFIG_WIDGETS = [
  "text",
  "font_size",
  "font_family",
  "font_weight",
  "text_color",
  "background_color",
  "text_align",
  "padding",
  "border_radius",
  "opacity",
  "line_height",
];

function widgetByName(node, name) {
  return node.widgets?.find((widget) => widget.name === name);
}

function valueOf(node, name, fallback) {
  return widgetByName(node, name)?.value ?? fallback;
}

function setValue(node, name, value) {
  const widget = widgetByName(node, name);
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value, node, widget);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function readConfig(node) {
  return {
    text: String(valueOf(node, "text", "Label Inteliweb")),
    fontSize: clamp(valueOf(node, "font_size", 36), 8, 160),
    fontFamily: String(valueOf(node, "font_family", "Arial")),
    fontWeight: String(valueOf(node, "font_weight", "bold")),
    textColor: String(valueOf(node, "text_color", "#000000")),
    backgroundColor: String(valueOf(node, "background_color", "#a3e635")),
    textAlign: String(valueOf(node, "text_align", "center")),
    padding: clamp(valueOf(node, "padding", 16), 0, 96),
    borderRadius: clamp(valueOf(node, "border_radius", 22), 0, 96),
    opacity: clamp(valueOf(node, "opacity", 1), 0.1, 1),
    lineHeight: clamp(valueOf(node, "line_height", 1.1), 0.8, 2),
  };
}

function hideConfigWidgets(node) {
  for (const name of CONFIG_WIDGETS) {
    const widget = widgetByName(node, name);
    if (!widget || widget.__inteliwebHidden) continue;
    widget.__inteliwebHidden = true;
    widget.type = "hidden";
    widget.computeSize = () => [0, -4];
  }
}

function measureLabel(config) {
  const probe = document.createElement("div");
  probe.textContent = config.text || " ";
  Object.assign(probe.style, {
    position: "fixed",
    left: "-10000px",
    top: "-10000px",
    visibility: "hidden",
    pointerEvents: "none",
    whiteSpace: "pre",
    width: "max-content",
    boxSizing: "border-box",
    fontFamily: config.fontFamily,
    fontSize: `${config.fontSize}px`,
    fontWeight: config.fontWeight,
    lineHeight: String(config.lineHeight),
    padding: `${config.padding}px`,
  });
  document.body.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  return {
    width: Math.max(80, Math.min(920, Math.ceil(rect.width) + 2)),
    height: Math.max(36, Math.ceil(rect.height) + 2),
  };
}

function renderLabel(node, resizeNode = false) {
  const element = node.__inteliwebLabelElement;
  if (!element) return;

  const config = readConfig(node);
  const measured = measureLabel(config);
  node.__inteliwebLabelHeight = measured.height;

  element.textContent = config.text || " ";
  Object.assign(element.style, {
    display: "flex",
    alignItems: "center",
    justifyContent:
      config.textAlign === "left"
        ? "flex-start"
        : config.textAlign === "right"
          ? "flex-end"
          : "center",
    width: `${measured.width}px`,
    height: `${measured.height}px`,
    minWidth: `${measured.width}px`,
    minHeight: `${measured.height}px`,
    maxWidth: `${measured.width}px`,
    maxHeight: `${measured.height}px`,
    margin: "0",
    boxSizing: "border-box",
    whiteSpace: "pre",
    overflow: "hidden",
    pointerEvents: "none",
    userSelect: "none",
    fontFamily: config.fontFamily,
    fontSize: `${config.fontSize}px`,
    fontWeight: config.fontWeight,
    lineHeight: String(config.lineHeight),
    color: config.textColor,
    background: config.backgroundColor,
    textAlign: config.textAlign,
    padding: `${config.padding}px`,
    borderRadius: `${config.borderRadius}px`,
    opacity: String(config.opacity),
  });

  if (resizeNode) {
    // Keep the widget minimum independent from node.size. Tying getMinHeight
    // to node.size creates a positive feedback loop and makes the node grow.
    node.size = [measured.width, measured.height + 8];
  }

  node.setDirtyCanvas?.(true, true);
}

function createLabelWidget(node) {
  if (node.__inteliwebLabelElement) return;

  const element = document.createElement("div");
  element.className = "inteliweb-label-preview";
  node.__inteliwebLabelElement = element;

  const widget = node.addDOMWidget?.("label_preview", "INTELIWEB_LABEL", element, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => node.__inteliwebLabelHeight || 48,
  });

  if (widget?.options) widget.options.canvasOnly = false;
  renderLabel(node, true);
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
  for (const [value, label = value] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === current;
    select.appendChild(option);
  }
  return select;
}

function numberInput(value, minimum, maximum, step = 1) {
  const input = styleInput(document.createElement("input"));
  input.type = "number";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.value = String(value);
  return input;
}

function openEditor(node) {
  if (node.__inteliwebCloseEditor) return;
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
  const textAlign = selectInput([["left", "Left"], ["center", "Center"], ["right", "Right"]], config.textAlign);

  const textColor = styleInput(document.createElement("input"));
  textColor.type = "color";
  textColor.value = /^#[0-9a-f]{6}$/i.test(config.textColor) ? config.textColor : "#000000";

  const backgroundColor = styleInput(document.createElement("input"));
  backgroundColor.type = "color";
  backgroundColor.value = /^#[0-9a-f]{6}$/i.test(config.backgroundColor)
    ? config.backgroundColor
    : "#a3e635";

  const padding = numberInput(config.padding, 0, 96);
  const radius = numberInput(config.borderRadius, 0, 96);
  const opacity = numberInput(config.opacity, 0.1, 1, 0.05);
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
    setValue(node, "text", text.value);
    setValue(node, "font_size", Number(fontSize.value) || 36);
    setValue(node, "font_family", fontFamily.value);
    setValue(node, "font_weight", fontWeight.value);
    setValue(node, "text_color", textColor.value);
    setValue(node, "background_color", backgroundColor.value);
    setValue(node, "text_align", textAlign.value);
    setValue(node, "padding", Number(padding.value) || 0);
    setValue(node, "border_radius", Number(radius.value) || 0);
    setValue(node, "opacity", Number(opacity.value) || 1);
    setValue(node, "line_height", Number(lineHeight.value) || 1.1);
    renderLabel(node, true);
    node.graph?.setDirtyCanvas?.(true, true);
    close();
  });

  actions.append(cancel, save);
  panel.append(title, form, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  text.focus();
}

function prepareNode(node, resizeNode = false) {
  hideConfigWidgets(node);
  node.flags = node.flags || {};
  node.flags.no_title = true;
  node.resizable = false;
  node.color = "rgba(0,0,0,0)";
  node.bgcolor = "rgba(0,0,0,0)";
  createLabelWidget(node);
  renderLabel(node, resizeNode);
}

app.registerExtension({
  name: "inteliweb.label",

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

    nodeType.prototype.onDblClick = function () {
      openEditor(this);
      return true;
    };

    const originalMenu = nodeType.prototype.getExtraMenuOptions;
    nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
      originalMenu?.apply(this, arguments);
      options.unshift({
        content: "✏️ Edit Label (Inteliweb)",
        callback: () => openEditor(this),
      });
      return options;
    };

    const originalRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      this.__inteliwebCloseEditor?.();
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node, true));
  },
});
