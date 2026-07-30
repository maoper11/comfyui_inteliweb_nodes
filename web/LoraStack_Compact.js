import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-compact-css";
const MIN_NODE_WIDTH = 260;
const MIN_CONTENT_WIDTH = 240;
const MIN_NODE_HEIGHT = 110;
const BOTTOM_PADDING = 5;
const FALLBACK_WIDGET_TOP = 96;

function injectCompactStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-lora-stack {
  position: relative;
  align-content: start !important;
  gap: 4px !important;
  min-width: ${MIN_CONTENT_WIDTH}px !important;
  height: max-content !important;
  min-height: 0 !important;
  padding: 1px 2px 0 !important;
}

.inteliweb-lora-header-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  min-width: ${MIN_CONTENT_WIDTH}px;
}

.inteliweb-lora-summary {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  min-width: 0 !important;
  min-height: 27px !important;
  height: 27px !important;
  padding: 2px 4px 2px 3px !important;
  border-radius: 5px !important;
}

.inteliweb-lora-summary > .inteliweb-lora-switch-control {
  flex: 0 0 auto;
}

.inteliweb-lora-header-row > .inteliweb-lora-toolbar {
  position: static !important;
  z-index: auto !important;
  display: block !important;
  width: auto !important;
  min-width: 0 !important;
  margin: 0 !important;
  transform: none !important;
  pointer-events: auto;
}

.inteliweb-lora-header-row > .inteliweb-lora-toolbar .inteliweb-lora-button {
  width: 88px !important;
  min-height: 27px !important;
  height: 27px !important;
  padding: 0 5px !important;
  border-radius: 5px !important;
  font-size: 10.5px !important;
  line-height: 25px !important;
  white-space: nowrap;
}

.inteliweb-lora-rows {
  gap: 4px !important;
  min-width: ${MIN_CONTENT_WIDTH}px !important;
  height: max-content !important;
  min-height: 0 !important;
  align-content: start !important;
}

.inteliweb-lora-row {
  grid-template-columns: 30px minmax(32px, 1fr) 62px 24px !important;
  gap: 3px !important;
  min-width: ${MIN_CONTENT_WIDTH}px !important;
  min-height: 33px !important;
  padding: 3px !important;
  border-radius: 6px !important;
}

.inteliweb-lora-picker,
.inteliweb-lora-picker-trigger,
.inteliweb-lora-picker-value {
  min-width: 0 !important;
  max-width: 100% !important;
}

