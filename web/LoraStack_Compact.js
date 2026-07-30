import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLoraStack";
const STYLE_ID = "inteliweb-lora-stack-compact-css";
const MIN_NODE_WIDTH = 370;
const MIN_CONTENT_WIDTH = 350;

function injectCompactStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-lora-stack {
  position: relative;
  gap: 4px !important;
  min-width: ${MIN_CONTENT_WIDTH}px !important;
  padding: 1px 2px 2px !important;
}

.inteliweb-lora-toolbar {
  position: absolute !important;
  z-index: 4;
  top: -58px;
  left: 50%;
  width: min(150px, calc(100% - 150px));
  min-width: 118px;
  transform: translateX(-50%);
  pointer-events: auto;
}

.inteliweb-lora-toolbar .inteliweb-lora-button {
  width: 100%;
  min-height: 24px !important;
  height: 24px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 22px;
}

.inteliweb-lora-summary {
  min-height: 25px !important;
  padding: 2px 6px !important;
  border-radius: 5px !important;
}

.inteliweb-lora-rows {
  gap: 4px !important;
  min-width: ${MIN_CONTENT_WIDTH}px !important;
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
  height: 25px;
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

function fitCompactNode(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return;

  node.min_size ||= [MIN_NODE_WIDTH, 0];
  node.min_size[0] = MIN_NODE_WIDTH;

  const width = Math.max(MIN_NODE_WIDTH, Number(node.size?.[0]) || MIN_NODE_WIDTH);
  const contentHeight = Math.ceil(root.getBoundingClientRect().height || root.offsetHeight || 0);
  const height = Math.max(122, contentHeight + 76);
  const currentHeight = Number(node.size?.[1]) || 0;

  if (Math.abs(currentHeight - height) > 1) node.setSize?.([width, height]);
  node.setDirtyCanvas?.(true, true);
}

function scheduleCompactFit(node) {
  cancelAnimationFrame(node.__inteliwebCompactFitFrame || 0);
  node.__inteliwebCompactFitFrame = requestAnimationFrame(() => {
    node.__inteliwebCompactFitFrame = requestAnimationFrame(() => {
      node.__inteliwebCompactFitFrame = requestAnimationFrame(() => fitCompactNode(node));
    });
  });
}

function showRowMenu(event, rowElement, controls) {
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

    const openMenu = (event) => showRowMenu(event, rowElement, { toggle, up, down, remove });
    actions.addEventListener("click", openMenu);
    rowElement.addEventListener("contextmenu", openMenu);
    rowElement.appendChild(actions);
  }

  node.min_size ||= [MIN_NODE_WIDTH, 0];
  node.min_size[0] = MIN_NODE_WIDTH;
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

      this.min_size ||= [MIN_NODE_WIDTH, 0];
      this.min_size[0] = MIN_NODE_WIDTH;
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
