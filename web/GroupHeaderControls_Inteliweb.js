import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXTENSION_NAME = "Inteliweb.GroupHeaderControls";
const SETTING_PREFIX = "Inteliweb.Groups.";
const SHAPE_FLAG = "inteliwebShape";

const BUTTON_SIZE = 22;
const BUTTON_GAP = 5;
const BUTTON_MARGIN_X = 6;
const BUTTON_MARGIN_Y = 4;
const GROUP_RADIUS = 10;

const defaults = {
  enabled: false,
  visibility: "Hover",
  showRun: true,
  showBypass: true,
  showMute: true,
  showTooltips: false,
};

const state = {
  ...defaults,
  hoveredGroup: null,
  hoveredAction: null,
  canvasElement: null,
  groupPrototype: null,
  queueNodeIds: null,
  apiQueueWrapped: false,
  tooltipElement: null,
  activeTooltipAction: null,
};

const ACTIONS = [
  {
    key: "run",
    label: "Run",
    description: "Queue this group's output nodes.",
    setting: "showRun",
  },
  {
    key: "bypass",
    label: "Bypass",
    description: "Skip group processing and pass data through.",
    setting: "showBypass",
  },
  {
    key: "mute",
    label: "Mute",
    description: "Disable group nodes and stop their outputs.",
    setting: "showMute",
  },
];

const SHAPES = [
  { key: "default", label: "Default" },
  { key: "rounded", label: "Rounded" },
  { key: "card", label: "Card" },
];

function currentGraph() {
  return app.canvas?.getCurrentGraph?.() || app.canvas?.graph || app.graph || null;
}

function graphGroups(graph = currentGraph()) {
  if (!graph) return [];
  const groups = graph._groups || graph.groups;
  if (Array.isArray(groups)) return groups;
  if (groups?.values) return [...groups.values()];
  return [];
}

function markDirty() {
  app.canvas?.setDirty?.(true, true);
}

function readSetting(name) {
  try {
    const value = app.ui?.settings?.getSettingValue?.(`${SETTING_PREFIX}${name}`);
    return value ?? defaults[name];
  } catch {
    return defaults[name];
  }
}

function loadSettings() {
  state.enabled = Boolean(readSetting("enabled"));
  state.visibility = readSetting("visibility") === "Always" ? "Always" : "Hover";
  state.showRun = Boolean(readSetting("showRun"));
  state.showBypass = Boolean(readSetting("showBypass"));
  state.showMute = Boolean(readSetting("showMute"));
  state.showTooltips = Boolean(readSetting("showTooltips"));
}

function enabledActions() {
  return ACTIONS.filter((action) => Boolean(state[action.setting]));
}

function groupShape(group) {
  const shape = group?.flags?.[SHAPE_FLAG];
  return shape === "rounded" || shape === "card" ? shape : "default";
}

function setGroupShape(group, shape) {
  if (!group) return;
  const graph = group.graph || currentGraph();

  graph?.beforeChange?.();
  group.flags ||= {};
  if (shape === "default") delete group.flags[SHAPE_FLAG];
  else group.flags[SHAPE_FLAG] = shape;
  graph?.afterChange?.();
  graph?.change?.();
  markDirty();
}

function shapeMenuOptions(group) {
  const selected = groupShape(group);
  return SHAPES.map((shape) => ({
    content: `${selected === shape.key ? "✓ " : ""}${shape.label}`,
    callback: () => setGroupShape(group, shape.key),
  }));
}

function findGroupAt(canvas, point) {
  const graph = canvas?.getCurrentGraph?.() || canvas?.graph || currentGraph();
  if (!graph || !point) return null;

  if (typeof graph.getGroupOnPos === "function") {
    return graph.getGroupOnPos(point[0], point[1]) || null;
  }

  const groups = graphGroups(graph);
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (group?.isPointInside?.(point[0], point[1])) return group;
  }
  return null;
}

function eventToGraphPoint(event) {
  const canvas = app.canvas;
  if (!canvas) return null;

  try {
    const point = canvas.convertEventToCanvasOffset?.(event);
    if (point?.length >= 2) return [point[0], point[1]];
  } catch {
    // Fall back to canvasX/canvasY or graph_mouse.
  }

  if (Number.isFinite(event.canvasX) && Number.isFinite(event.canvasY)) {
    return [event.canvasX, event.canvasY];
  }

  const point = canvas.graph_mouse;
  return point?.length >= 2 ? [point[0], point[1]] : null;
}

