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
  const widget = widgetByName(node, name);
  return widget?.value ?? fallback;
}

function setValue(node, name, value) {
  const widget = widgetByName(node, name);
  if (!widget) return;
  widget.value = value;
  widget.callback?.(value, node, widget);
}

function hideConfigWidgets(node) {
  for (const name of CONFIG_WIDGETS) {
    const widget = widgetByName(node, name);
    if (!widget || widget.__inteliwebHidden) continue;
    widget.__inteliwebHidden = true;
    widget.__inteliwebOriginalType = widget.type;
    widget.type = "hidden";
    widget.computeSize = () => [0, -4];
  }
}

function readConfig(node) {
  return {
    text: String(valueOf(node, "text", "Label Inteliweb")),
    fontSize: Number(valueOf(node, "font_size", 36)) || 36,
    fontFamily: String(valueOf(node, "font_family", "Arial")),
    fontWeight: String(valueOf(node, "font_weight", "bold")),
    textColor: String(valueOf(node, "text_color", "#000000")),
    backgroundColor: String(valueOf(node, "background_color", "#a3e635")),
    textAlign: String(valueOf(node, "text_align", "center")),
    padding: Number(valueOf(node, "padding", 16)) || 0,
    borderRadius: Number(valueOf(node, "border_radius", 22)) || 0,
    opacity: Number(valueOf(node, "opacity", 1)) || 1,
    lineHeight: Number(valueOf(node, "line_height", 1.1)) || 1.1,
  };
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
    maxWidth: "900px",
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

function applyStyle(node, fit = false) {
  const element = node.__inteliwebLabelElement;
  if (!element) return;

  const config = readConfig(node);
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
    width: "100%",
    height: "100%",
    minHeight: "32px",
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
    opacity: String(Math.min(1, Math.max(0.1, config.opacity))),
  });

  if (fit) {
    const measured = measureLabel(config);
    node.size = [measured.width, measured.height];
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
    getMinHeight: () => Math.max(32, node.size?.[1] || 32),
  });

  if (widget?.options) {
    widget.options.canvasOnly = false;
  }

  applyStyle(node, true);
}

function makeField(labelText, input) {
  const row = document.createElement("label");
  Object.assign(row.style, {
    display: "grid",
    gridTemplateColumns: "145px 1fr",
    alignItems: "center",
    gap: "12px",
  });

  const label = document.createElement("span");
  label.textContent = labelText;
  label.style.color = "#c8c8c8";
  label.style.fontSize = "13px";
  row.append(label, input);
  return row;
}

function styleInput(input) {
  Object.assign(input.style, {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #454545",
    borderRadius: "6px",
    background: "#1d1d1d",
    color: "#f1f1f1",
    padding: "8px 10px",
  });
  return input;
}

function openEditor(node) {
  if (node.__inteliwebLabelEditorOpen) return;
  node.__inteliwebLabelEditorOpen = true;

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
    border: "1px solid #444",
    borderRadius: "10px",
    background: "#252525",
    color: "#f4f4f4",
    boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
    padding: "18px",
    fontFamily: "Arial, sans-serif",
  });

  const title = document.createElement("div");
  title.textContent = "Label Editor — Inteliweb";
  Object.assign(title.style, {
    fontSize: "17px",
    fontWeight: "700",
    marginBottom: "16px",
  });

  const form = document.createElement("div");
  Object.assign(form.style, { display: "grid", gap: "10px" });

  const text = styleInput(document.createElement("textarea"));
  text.value = config.text;
  text.rows = 4;
  text.style.resize = "vertical";

  const fontSize = styleInput(document.createElement("input"));
  fontSize.type = "number";
  fontSize.min = "8";
  fontSize.max = "160";
  fontSize.value = String(config.fontSize);

  const fontFamily = styleInput(document.createElement("select"));
  for (const name of [
    "Arial",
    "Inter",
    "Roboto",
    "Verdana",
    "Tahoma",
    "Georgia",
    "Times New Roman",
    "Courier New",
    "Impact",
  ]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === config.fontFamily;
    fontFamily.appendChild(option);
  }

  const fontWeight = styleInput(document.createElement("select"));
  for (const name of ["normal", "bold"]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name === "bold" ? "Bold" : "Normal";
    option.selected = name === config.fontWeight;
    fontWeight.appendChild(option);
  }

  const textColor = styleInput(document.createElement("input"));
  textColor.type = "color";
  textColor.value = /^#[0-9a-f]{6}$/i.test(config.textColor) ? config.textColor : "#000000";

  const backgroundColor = styleInput(document.createElement("input"));
  backgroundColor.type = "color";
  backgroundColor.value = /^#[0-9a-f]{6}$/i.test(config.backgroundColor)
    ? config.backgroundColor
    : "#a3e635";

  const textAlign = styleInput(document.createElement("select"));
  for (const name of ["left", "center", "right"]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name[0].toUpperCase() + name.slice(1);
    option.selected = name === config.textAlign;
    textAlign.appendChild(option);
  }

  const padding = styleInput(document.createElement("input"));
  padding.type = "number";
  padding.min = "0";
  padding.max = "96";
  padding.value = String(config.padding);

  const radius = styleInput(document.createElement("input"));
  radius.type = "number";
  radius.min = "0";
  radius.max = "96";
  radius.value = String(config.borderRadius);

  const opacity = styleInput(document.createElement("input"));
  opacity.type = "number";
  opacity.min = "0.1";
  opacity.max = "1";
  opacity.step = "0.05";
  opacity.value = String(config.opacity);

  const lineHeight = styleInput(document.createElement("input"));
  lineHeight.type = "number";
  lineHeight.min = "0.8";
  lineHeight.max = "2";
  lineHeight.step = "0.05";
  lineHeight.value = String(config.lineHeight);

  form.append(
    makeField("Text", text),
    makeField("Font size", fontSize),
    makeField("Font family", fontFamily),
    makeField("Font weight", fontWeight),
    makeField("Text color", textColor),
    makeField("Background", backgroundColor),
    makeField("Alignment", textAlign),
    makeField("Padding", padding),
    makeField("Border radius", radius),
    makeField("Opacity", opacity),
    makeField("Line height", lineHeight),
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
  cancel.style.color = "#eee";
  save.style.background = "#ff6647";
  save.style.color = "white";

  const close = () => {
    node.__inteliwebLabelEditorOpen = false;
    overlay.remove();
  };

  cancel.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });

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
    applyStyle(node, true);
    node.graph?.setDirtyCanvas?.(true, true);
    close();
  });

  actions.append(cancel, save);
  panel.append(title, form, actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  text.focus();
}

function prepareNode(node, fit = false) {
  hideConfigWidgets(node);
  node.flags = node.flags || {};
  node.flags.no_title = true;
  node.resizable = false;
  node.color = "rgba(0,0,0,0)";
  node.bgcolor = "rgba(0,0,0,0)";
  createLabelWidget(node);
  applyStyle(node, fit);
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

    const originalDblClick = nodeType.prototype.onDblClick;
    nodeType.prototype.onDblClick = function (...args) {
      openEditor(this);
      originalDblClick?.apply(this, args);
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
      this.__inteliwebLabelEditorOpen = false;
      return originalRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node, true));
  },
});