.inteliweb-lora-picker-value {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

.inteliweb-lora-picker-trigger,
.inteliweb-lora-icon-button {
  min-height: 25px !important;
  height: 25px !important;
}

.inteliweb-lora-picker-trigger {
  padding: 2px 4px !important;
  grid-template-columns: minmax(0, 1fr) 12px !important;
  gap: 2px !important;
}

.inteliweb-lora-switch-track {
  width: 30px !important;
  height: 16px !important;
}

.inteliweb-lora-switch-track::after {
  top: 2px !important;
  left: 2px !important;
  width: 10px !important;
  height: 10px !important;
}

.inteliweb-lora-switch-control input:checked + .inteliweb-lora-switch-track::after {
  transform: translateX(14px) !important;
}

.inteliweb-lora-row .inteliweb-lora-icon-button[data-compact-hidden="true"] {
  display: none !important;
}

.inteliweb-lora-row .inteliweb-lora-actions {
  width: 24px !important;
  min-width: 24px !important;
  padding: 0 !important;
  font-size: 15px;
  line-height: 22px;
}

.inteliweb-lora-strength-control {
  display: grid;
  grid-template-columns: 15px minmax(24px, 1fr) 15px;
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
  width: 100% !important;
  min-width: 0 !important;
  min-height: 23px !important;
  height: 23px !important;
  padding: 1px 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  font-size: 10.5px;
  text-align: center;
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
  width: 15px;
  min-width: 15px;
  height: 23px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  font: inherit;
  font-size: 9px;
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

.inteliweb-lora-empty {
  padding: 7px !important;
  border-radius: 6px !important;
}
`;
  document.head.appendChild(style);
}

function intrinsicRootHeight(root) {
  const rootStyle = getComputedStyle(root);
  const gap = Number.parseFloat(rootStyle.rowGap || rootStyle.gap) || 0;
  const paddingTop = Number.parseFloat(rootStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(rootStyle.paddingBottom) || 0;
  const children = [...root.children].filter((child) => {
    const childStyle = getComputedStyle(child);
    return childStyle.display !== "none" && childStyle.position !== "absolute";
  });
  const childrenHeight = children.reduce((total, child) => total + child.offsetHeight, 0);
  return Math.ceil(
    paddingTop +
      paddingBottom +
      childrenHeight +
      Math.max(0, children.length - 1) * gap,
  );
}

function loraWidget(node) {
  return node.widgets?.find((candidate) => candidate.name === "lora_stack_ui");
}

function loraWidgetTop(node) {
  const top = Number(loraWidget(node)?.last_y);
  return Number.isFinite(top) && top > 0 ? top : FALLBACK_WIDGET_TOP;
}

function relaxDomWidgetMinimum(node) {
  const widget = loraWidget(node);
  if (!widget) return;

  widget.options ||= {};
  widget.options.minWidth = MIN_CONTENT_WIDTH;
  widget.options.getMinWidth = () => MIN_CONTENT_WIDTH;
  widget.getMinWidth = () => MIN_CONTENT_WIDTH;
}

function applyCompactMinimums(node) {
  node.min_size ||= [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
  node.min_size[0] = MIN_NODE_WIDTH;
  node.min_size[1] = MIN_NODE_HEIGHT;
  relaxDomWidgetMinimum(node);
}

function desiredNodeWidth(node) {
  const savedWidth = Number(node.__inteliwebCompactUserWidth);
  if (Number.isFinite(savedWidth)) return Math.max(MIN_NODE_WIDTH, savedWidth);
  return Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
}

function desiredNodeHeight(node, contentHeight) {
  node.__inteliwebLoraUiHeight = contentHeight;

  const computed = node.computeSize?.();
  const computedHeight = Number(computed?.[1]);
  if (Number.isFinite(computedHeight) && computedHeight > 0) {
    return Math.max(MIN_NODE_HEIGHT, Math.ceil(computedHeight + BOTTOM_PADDING));
  }

  return Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(loraWidgetTop(node) + contentHeight + BOTTOM_PADDING),
  );
}

function fitCompactNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return;

  applyCompactMinimums(node);

  const contentHeight = Math.max(0, intrinsicRootHeight(root));
  const width = desiredNodeWidth(node);
  const height = desiredNodeHeight(node, contentHeight);
  node.__inteliwebCompactDesiredHeight = height;

  const currentWidth = Number(node.size?.[0]) || 0;
  const currentHeight = Number(node.size?.[1]) || 0;
  if (Math.abs(currentWidth - width) > 1 || Math.abs(currentHeight - height) > 1) {
    node.setSize?.([width, height]);
  }
  node.setDirtyCanvas?.(true, true);
}

function scheduleCompactFit(node) {
  cancelAnimationFrame(node.__inteliwebCompactFitFrame || 0);
  fitCompactNode(node);
  node.__inteliwebCompactFitFrame = requestAnimationFrame(() => fitCompactNode(node));
}

function installSetSizeGuard(node) {
  if (node.__inteliwebCompactSetSizeInstalled || typeof node.setSize !== "function") return;

  node.__inteliwebCompactSetSizeInstalled = true;
  const originalSetSize = node.setSize;

  node.setSize = function (size, ...args) {
    const requested = Array.isArray(size) ? [...size] : size;
    if (Array.isArray(requested)) {
      requested[0] = desiredNodeWidth(this);

      const desiredHeight = Number(this.__inteliwebCompactDesiredHeight);
      if (this.__inteliwebLoraRoot?.isConnected && Number.isFinite(desiredHeight)) {
        requested[1] = desiredHeight;
      }
    }
    return originalSetSize.call(this, requested, ...args);
  };
}

function installResizeGuard(node) {
  if (node.__inteliwebCompactResizeInstalled) return;

  node.__inteliwebCompactResizeInstalled = true;
  const originalResize = node.onResize;

  node.onResize = function (size, ...args) {
    const requestedWidth = Number(size?.[0]);
    if (Number.isFinite(requestedWidth)) {
      this.__inteliwebCompactUserWidth = Math.max(MIN_NODE_WIDTH, requestedWidth);
    }

    const requested = Array.isArray(size) ? [...size] : size;
    if (Array.isArray(requested)) requested[0] = desiredNodeWidth(this);

    const result =
      typeof originalResize === "function"
        ? originalResize.call(this, requested, ...args)
        : undefined;

    applyCompactMinimums(this);
    if (Array.isArray(this.size)) this.size[0] = desiredNodeWidth(this);
    scheduleCompactFit(this);
    return result;
  };
}

function arrangeHeaderRow(root) {
  const toolbar = root.querySelector(".inteliweb-lora-toolbar");
  const summary = root.querySelector(".inteliweb-lora-summary");
  if (!toolbar || !summary) return;

  let header = root.querySelector(":scope > .inteliweb-lora-header-row");
  if (!header) {
    header = document.createElement("div");
    header.className = "inteliweb-lora-header-row";
    root.insertBefore(header, root.firstChild);
  }

  if (summary.parentElement !== header) header.appendChild(summary);
  if (toolbar.parentElement !== header) header.appendChild(toolbar);
}

function adjustStrength(input, direction) {
  const current = Number(input.value);
  const step = Number(input.step) || 0.05;
  const min = Number.isFinite(Number(input.min)) ? Number(input.min) : -100;
  const max = Number.isFinite(Number(input.max)) ? Number(input.max) : 100;
  const base = Number.isFinite(current) ? current : 1;
  const next = Math.max(min, Math.min(max, base + step * direction));
  input.value = String(Number(next.toFixed(6)));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function installStrengthControl(rowElement) {
  const input = rowElement.querySelector(':scope > input[type="number"]');
  if (!input || input.parentElement?.classList.contains("inteliweb-lora-strength-control")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-lora-strength-control";

  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.className = "inteliweb-lora-strength-step";
  decrease.textContent = "◀";
  decrease.title = "Decrease strength";
  decrease.setAttribute("aria-label", "Decrease LoRA strength");

  const increase = document.createElement("button");
  increase.type = "button";
  increase.className = "inteliweb-lora-strength-step";
  increase.textContent = "▶";
  increase.title = "Increase strength";
  increase.setAttribute("aria-label", "Increase LoRA strength");

  input.replaceWith(wrapper);
  wrapper.append(decrease, input, increase);

  decrease.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustStrength(input, -1);
  });
  increase.addEventListener("click", (event) => {
    event.stopPropagation();
    adjustStrength(input, 1);
  });
}

function showRowMenu(event, controls) {
  event.preventDefault();
  event.stopPropagation();

  const { toggle, up, down, remove } = controls;
  const isEnabled = Boolean(toggle?.checked);
  const items = [
    {
      content: `${isEnabled ? "⚫" : "🟢"} ${isEnabled ? "Disable" : "Enable"}`,
      callback: () => {
        if (!toggle) return;
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
      },
    },
    null,
    {
      content: "⬆️ Move Up",
      disabled: Boolean(up?.disabled),
      callback: () => up?.click(),
    },
    {
      content: "⬇️ Move Down",
      disabled: Boolean(down?.disabled),
      callback: () => down?.click(),
    },
    {
      content: "🗑️ Remove",
      callback: () => remove?.click(),
    },
  ];

  new LiteGraph.ContextMenu(items, {
    title: "LORA",
    event,
  });
}

function decorateRows(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root) return;

  arrangeHeaderRow(root);

  for (const rowElement of root.querySelectorAll(".inteliweb-lora-row")) {
    if (rowElement.dataset.inteliwebCompact !== "true") {
      rowElement.dataset.inteliwebCompact = "true";

      const iconButtons = [...rowElement.querySelectorAll(":scope > .inteliweb-lora-icon-button")];
      const [up, down, remove] = iconButtons;
      for (const control of iconButtons) control.dataset.compactHidden = "true";

      const toggle = rowElement.querySelector('input[type="checkbox"]');
      const actions = document.createElement("button");
      actions.type = "button";
      actions.className = "inteliweb-lora-icon-button inteliweb-lora-actions";
      actions.textContent = "⋮";
      actions.title = "LoRA actions";
      actions.setAttribute("aria-label", "LoRA actions");

      const openMenu = (event) => showRowMenu(event, { toggle, up, down, remove });
      actions.addEventListener("click", openMenu);
      rowElement.addEventListener("contextmenu", openMenu);
      rowElement.appendChild(actions);
    }

    installStrengthControl(rowElement);
  }

  applyCompactMinimums(node);
  scheduleCompactFit(node);
}

function observeCompactNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root || node.__inteliwebCompactObserver) return;

  const observer = new MutationObserver(() => decorateRows(node));
  observer.observe(root, { childList: true, subtree: true });
  node.__inteliwebCompactObserver = observer;
  decorateRows(node);
}

function prepareCompactNode(node) {
  injectCompactStyles();
  installSetSizeGuard(node);
  installResizeGuard(node);

  const waitForRoot = (attempt = 0) => {
    if (node.__inteliwebLoraRoot) {
      observeCompactNode(node);
      decorateRows(node);
      return;
    }
    if (attempt < 12) requestAnimationFrame(() => waitForRoot(attempt + 1));
  };

  waitForRoot();
}

app.registerExtension({
  name: "inteliweb.lora.stack.compact",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;

    const previousRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      cancelAnimationFrame(this.__inteliwebCompactFitFrame || 0);
      this.__inteliwebCompactObserver?.disconnect();
      this.__inteliwebCompactObserver = null;
      return typeof previousRemoved === "function"
        ? previousRemoved.apply(this, args)
        : undefined;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareCompactNode(node));
  },
});
