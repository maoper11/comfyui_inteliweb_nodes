import { app } from "../../scripts/app.js";

const COLORS = {
  headerBg: "#1f2430",
  panelBg: "#0f172a",
  stripe: "#4a90e2",
  bad: "#ef4444",
  warn: "#f59e0b",
};

const ICONS = {
  "Python version": "🐍",
  "Operating System": "🖥️",
  CPU: "⚙️",
  RAM: "🧠",
  VRAM: "🎮",
  GPU: "🎮",
  "CUDA version": "🚀",
  PyTorch: "🔥",
  torchvision: "👁️",
  xformers: "⚡",
  numpy: "🔢",
  Pillow: "🖼️",
  OpenCV: "📷",
  transformers: "🧩",
  diffusers: "💧",
  huggingface_hub: "🤗",
  tokenizers: "🔤",
  onnx: "🧱",
  onnxruntime: "🏃",
  timm: "🖼️",
  accelerate: "🏎️",
  bitsandbytes: "🧮",
  ultralytics: "🕵️",
  mediapipe: "🧠",
  sentencepiece: "✂️",
  kornia: "🧪",
  insightface: "🙂",
  scipy: "📐",
  "scikit-image": "🧷",
  pandas: "🐼",
  triton: "🔱",
  SageAttention: "🌿",
  "Flash Attention": "⚡",
  AV: "🎞️",
};

const CATEGORIES = {
  "== System ==": ["Python version", "Operating System", "CPU", "RAM"],
  "== GPU / CUDA ==": ["VRAM", "GPU", "CUDA version", "Flash Attention"],
  "== Core libs ==": ["PyTorch", "torchvision", "xformers", "numpy"],
  "== Vision / Audio ==": ["OpenCV", "Pillow", "timm", "ultralytics", "mediapipe"],
  "== ONNX / Runtime ==": ["onnx", "onnxruntime", "accelerate", "bitsandbytes"],
  "== Text ==": ["transformers", "diffusers", "huggingface_hub", "tokenizers", "sentencepiece"],
  "== Others ==": ["kornia", "insightface", "scipy", "scikit-image", "pandas", "triton", "SageAttention", "AV"],
};
const CATEGORY_ORDER = Object.keys(CATEGORIES);

