import { app } from "../../scripts/app.js";

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
};

const state = {
  ...defaults,
  hoveredGroup: null,
  hoveredAction: null,
  canvasElement: null,
  groupPrototype: null,
};

const ACTIONS = [
  { key: "run", label: "Run" },
  { key: "bypass", label: "Bypass" },
  { key: "mute", label: "Mute" },
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
}

function enabledActions() {
  return ACTIONS.filter((action) => {
    if (action.key === "run") return state.showRun;
    if (action.key === "bypass") return state.showBypass;
    if (action.key === "mute") return state.showMute;
    return false;
  });
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
    if (Array.isArray(childNodes)) {
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

function outputNodesForGroup(group, recompute = false) {
  return collectGroupNodes(group, recompute).filter(isOutputNode);
}

function notify(message) {
  console.warn(`[Inteliweb] ${message}`);
  try {
    app.ui?.dialog?.show?.(message);
  } catch {
    // Console warning is the final fallback.
  }
}

async function runGroup(group) {
  const outputs = outputNodesForGroup(group, true);
  if (!outputs.length) {
    notify("This group does not contain an output node to run.");
    return;
  }

  const canvas = app.canvas;
  const command = app.extensionManager?.command;

  if (!canvas || !command?.execute) {
    if (window.rgthree?.queueOutputNodes) {
      await window.rgthree.queueOutputNodes(outputs);
      return;
    }
    notify("Queue Selected Output Nodes is unavailable in this ComfyUI frontend.");
    return;
  }

  const previousNodes = Object.values(canvas.selected_nodes || {});
  const previousGroup = canvas.selected_group || null;

  try {
    canvas.deselectAllNodes?.();
    if (canvas.selectItems) canvas.selectItems(outputs);
    else for (const node of outputs) canvas.selectNode?.(node, true);

    await command.execute("Comfy.QueueSelectedOutputNodes");
  } catch (error) {
    console.error("[Inteliweb] Could not run group output nodes:", error);
    notify("The group could not be queued. See the browser console for details.");
  } finally {
    canvas.deselectAllNodes?.();
    for (const node of previousNodes) canvas.selectNode?.(node, true);
    canvas.selected_group = previousGroup;
    markDirty();
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
    hasOutput: nodes.some(isOutputNode),
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

function actionAt(group, point) {
  return actionRects(group).find((rect) => pointInRect(point, rect))?.key || null;
}

function controlsVisibleFor(group) {
  if (!state.enabled) return false;
  if (state.visibility === "Always") return true;
  return state.hoveredGroup === group || Boolean(group?.selected);
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
    if (groupShape(this) === "default") {
      originalDraw.apply(this, arguments);
    } else {
      drawStyledGroup(this, graphCanvas, ctx);
    }

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
    return;
  }

  const point = eventToGraphPoint(event);
  const group = findGroupAt(app.canvas, point);
  const action = group ? actionAt(group, point) : null;

  if (group !== state.hoveredGroup || action !== state.hoveredAction) {
    state.hoveredGroup = group;
    state.hoveredAction = action;
    markDirty();
  }
}

function clearHover() {
  if (!state.hoveredGroup && !state.hoveredAction) return;
  state.hoveredGroup = null;
  state.hoveredAction = null;
  markDirty();
}

function handlePointerDown(event) {
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
  installGroupDrawHook();
  attachCanvasListeners();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
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
        markDirty();
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
