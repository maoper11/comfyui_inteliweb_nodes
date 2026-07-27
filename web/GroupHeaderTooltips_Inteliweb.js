import { app } from "../../scripts/app.js";

const SETTING_PREFIX = "Inteliweb.Groups.";
const BUTTON_SIZE = 22;
const BUTTON_GAP = 5;
const BUTTON_MARGIN_X = 6;
const BUTTON_MARGIN_Y = 4;

const ACTIONS = [
  {
    key: "run",
    title: "Run",
    description: "Queue this group's output nodes.",
    setting: "showRun",
  },
  {
    key: "bypass",
    title: "Bypass",
    description: "Skip group processing and pass data through.",
    setting: "showBypass",
  },
  {
    key: "mute",
    title: "Mute",
    description: "Disable group nodes and stop their outputs.",
    setting: "showMute",
  },
];

const state = {
  showTooltips: false,
  canvasElement: null,
  tooltipElement: null,
  activeAction: null,
};

function readSetting(name, fallback) {
  try {
    return app.ui?.settings?.getSettingValue?.(`${SETTING_PREFIX}${name}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function graphGroups(graph) {
  const groups = graph?._groups || graph?.groups;
  if (Array.isArray(groups)) return groups;
  if (groups?.values) return [...groups.values()];
  return [];
}

function eventToGraphPoint(event) {
  const canvas = app.canvas;
  if (!canvas) return null;

  try {
    const point = canvas.convertEventToCanvasOffset?.(event);
    if (point?.length >= 2) return [point[0], point[1]];
  } catch {
    // Fall back to canvas coordinates or graph_mouse.
  }

  if (Number.isFinite(event.canvasX) && Number.isFinite(event.canvasY)) {
    return [event.canvasX, event.canvasY];
  }

  const point = canvas.graph_mouse;
  return point?.length >= 2 ? [point[0], point[1]] : null;
}

function findGroupAt(point) {
  const canvas = app.canvas;
  const graph = canvas?.getCurrentGraph?.() || canvas?.graph || app.graph;
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

function enabledActions() {
  return ACTIONS.filter((action) => Boolean(readSetting(action.setting, true)));
}

function actionRects(group) {
  if (!group) return [];

  const actions = enabledActions();
  const [x, y] = group.pos || group._pos || [0, 0];
  const [width] = group.size || group._size || [0, 0];
  const totalWidth = actions.length * BUTTON_SIZE + Math.max(0, actions.length - 1) * BUTTON_GAP;
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
  return actionRects(group).find((rect) => pointInRect(point, rect)) || null;
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
  const tooltip = ensureTooltipElement();
  tooltip.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = action.title;

  const description = document.createElement("span");
  description.textContent = ` — ${action.description}`;

  tooltip.append(title, description);
  tooltip.style.display = "block";
  positionTooltip(tooltip, event);
  state.activeAction = action.key;
}

function hideTooltip() {
  if (state.tooltipElement) state.tooltipElement.style.display = "none";
  state.activeAction = null;
}

function updateTooltip(event) {
  const controlsEnabled = Boolean(readSetting("enabled", false));
  if (!state.showTooltips || !controlsEnabled) {
    hideTooltip();
    return;
  }

  const point = eventToGraphPoint(event);
  const group = findGroupAt(point);
  const action = actionAt(group, point);

  if (!action) {
    hideTooltip();
    return;
  }

  showTooltip(action, event);
}

function attachCanvasListeners() {
  const element = app.canvas?.canvas;
  if (!element) return false;
  if (element === state.canvasElement) return true;

  if (state.canvasElement) {
    state.canvasElement.removeEventListener("pointermove", updateTooltip, true);
    state.canvasElement.removeEventListener("pointerleave", hideTooltip, true);
    state.canvasElement.removeEventListener("pointerdown", hideTooltip, true);
  }

  state.canvasElement = element;
  element.addEventListener("pointermove", updateTooltip, true);
  element.addEventListener("pointerleave", hideTooltip, true);
  element.addEventListener("pointerdown", hideTooltip, true);
  return true;
}

function startCanvasIntegration() {
  attachCanvasListeners();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (attachCanvasListeners() && attempts > 5) clearInterval(timer);
    if (attempts > 120) clearInterval(timer);
  }, 500);
}

app.registerExtension({
  name: "Inteliweb.GroupHeaderTooltips",

  settings: [
    {
      id: `${SETTING_PREFIX}showTooltips`,
      name: "Show tooltips",
      type: "boolean",
      defaultValue: false,
      sortOrder: -100,
      tooltip: "Shows a short explanation when hovering over Run, Bypass or Mute.",
      category: ["Inteliweb", "Groups", "Show tooltips"],
      onChange: (value) => {
        state.showTooltips = Boolean(value);
        if (!state.showTooltips) hideTooltip();
      },
    },
  ],

  setup() {
    state.showTooltips = Boolean(readSetting("showTooltips", false));
    startCanvasIntegration();
  },
});