function looksLikeNode(item) {
  return Boolean(
    item &&
    typeof item === "object" &&
    (
      "mode" in item ||
      Array.isArray(item.inputs) ||
      Array.isArray(item.outputs) ||
      item.constructor?.nodeData
    ),
  );
}

function collectGroupNodes(group, recompute = false) {
  if (!group) return [];

  if (recompute) {
    try {
      group.recomputeInsideNodes?.();
    } catch (error) {
      console.warn("[Inteliweb] Could not recompute group members:", error);
    }
  }

  const result = [];
  const visitedNodes = new Set();
  const visitedGroups = new Set();

  const addNode = (node) => {
    if (!looksLikeNode(node) || visitedNodes.has(node)) return;
    visitedNodes.add(node);
    result.push(node);

    const childNodes = node.subgraph?._nodes || node.subgraph?.nodes;
    if (childNodes?.[Symbol.iterator]) {
      for (const child of childNodes) addNode(child);
    }
  };

  const addGroup = (candidate) => {
    if (!candidate || visitedGroups.has(candidate)) return;
    visitedGroups.add(candidate);

    const children = candidate.children || candidate._children;
    if (children?.[Symbol.iterator]) {
      for (const item of children) {
        if (looksLikeNode(item)) addNode(item);
        else if (item?.children || item?._children || item?._groups) addGroup(item);
      }
    }

    const fallbackNodes = Array.isArray(candidate.nodes)
      ? candidate.nodes
      : Array.isArray(candidate._nodes)
        ? candidate._nodes
        : [];
    for (const node of fallbackNodes) addNode(node);
  };

  addGroup(group);
  return result;
}

function isOutputNode(node) {
  return Boolean(
    node?.constructor?.nodeData?.output_node ||
    node?.constructor?.nodeData?.outputNode ||
    node?.output_node,
  );
}

function isActiveOutputNode(node) {
  const never = globalThis.LiteGraph?.NEVER ?? 2;
  return node?.mode !== never && isOutputNode(node);
}

function outputNodesForGroup(group, recompute = false) {
  return collectGroupNodes(group, recompute).filter(isActiveOutputNode);
}

function notify(message) {
  console.warn(`[Inteliweb] ${message}`);
  try {
    app.ui?.dialog?.show?.(message);
  } catch {
    // Console warning is the final fallback.
  }
}

function recursivelyAddUpstream(nodeId, oldOutput, newOutput, visiting = new Set()) {
  const currentId = String(nodeId);
  if (newOutput[currentId] != null || visiting.has(currentId)) return;

  const currentNode = oldOutput?.[currentId];
  if (!currentNode) return;

  visiting.add(currentId);
  newOutput[currentId] = currentNode;

  for (const inputValue of Object.values(currentNode.inputs || {})) {
    if (Array.isArray(inputValue) && inputValue.length) {
      recursivelyAddUpstream(inputValue[0], oldOutput, newOutput, visiting);
    }
  }

  visiting.delete(currentId);
}

function installApiQueueFilter() {
  if (api.queuePrompt?.__inteliwebGroupHeaderQueueFilter) {
    state.apiQueueWrapped = true;
    return true;
  }

  const originalQueuePrompt = api.queuePrompt;
  if (typeof originalQueuePrompt !== "function") return false;

  const wrappedQueuePrompt = async function (index, prompt, ...args) {
    if (state.queueNodeIds?.length && prompt?.output) {
      const oldOutput = prompt.output;
      const newOutput = {};

      for (const nodeId of state.queueNodeIds) {
        recursivelyAddUpstream(nodeId, oldOutput, newOutput);
      }

      prompt.output = newOutput;
    }

    return await originalQueuePrompt.call(this, index, prompt, ...args);
  };

  wrappedQueuePrompt.__inteliwebGroupHeaderQueueFilter = true;
  wrappedQueuePrompt.__inteliwebOriginalQueuePrompt = originalQueuePrompt;
  api.queuePrompt = wrappedQueuePrompt;
  state.apiQueueWrapped = true;
  return true;
}

