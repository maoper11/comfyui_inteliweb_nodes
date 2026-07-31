import { app } from "../../scripts/app.js";

const NODE_CLASS = "InteliwebLoraStack";
const MIN_NODE_HEIGHT = 110;
const BOTTOM_PADDING = 5;
const FALLBACK_WIDGET_TOP = 96;
const HEADER_HEIGHT = 27;
const ROOT_GAP = 4;
const ROW_HEIGHT = 33;
const ROW_GAP = 4;
const ROOT_PADDING_TOP = 1;

function stateWidget(node) {
  return node.widgets?.find((widget) => widget.name === "lora_stack");
}

function uiWidget(node) {
  return node.widgets?.find((widget) => widget.name === "lora_stack_ui");
}

function loraCount(node) {
  const inMemory = node.__inteliwebLoraState?.loras;
  if (Array.isArray(inMemory)) return inMemory.length;

  const raw = stateWidget(node)?.value;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed?.loras) ? parsed.loras.length : 0;
  } catch {
    return 0;
  }
}

function estimatedUiHeight(node) {
  const count = loraCount(node);
  const rowsHeight = count > 0
    ? count * ROW_HEIGHT + Math.max(0, count - 1) * ROW_GAP
    : ROW_HEIGHT;

  return ROOT_PADDING_TOP + HEADER_HEIGHT + ROOT_GAP + rowsHeight;
}

function measuredUiHeight(root) {
  if (!root?.isConnected) return 0;

  const style = getComputedStyle(root);
  const gap = Number.parseFloat(style.rowGap || style.gap) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
  const children = [...root.children].filter((child) => {
    const childStyle = getComputedStyle(child);
    return childStyle.display !== "none" && childStyle.position !== "absolute";
  });
  const childrenHeight = children.reduce(
    (total, child) => total + (Number(child.offsetHeight) || 0),
    0,
  );

  return Math.ceil(
    paddingTop +
      paddingBottom +
      childrenHeight +
      Math.max(0, children.length - 1) * gap,
  );
}

function enforceHeight(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root?.isConnected) return false;

  const uiHeight = Math.max(measuredUiHeight(root), estimatedUiHeight(node));
  node.__inteliwebLoraUiHeight = uiHeight;

  const computed = node.computeSize?.();
  const computedHeight = Number(computed?.[1]);
  const widgetTop = Number(uiWidget(node)?.last_y);
  const fallbackHeight =
    (Number.isFinite(widgetTop) && widgetTop > 0 ? widgetTop : FALLBACK_WIDGET_TOP) +
    uiHeight +
    BOTTOM_PADDING;
  const height = Math.max(
    MIN_NODE_HEIGHT,
    Math.ceil(
      Number.isFinite(computedHeight) && computedHeight > 0
        ? Math.max(computedHeight + BOTTOM_PADDING, fallbackHeight)
        : fallbackHeight,
    ),
  );

  node.__inteliwebLoraDesiredHeight = height;
  const width = Number(node.size?.[0]) || 220;
  const currentHeight = Number(node.size?.[1]) || 0;
  if (Math.abs(currentHeight - height) > 1) {
    node.setSize?.([width, height]);
  }
  node.setDirtyCanvas?.(true, true);
  return true;
}

function scheduleRetries(node) {
  cancelAnimationFrame(node.__inteliwebOffscreenFitFrame || 0);
  for (const timeout of [0, 50, 150, 400, 1000, 2000]) {
    setTimeout(() => {
      node.__inteliwebOffscreenFitFrame = requestAnimationFrame(() => enforceHeight(node));
    }, timeout);
  }
}

function installObservers(node) {
  const root = node.__inteliwebLoraRoot;
  if (!root || node.__inteliwebOffscreenHeightInstalled) return;
  node.__inteliwebOffscreenHeightInstalled = true;

  const mutationObserver = new MutationObserver(() => scheduleRetries(node));
  mutationObserver.observe(root, { childList: true, subtree: true });
  node.__inteliwebOffscreenMutationObserver = mutationObserver;

  if (globalThis.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => enforceHeight(node));
    resizeObserver.observe(root);
    node.__inteliwebOffscreenResizeObserver = resizeObserver;
  }

  if (globalThis.IntersectionObserver) {
    const intersectionObserver = new IntersectionObserver(() => enforceHeight(node));
    intersectionObserver.observe(root);
    node.__inteliwebOffscreenIntersectionObserver = intersectionObserver;
  }

  scheduleRetries(node);
}

function prepareNode(node, attempt = 0) {
  if (node.__inteliwebLoraRoot) {
    installObservers(node);
    enforceHeight(node);
    return;
  }

  if (attempt < 120) {
    setTimeout(() => prepareNode(node, attempt + 1), 50);
  }
}

app.registerExtension({
  name: "inteliweb.lora.stack.offscreen-height-test",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;

    const previousRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function (...args) {
      cancelAnimationFrame(this.__inteliwebOffscreenFitFrame || 0);
      this.__inteliwebOffscreenMutationObserver?.disconnect();
      this.__inteliwebOffscreenResizeObserver?.disconnect();
      this.__inteliwebOffscreenIntersectionObserver?.disconnect();
      return typeof previousRemoved === "function"
        ? previousRemoved.apply(this, args)
        : undefined;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_CLASS) return;
    queueMicrotask(() => prepareNode(node));
  },
});
