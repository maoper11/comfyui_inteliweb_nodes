import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-compact-css";
const MIN_NODE_WIDTH = 370;
const MIN_CONTENT_WIDTH = 350;
const MIN_NODE_HEIGHT = 110;
const FALLBACK_WIDGET_TOP = 76;
const BOTTOM_PADDING = 5;

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

.inteliweb-lora-summary {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  min-height: 27px !important;
  padding: 2px 4px 2px 6px !important;
  border-radius: 5px !important;
}

.inteliweb-lora-summary > .inteliweb-lora-switch-control {
  flex: 0 0 auto;
}

.inteliweb-lora-summary .inteliweb-lora-toolbar {
  position: static !important;
  z-index: auto !important;
  display: block !important;
  width: auto !important;
  min-width: 0 !important;
  margin-left: auto !important;
  transform: none !important;
  pointer-events: auto;
}

.inteliweb-lora-summary .inteliweb-lora-toolbar .inteliweb-lora-button {
  width: 98px !important;
  min-height: 23px !important;
  height: 23px !important;
  padding: 0 7px !important;
  border-radius: 5px !important;
  font-size: 11px !important;
  line-height: 21px !important;
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
  grid-template-columns: 30px minmax(90px, 1fr) 58px 26px !important;
  gap: 3px !important;
  min-width: ${MIN_CONTENT_WIDTH}px !important;
  min-height: 33px !important;
  padding: 3px !important;
  border-radius: 6px !important;
}

.inteliweb-lora-row input[type="number"],
.inteliweb-lora-picker-trigger,
.inteliweb-lora-icon-button {
  min-height: 25px !important;
  height: 25px !important;
}

.inteliweb-lora-row input[type="number"] {
  padding: 2px !important;
  font-size: 11px;
}

.inteliweb-lora-picker-trigger {
  padding: 2px 5px !important;
  grid-template-columns: minmax(0, 1fr) 14px !important;
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
  width: 26px !important;
  min-width: 26px;
  padding: 0 !important;
  font-size: 16px;
  line-height: 22px;
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
    const style = getComputedStyle(child);
    return style.display !== "none" && style.position !== "absolute";
  });
  const childrenHeight = children.reduce((total, child) => total + child.offsetHeight, 0);
  return Math.ceil(
    paddingTop +
      paddingBottom +
      childrenHeight +
      Math.max(0, children.length - 1) * gap,
  );
}

function loraWidgetTop(node) {
  const widget = node.widgets?.find((candidate) => candidate.name === "lora_stack_ui");
  const top = Number(widget?.last_y);
  return Number.isFinite(top) && top > 0 ? top : FALLBACK_WIDGET_TOP;
}

function applyCompactMinimums(node) {
  node.min_size ||= [MIN_NODE_WIDTH, MIN_NODE_HEIGHT];
  node.min_size[0] = MIN_NODE_WIDTH;
  node.min_size[1] = MIN_NODE_HEIGHT;
}

function fitCompactNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return;

  applyCompactMinimums(node);

  const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
  const contentHeight = Math.max(0, intrinsicRootHeight(root));
  node.__inteliwebLoraUiHeight = contentHeight;

  const height = Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(loraWidgetTop(node) + contentHeight + BOTTOM_PADDING),
  );
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

  // Measure immediately so the original LoRA Stack auto-fit never gets a frame
  // in which it can expand the node before this compact override corrects it.
  fitCompactNode(node);

  node.__inteliwebCompactFitFrame = requestAnimationFrame(() => {
    fitCompactNode(node);
  });
}

function installSetSizeGuard(node) {
  if (node.__inteliwebCompactSetSizeInstalled || typeof node.setSize !== "function") return;

  node.__inteliwebCompactSetSizeInstalled = true;
  const originalSetSize = node.setSize;

  node.setSize = function (size, ...args) {
    const requested = Array.isArray(size) ? [...size] : size;
    if (Array.isArray(requested)) {
      requested[0] = Math.max(MIN_NODE_WIDTH, Number(requested[0]) || MIN_NODE_WIDTH);

      const desiredHeight = Number(this.__inteliwebCompactDesiredHeight);
      if (this.__inteliwebLoraRoot?.isConnected && Number.isFinite(desiredHeight)) {
        requested[1] = desiredHeight;
      }
    }
    return originalSetSize.call(this, requested, ...args);
  };
}

function moveToolbarIntoSummary(root) {
  const toolbar = root.querySelector(".inteliweb-lora-toolbar");
  const summary = root.querySelector(".inteliweb-lora-summary");
  if (!toolbar || !summary || summary.contains(toolbar)) return;
  summary.appendChild(toolbar);
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

function compactRows(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root) return;

  moveToolbarIntoSummary(root);

  for (const rowElement of root.querySelectorAll(".inteliweb-lora-row")) {
    if (rowElement.dataset.inteliwebCompact === "true") continue;
    rowElement.dataset.inteliwebCompact = "true";

    const iconButtons = [...rowElement.querySelectorAll(".inteliweb-lora-icon-button")];
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

  applyCompactMinimums(node);
  scheduleCompactFit(node);
}

function observeCompactNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root || node.__inteliwebCompactObserver) return;

  const observer = new MutationObserver(() => compactRows(node));
  observer.observe(root, { childList: true, subtree: true });
  node.__inteliwebCompactObserver = observer;
  compactRows(node);
}

function prepareCompactNode(node) {
  injectCompactStyles();
  installSetSizeGuard(node);

  const waitForRoot = (attempt = 0) => {
    if (node.__inteliwebLoraRoot) {
      observeCompactNode(node);
      compactRows(node);
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

    const previousResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size, ...args) {
      const requestedWidth = Number(size?.[0]);
      const result = previousResize?.call(this, size, ...args);

      applyCompactMinimums(this);
      if (Number.isFinite(requestedWidth)) {
        this.size[0] = Math.max(MIN_NODE_WIDTH, requestedWidth);
      }
      scheduleCompactFit(this);
      return result;
    };

    const previousRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      cancelAnimationFrame(this.__inteliwebCompactFitFrame || 0);
      this.__inteliwebCompactObserver?.disconnect();
      this.__inteliwebCompactObserver = null;
      return previousRemoved?.apply(this, args);
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareCompactNode(node));
  },
});