async function queueOutputNodes(outputs) {
  const nodeIds = [...new Set(outputs.map((node) => String(node.id)))];
  if (!nodeIds.length) return;
  if (typeof app.queuePrompt !== "function") {
    throw new Error("ComfyUI queuePrompt is unavailable.");
  }

  // Reinstall around the current api.queuePrompt if another extension replaced it
  // after our setup hook. The filter only acts while queueNodeIds is populated.
  if (!installApiQueueFilter()) {
    throw new Error("ComfyUI api.queuePrompt is unavailable.");
  }

  state.queueNodeIds = nodeIds;
  try {
    // Use ComfyUI's normal queue lifecycle instead of a temporary canvas selection.
    // This preserves control_after_generate behavior for random/incrementing seeds.
    await app.queuePrompt(0);
  } finally {
    state.queueNodeIds = null;
  }
}

async function runGroup(group) {
  const outputs = outputNodesForGroup(group, true);
  if (!outputs.length) {
    notify("This group does not contain an active output node to run.");
    return;
  }

  try {
    await queueOutputNodes(outputs);
  } catch (error) {
    console.error("[Inteliweb] Could not run group output nodes:", error);
    notify("The group could not be queued. See the browser console for details.");
  }
}

function modeConstants() {
  return {
    always: LiteGraph.ALWAYS ?? 0,
    never: LiteGraph.NEVER ?? 2,
    bypass: LiteGraph.BYPASS ?? 4,
  };
}

function changeGroupMode(group, action) {
  const nodes = collectGroupNodes(group, true);
  if (!nodes.length) return;

  const modes = modeConstants();
  const targetMode = action === "mute" ? modes.never : modes.bypass;
  const alreadyApplied = nodes.every((node) => node.mode === targetMode);
  const newMode = alreadyApplied ? modes.always : targetMode;
  const graph = group.graph || currentGraph();

  graph?.beforeChange?.();
  for (const node of nodes) node.mode = newMode;
  graph?.afterChange?.();
  graph?.change?.();
  markDirty();
}

function groupModeState(group) {
  const nodes = collectGroupNodes(group, false);
  const modes = modeConstants();
  return {
    hasNodes: nodes.length > 0,
    allMuted: nodes.length > 0 && nodes.every((node) => node.mode === modes.never),
    allBypassed: nodes.length > 0 && nodes.every((node) => node.mode === modes.bypass),
    hasOutput: nodes.some(isActiveOutputNode),
  };
}

function actionRects(group) {
  const actions = enabledActions();
  if (!group || !actions.length) return [];

  const [x, y] = group.pos || group._pos || [0, 0];
  const [width] = group.size || group._size || [0, 0];
  const totalWidth = actions.length * BUTTON_SIZE + (actions.length - 1) * BUTTON_GAP;
  const startX = x + width - BUTTON_MARGIN_X - totalWidth;
  const startY = y + BUTTON_MARGIN_Y;

  return actions.map((action, index) => ({
    ...action,
    x: startX + index * (BUTTON_SIZE + BUTTON_GAP),
    y: startY,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  }));
}

function pointInRect(point, rect) {
  return Boolean(
    point &&
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height,
  );
}

function actionRectAt(group, point) {
  return actionRects(group).find((rect) => pointInRect(point, rect)) || null;
}

function actionAt(group, point) {
  return actionRectAt(group, point)?.key || null;
}

function controlsVisibleFor(group) {
  if (!state.enabled) return false;
  if (state.visibility === "Always") return true;
  return state.hoveredGroup === group || Boolean(group?.selected);
}

function ensureTooltipElement() {
  if (state.tooltipElement?.isConnected) return state.tooltipElement;

  const tooltip = document.createElement("div");
  tooltip.className = "inteliweb-group-header-tooltip";
  tooltip.style.cssText = [
    "position:fixed",
    "display:none",
    "z-index:100000",
    "pointer-events:none",
    "width:max-content",
    "max-width:calc(100vw - 20px)",
    "box-sizing:border-box",
    "padding:7px 9px",
    "border:1px solid rgba(255,255,255,0.16)",
    "border-radius:6px",
    "background:rgba(24,24,24,0.96)",
    "box-shadow:0 4px 14px rgba(0,0,0,0.35)",
    "color:#f2f2f2",
    "font:12px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif",
    "white-space:normal",
    "overflow-wrap:anywhere",
  ].join(";");

  document.body.appendChild(tooltip);
  state.tooltipElement = tooltip;
  return tooltip;
}