function ensureCursorStyles() {
  if (document.getElementById("inteliweb-cursor-style")) return;
  const style = document.createElement("style");
  style.id = "inteliweb-cursor-style";
  style.textContent = `canvas[data-inteliweb-cursor="hand"] { cursor: pointer !important; }`;
  document.head.appendChild(style);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lighten(hex, amount = 20) {
  const value = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (value >> 16) + Math.round(2.55 * amount)));
  const g = Math.min(255, Math.max(0, ((value >> 8) & 255) + Math.round(2.55 * amount)));
  const b = Math.min(255, Math.max(0, (value & 255) + Math.round(2.55 * amount)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function statusColor(value) {
  const text = String(value ?? "");
  if (!text || /not installed/i.test(text)) return COLORS.bad;
  if (/unknown|present/i.test(text)) return COLORS.warn;
  return COLORS.stripe;
}

function drawButton(ctx, x, y, w, h, label) {
  ctx.save();
  ctx.fillStyle = lighten(COLORS.headerBg, -15);
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "12px ui-sans-serif, system-ui, Segoe UI, Roboto";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function drawBadge(ctx, x, y, w, h, label, value, icon, color) {
  ctx.save();
  const gradient = ctx.createLinearGradient(x, y, x + w, y);
  gradient.addColorStop(0, lighten(color, 10));
  gradient.addColorStop(0.35, color);
  gradient.addColorStop(1, lighten(color, -10));
  ctx.fillStyle = gradient;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  ctx.fillStyle = lighten(color, -15);
  roundRect(ctx, x, y, 36, h, 8);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "16px sans-serif";
  ctx.fillText(icon || "ℹ️", x + 18, y + h / 2 + 1);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = "bold 12px ui-sans-serif, system-ui, Segoe UI, Roboto";
  ctx.fillText(String(label), x + 46, y + 18);

  let text = String(value ?? "");
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const maxWidth = Math.max(80, w * 0.48);
  while (text.length && ctx.measureText(text + "…").width > maxWidth) text = text.slice(0, -1);
  if (text !== String(value ?? "")) text += "…";
  ctx.textAlign = "right";
  ctx.fillText(text, x + w - 10, y + h - 8);
  ctx.restore();
}

function getWidgetsBottomY(node) {
  const start = node.widgets_start_y ?? node.widgetsStartY ?? 32;
  if (Array.isArray(node.widgets) && node.widgets.length) {
    const last = node.widgets[node.widgets.length - 1];
    const y = last?.last_y ?? last?.y;
    if (typeof y === "number") return y + (last?.height ?? 20) + 2;
  }
  let y = start;
  for (const widget of node.widgets || []) y += (widget?.height ?? 20) + 4;
  return y;
}

async function fetchJSON(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? await response.json() : {};
}

function telemetryTick(node) {
  return fetchJSON("/inteliweb/telemetry")
    .then((data) => {
      if (data?.vram) node._inteliweb_vram = data.vram;
      if (data?.ram) node._inteliweb_ram = data.ram;
      node.setDirtyCanvas(true);
    })
    .catch(() => {});
}

function startTelemetry(node) {
  if (node.__inteliweb_timer) return;
  telemetryTick(node);
  node.__inteliweb_timer = setInterval(() => telemetryTick(node), 1000);
}

function stopTelemetry(node) {
  if (!node.__inteliweb_timer) return;
  clearInterval(node.__inteliweb_timer);
  node.__inteliweb_timer = null;
}

app.registerExtension({
  name: "inteliweb.system.check",
  async nodeCreated(node) {
    if (node.comfyClass !== "InteliwebSystemCheck") return;
    ensureCursorStyles();

    node.color = COLORS.headerBg;
    node.bgcolor = COLORS.panelBg;
    node.size = [560, 360];
    node._inteliweb_info = null;
    node._inteliweb_text = "";
    node._inteliweb_vram = { free_mb: 0, total_mb: 0 };
    node._inteliweb_ram = { used_mb: 0, free_mb: 0, total_mb: 0 };
    node.__inteliweb_collapsed = {};
    node.__inteliweb_hits = [];
    startTelemetry(node);

    const runButton = node.addWidget("button", "Run", null, async () => {
      try {
        const info = await fetchJSON("/inteliweb_sysinfo");
        node._inteliweb_info = info;
        node._inteliweb_text = Object.entries(info)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n");
        if (!node.__inteliweb_firstRunDone) {
          CATEGORY_ORDER.forEach((category, index) => {
            node.__inteliweb_collapsed[category] = index >= 3;
          });
          node.__inteliweb_firstRunDone = true;
        }
        await telemetryTick(node);
        node.setDirtyCanvas(true, true);
      } catch (error) {
        console.error("[Inteliweb] System Check failed:", error);
      }
    });
    runButton.serialize = false;

    node.__inteliweb_actions = {
      async free_memory() {
        try {
          const result = await fetchJSON("/inteliweb/free_memory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (!result?.ok) throw new Error(result?.text || "Memory cleanup failed");
          if (result.vram) node._inteliweb_vram = result.vram;
          if (result.ram) node._inteliweb_ram = result.ram;
          node.setDirtyCanvas(true, true);
        } catch (error) {
          console.error("[Inteliweb] Free Memory failed:", error);
        }
      },
      copy() {
        navigator.clipboard?.writeText(node._inteliweb_text || "").catch((error) => {
          console.warn("[Inteliweb] Clipboard unavailable:", error);
        });
      },
    };

    node.onDrawForeground = function (ctx) {
      ctx.save();
      const PAD = 14;
      const innerW = node.size[0] - PAD * 2;
      const toolbarY = getWidgetsBottomY(node) + 6;
      const buttonH = 28;
      const gap = 8;
      const buttonW = Math.floor((innerW - gap) / 2);

      node.__inteliweb_hits = (node.__inteliweb_hits || []).filter(
        (hit) => hit.type !== "btn" && hit.type !== "cat",
      );

      drawButton(ctx, PAD, toolbarY, buttonW, buttonH, "Free Memory");
      node.__inteliweb_hits.push({ type: "btn", key: "free_memory", x: PAD, y: toolbarY, w: buttonW, h: buttonH });

      drawButton(ctx, PAD + buttonW + gap, toolbarY, buttonW, buttonH, "Copy");
      node.__inteliweb_hits.push({ type: "btn", key: "copy", x: PAD + buttonW + gap, y: toolbarY, w: buttonW, h: buttonH });

      let y = toolbarY + buttonH + 8;
      const data = node._inteliweb_info;
      if (!data) {
        ctx.fillStyle = "#ddd";
        ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        ctx.fillText("Press Run to collect system information.", PAD, y + 16);
        node.size[1] = Math.max(180, y + 40);
        ctx.restore();
        return;
      }

      for (const category of CATEGORY_ORDER) {
        const collapsed = !!node.__inteliweb_collapsed[category];
        ctx.fillStyle = lighten(COLORS.headerBg, -10);
        roundRect(ctx, PAD, y, innerW, 24, 6);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "12px ui-sans-serif, system-ui, Segoe UI, Roboto";
        ctx.textAlign = "left";
        ctx.fillText(`${collapsed ? "▶" : "▼"} ${category}`, PAD + 8, y + 16);
        node.__inteliweb_hits.push({ type: "cat", key: category, x: PAD, y, w: innerW, h: 24 });
        y += 30;
        if (collapsed) continue;

        for (const key of CATEGORIES[category]) {
          let value = data[key];
          if (key === "VRAM") {
            const free = node._inteliweb_vram?.free_mb || 0;
            const total = node._inteliweb_vram?.total_mb || 0;
            const used = Math.max(total - free, 0);
            value = total ? `${used} / ${total} MB (${Math.round((used / total) * 100)}%)` : "0 / 0 MB";
          } else if (key === "RAM") {
            const used = node._inteliweb_ram?.used_mb || 0;
            const total = node._inteliweb_ram?.total_mb || 0;
            value = total ? `${(used / 1024).toFixed(2)} / ${(total / 1024).toFixed(2)} GB (${Math.round((used / total) * 100)}%)` : data.RAM;
          }
          if (value === undefined) continue;
          drawBadge(ctx, PAD, y, innerW, 30, key, value, ICONS[key], statusColor(value));
          y += 38;
        }
      }

      node.size[1] = Math.max(220, y + PAD);
      ctx.restore();
    };

    const originalMouseDown = node.onMouseDown;
    node.onMouseDown = function (event, pos, graphcanvas) {
      for (const hit of node.__inteliweb_hits || []) {
        const inside = pos[0] >= hit.x && pos[0] <= hit.x + hit.w && pos[1] >= hit.y && pos[1] <= hit.y + hit.h;
        if (!inside) continue;
        if (hit.type === "cat") {
          node.__inteliweb_collapsed[hit.key] = !node.__inteliweb_collapsed[hit.key];
          node.setDirtyCanvas(true, true);
          return true;
        }
        if (hit.type === "btn" && node.__inteliweb_actions?.[hit.key]) {
          node.__inteliweb_actions[hit.key]();
          return true;
        }
      }
      return originalMouseDown ? originalMouseDown.apply(this, arguments) : false;
    };

    node.onMouseMove = function (event, pos, graphcanvas) {
      const canvas = graphcanvas?.canvas || app?.graph?.canvas?.canvas || app?.canvas?.canvas;
      if (!canvas) return false;
      const over = (node.__inteliweb_hits || []).some(
        (hit) => pos[0] >= hit.x && pos[0] <= hit.x + hit.w && pos[1] >= hit.y && pos[1] <= hit.y + hit.h,
      );
      if (over) canvas.setAttribute("data-inteliweb-cursor", "hand");
      else canvas.removeAttribute("data-inteliweb-cursor");
      return false;
    };

    node.onMouseLeave = function () {
      const canvas = app?.graph?.canvas?.canvas || app?.canvas?.canvas;
      canvas?.removeAttribute("data-inteliweb-cursor");
    };

    const originalRemoved = node.onRemoved;
    node.onRemoved = function () {
      stopTelemetry(this);
      const canvas = app?.graph?.canvas?.canvas || app?.canvas?.canvas;
      canvas?.removeAttribute("data-inteliweb-cursor");
      if (originalRemoved) originalRemoved.apply(this, arguments);
    };
  },
});