function positionTooltip(tooltip, event) {
  const margin = 10;
  const offset = 14;
  let left = event.clientX + offset;
  let top = event.clientY + offset;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  const rect = tooltip.getBoundingClientRect();
  if (rect.right > window.innerWidth - margin) {
    left = Math.max(margin, event.clientX - rect.width - offset);
  }
  if (rect.bottom > window.innerHeight - margin) {
    top = Math.max(margin, event.clientY - rect.height - offset);
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showTooltip(action, event) {
  if (!state.showTooltips || !action) {
    hideTooltip();
    return;
  }

  const tooltip = ensureTooltipElement();
  if (state.activeTooltipAction !== action.key) {
    tooltip.replaceChildren();

    const title = document.createElement("strong");
    title.textContent = action.label;

    const description = document.createElement("span");
    description.textContent = ` — ${action.description}`;

    tooltip.append(title, description);
    state.activeTooltipAction = action.key;
  }

  tooltip.style.display = "block";
  positionTooltip(tooltip, event);
}

function hideTooltip() {
  if (state.tooltipElement) state.tooltipElement.style.display = "none";
  state.activeTooltipAction = null;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }

  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawCardPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function groupPath(ctx, shape, x, y, width, height) {
  if (shape === "card") drawCardPath(ctx, x, y, width, height, GROUP_RADIUS);
  else drawRoundedRect(ctx, x, y, width, height, GROUP_RADIUS);
}

function drawResizeHandle(ctx, x, y, width, height, color, editorAlpha) {
  ctx.save();
  ctx.globalAlpha = 0.72 * editorAlpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(x + width - 11, y + height - 3);
  ctx.lineTo(x + width - 3, y + height - 11);
  ctx.moveTo(x + width - 7, y + height - 3);
  ctx.lineTo(x + width - 3, y + height - 7);
  ctx.stroke();
  ctx.restore();
}

function drawStyledGroup(group, graphCanvas, ctx) {
  const shape = groupShape(group);
  const [x, y] = group.pos || group._pos;
  const [width, height] = group.size || group._size;
  const titleHeight = group.titleHeight || LiteGraph.NODE_TITLE_HEIGHT || 30;
  const color = group.color || group.constructor?.defaultColour || "#335";
  const editorAlpha = graphCanvas.editor_alpha ?? 1;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.25 * editorAlpha;
  groupPath(ctx, shape, x + 0.5, y + 0.5, width, height);
  ctx.fill();

  ctx.save();
  groupPath(ctx, shape, x + 0.5, y + 0.5, width, height);
  ctx.clip();
  ctx.fillRect(x + 0.5, y + 0.5, width, titleHeight);
  ctx.restore();

  ctx.globalAlpha = editorAlpha;
  groupPath(ctx, shape, x + 0.5, y + 0.5, width, height);
  ctx.stroke();
  drawResizeHandle(ctx, x, y, width, height, color, editorAlpha);

  const fontSize = LiteGraph.GROUP_TEXT_SIZE || 20;
  ctx.font = `${fontSize}px ${LiteGraph.GROUP_FONT || "Inter"}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    group.title + (group.pinned ? "📌" : ""),
    x + fontSize / 2,
    y + titleHeight / 2 + 1,
  );

  if (LiteGraph.highlight_selected_group && group.selected) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    groupPath(ctx, shape, x - 1, y - 1, width + 2, height + 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawRunIcon(ctx, rect, enabled) {
  const inset = 6;
  ctx.beginPath();
  ctx.moveTo(rect.x + inset, rect.y + 4);
  ctx.lineTo(rect.x + rect.width - 4, rect.y + rect.height / 2);
  ctx.lineTo(rect.x + inset, rect.y + rect.height - 4);
  ctx.closePath();
  if (enabled) ctx.fill();
  else ctx.stroke();
}

function drawBypassIcon(ctx, rect, active) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const radius = rect.width * 0.31;

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.72, cy + radius * 0.72);
  ctx.lineTo(cx + radius * 0.72, cy - radius * 0.72);
  ctx.stroke();

  if (active) {
    ctx.save();
    ctx.globalAlpha *= 0.25;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawMuteIcon(ctx, rect, active) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width * 0.34;
  const ry = rect.height * 0.22;

  ctx.beginPath();
  ctx.moveTo(cx - rx, cy);
  ctx.quadraticCurveTo(cx, cy - ry * 2, cx + rx, cy);
  ctx.quadraticCurveTo(cx, cy + ry * 2, cx - rx, cy);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
  ctx.fill();

  if (active) {
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy + ry * 1.7);
    ctx.lineTo(cx + rx, cy - ry * 1.7);
    ctx.stroke();
  }
}

function drawControls(ctx, group, graphCanvas) {
  if (!controlsVisibleFor(group)) return;

  const rects = actionRects(group);
  if (!rects.length) return;

  const status = groupModeState(group);
  const editorAlpha = graphCanvas.editor_alpha ?? 1;

  ctx.save();
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const rect of rects) {
    const hovered = state.hoveredGroup === group && state.hoveredAction === rect.key;
    const active =
      (rect.key === "bypass" && status.allBypassed) ||
      (rect.key === "mute" && status.allMuted);
    const available = rect.key !== "run" || status.hasOutput;

    ctx.globalAlpha = editorAlpha * (available ? 1 : 0.42);
    ctx.fillStyle = active
      ? "rgba(255,255,255,0.30)"
      : hovered
        ? "rgba(0,0,0,0.48)"
        : "rgba(0,0,0,0.28)";
    ctx.strokeStyle = hovered
      ? "rgba(255,255,255,0.95)"
      : "rgba(255,255,255,0.72)";

    drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 5);
    ctx.fill();

    ctx.fillStyle = ctx.strokeStyle;
    if (rect.key === "run") drawRunIcon(ctx, rect, status.hasOutput);
    else if (rect.key === "bypass") drawBypassIcon(ctx, rect, status.allBypassed);
    else drawMuteIcon(ctx, rect, status.allMuted);
  }

  ctx.restore();
}

function findGroupPrototype() {
  const globalPrototype = globalThis.LGraphGroup?.prototype;
  if (globalPrototype?.draw) return globalPrototype;

  for (const group of graphGroups()) {
    const prototype = group?.constructor?.prototype;
    if (prototype?.draw) return prototype;
  }

  return null;
}

function installGroupDrawHook() {
  const prototype = findGroupPrototype();
  if (!prototype?.draw) return false;
  if (prototype.__inteliwebGroupHeaderControls) {
    state.groupPrototype = prototype;
    return true;
  }

  const originalDraw = prototype.draw;
  prototype.draw = function (graphCanvas, ctx) {
    if (groupShape(this) === "default") originalDraw.apply(this, arguments);
    else drawStyledGroup(this, graphCanvas, ctx);

    if (state.enabled) drawControls(ctx, this, graphCanvas);
  };

  prototype.__inteliwebGroupHeaderControls = true;
  prototype.__inteliwebGroupHeaderControlsOriginalDraw = originalDraw;
  state.groupPrototype = prototype;
  markDirty();
  return true;
}

function updateHover(event) {
  if (!state.enabled) {
    if (state.hoveredGroup || state.hoveredAction) {
      state.hoveredGroup = null;
      state.hoveredAction = null;
      markDirty();
    }
    hideTooltip();
    return;
  }

  const point = eventToGraphPoint(event);
  const group = findGroupAt(app.canvas, point);
  const actionRect = group ? actionRectAt(group, point) : null;
  const action = actionRect?.key || null;

  if (group !== state.hoveredGroup || action !== state.hoveredAction) {
    state.hoveredGroup = group;
    state.hoveredAction = action;
    markDirty();
  }

  if (actionRect && state.showTooltips) showTooltip(actionRect, event);
  else hideTooltip();
}

function clearHover() {
  const hadHover = Boolean(state.hoveredGroup || state.hoveredAction);
  state.hoveredGroup = null;
  state.hoveredAction = null;
  hideTooltip();
  if (hadHover) markDirty();
}

function handlePointerDown(event) {
  hideTooltip();
  if (!state.enabled || event.button !== 0) return;

  const point = eventToGraphPoint(event);
  const group = findGroupAt(app.canvas, point);
  if (!group) return;

  const action = actionAt(group, point);
  if (!action) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();

  if (action === "run") void runGroup(group);
  else changeGroupMode(group, action);
}

function attachCanvasListeners() {
  const element = app.canvas?.canvas;
  if (!element) return false;
  if (element === state.canvasElement) return true;

  if (state.canvasElement) {
    state.canvasElement.removeEventListener("pointermove", updateHover, true);
    state.canvasElement.removeEventListener("pointerdown", handlePointerDown, true);
    state.canvasElement.removeEventListener("pointerleave", clearHover, true);
  }

  state.canvasElement = element;
  element.addEventListener("pointermove", updateHover, true);
  element.addEventListener("pointerdown", handlePointerDown, true);
  element.addEventListener("pointerleave", clearHover, true);
  return true;
}

function startCanvasIntegration() {
  installApiQueueFilter();
  installGroupDrawHook();
  attachCanvasListeners();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    installApiQueueFilter();
    const hooked = installGroupDrawHook();
    const attached = attachCanvasListeners();

    if (hooked && attached && attempts > 5) clearInterval(timer);
    if (attempts > 120) clearInterval(timer);
  }, 500);
}

app.registerExtension({
  name: EXTENSION_NAME,

  settings: [
    {
      id: `${SETTING_PREFIX}enabled`,
      name: "Enable group header controls",
      type: "boolean",
      defaultValue: defaults.enabled,
      tooltip: "Adds Run, Bypass and Mute buttons to native ComfyUI group headers.",
      category: ["Inteliweb", "Groups", "Enable group header controls"],
      onChange: (value) => {
        state.enabled = Boolean(value);
        clearHover();
        markDirty();
      },
    },
    {
      id: `${SETTING_PREFIX}visibility`,
      name: "Group header button visibility",
      type: "combo",
      options: ["Always", "Hover"],
      defaultValue: defaults.visibility,
      tooltip: "Always keeps the buttons visible. Hover shows them only over a group or while it is selected.",
      category: ["Inteliweb", "Groups", "Group header button visibility"],
      onChange: (value) => {
        state.visibility = value === "Always" ? "Always" : "Hover";
        markDirty();
      },
    },
    {
      id: `${SETTING_PREFIX}showRun`,
      name: "Show Run button",
      type: "boolean",
      defaultValue: defaults.showRun,
      category: ["Inteliweb", "Groups", "Show Run button"],
      onChange: (value) => {
        state.showRun = Boolean(value);
        hideTooltip();
        markDirty();
      },
    },
    {
      id: `${SETTING_PREFIX}showBypass`,
      name: "Show Bypass button",
      type: "boolean",
      defaultValue: defaults.showBypass,
      category: ["Inteliweb", "Groups", "Show Bypass button"],
      onChange: (value) => {
        state.showBypass = Boolean(value);
        hideTooltip();
        markDirty();
      },
    },
    {
      id: `${SETTING_PREFIX}showMute`,
      name: "Show Mute button",
      type: "boolean",
      defaultValue: defaults.showMute,
      category: ["Inteliweb", "Groups", "Show Mute button"],
      onChange: (value) => {
        state.showMute = Boolean(value);
        hideTooltip();
        markDirty();
      },
    },
    {
      id: `${SETTING_PREFIX}showTooltips`,
      name: "Show tooltips",
      type: "boolean",
      defaultValue: defaults.showTooltips,
      sortOrder: -100,
      tooltip: "Shows a short explanation when hovering over Run, Bypass or Mute.",
      category: ["Inteliweb", "Groups", "Show tooltips"],
      onChange: (value) => {
        state.showTooltips = Boolean(value);
        if (!state.showTooltips) hideTooltip();
      },
    },
  ],

  getCanvasMenuItems(canvas) {
    const point = canvas?.graph_mouse;
    const group = findGroupAt(canvas, point);
    if (!group) return [];

    return [
      null,
      {
        content: "Group Shape (Inteliweb)",
        has_submenu: true,
        submenu: { options: shapeMenuOptions(group) },
      },
    ];
  },

  setup() {
    loadSettings();
    startCanvasIntegration();
  },
});
