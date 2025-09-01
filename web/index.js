import { app } from "../../scripts/app.js";

/**
 * Inject minimal CSS once.
 * We avoid depending on LiteGraph's CSS class names and instead
 * toggle a data-attribute on the actual <canvas> element.
 */
function ensureCursorStyles() {
  if (document.getElementById("inteliweb-cursor-style")) return;
  const st = document.createElement("style");
  st.id = "inteliweb-cursor-style";
  st.textContent = `
    canvas[data-inteliweb-cursor="arrow"] { cursor: default !important; }
    canvas[data-inteliweb-cursor="hand"]  { cursor: pointer !important; }
  `;
  document.head.appendChild(st);
}

// --- Pretty style helpers (kept from previous working version) ---
const ICONS = {
  "Python version": "🐍",
  "Operating System": "🖥️",
  CPU: "⚙️",
  RAM: "🧠",
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
  sageattention: "🌿",
  "flash-attn (package)": "⚡",
};

const COLORS = {
  headerBg: "#1f2430",
  panelBg: "#0f172a",
  text: "#d8dee9",
  ok: "#22c55e",
  warn: "#f59e0b",
  bad: "#ef4444",
  stripe: "#4a90e2",
};

function lighten(hex, amt = 20) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(2.55 * amt)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + Math.round(2.55 * amt)));
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + Math.round(2.55 * amt)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
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

function statusColor(val) {
  if (!val || /not installed/i.test(String(val))) return COLORS.bad;
  if (/unknown|present/i.test(String(val))) return COLORS.warn;
  return COLORS.stripe;
}

function drawBadge(ctx, x, y, w, h, label, value, icon, baseColor, animT) {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x + w, y);
  const wave = 0.25 + 0.25 * Math.sin(animT * 2 * Math.PI);
  g.addColorStop(0, lighten(baseColor, 10));
  g.addColorStop(wave, baseColor);
  g.addColorStop(1, lighten(baseColor, -10));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  const stripeW = 36;
  ctx.fillStyle = lighten(baseColor, -15);
  roundRect(ctx, x, y, stripeW, h, 8);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon || "ℹ️", x + stripeW / 2, y + h / 2 + 1);

  const pad = 10;
  const innerLeft = x + stripeW + pad;
  const innerRight = x + w - pad;
  const innerWidth = innerRight - innerLeft;

  const labelStr = String(label ?? "");
  let valStr = String(value ?? "");

  ctx.textBaseline = "alphabetic";

  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  let valW = ctx.measureText(valStr).width;
  const maxValW = Math.max(80, Math.floor(innerWidth * 0.55));
  if (valW > maxValW) {
    while (valStr.length && ctx.measureText(valStr + "…").width > maxValW) {
      valStr = valStr.slice(0, -1);
    }
    valStr += "…";
    valW = ctx.measureText(valStr).width;
  }

  const maxLabelW = innerWidth - valW - 8;
  ctx.font = "bold 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
  let labelDraw = labelStr;
  if (ctx.measureText(labelDraw).width > maxLabelW) {
    while (labelDraw.length && ctx.measureText(labelDraw + "…").width > maxLabelW) {
      labelDraw = labelDraw.slice(0, -1);
    }
    labelDraw += "…";
  }

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(labelDraw, innerLeft, y + 18);

  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText(valStr, innerRight, y + h - 8);

  ctx.restore();
}

function drawVRAMBadge(ctx, x, y, w, h, vram, baseColor, animT) {
  const used = Math.max((vram?.total_mb || 0) - (vram?.free_mb || 0), 0);
  const total = Math.max(vram?.total_mb || 0, 0);
  const pct = total > 0 ? Math.min(used / total, 1) : 0;
  const label = "VRAM";
  const value = total > 0 ? `${used} / ${total} MB (${Math.round(pct * 100)}%)` : "0 / 0 MB";
  drawBadge(ctx, x, y, w, h, label, value, "🧠", baseColor, animT);

  const pad = 10, stripeW = 36;
  const innerX = x + stripeW + pad;
  const innerW = w - stripeW - pad * 2;

  const meterW = Math.max(1, Math.floor(innerW * 0.4));
  const meterH = 12;
  const meterX = innerX + Math.floor((innerW - meterW) / 2);
  const meterY = y + h - meterH - 8;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = lighten(baseColor, -25);
  roundRect(ctx, meterX, meterY, meterW, meterH, 6);
  ctx.fill();

  ctx.fillStyle = "#22c55e";
  roundRect(ctx, meterX, meterY, Math.floor(meterW * pct), meterH, 6);
  ctx.fill();
  ctx.restore();
}

function drawRAMBadge(ctx, x, y, w, h, ram, baseColor, animT) {
  const used = Math.max(ram?.used_mb || 0, 0);
  const total = Math.max(ram?.total_mb || 0, 0);
  const pct = total > 0 ? Math.min(used / total, 1) : 0;

  const usedGB = (used / 1024).toFixed(2);
  const totalGB = (total / 1024).toFixed(2);
  const label = "RAM";
  const value = total > 0 ? `${usedGB} / ${totalGB} GB (${Math.round(pct * 100)}%)` : "0.00 / 0.00 GB";

  drawBadge(ctx, x, y, w, h, label, value, "🧠", baseColor, animT);

  const pad = 10, stripeW = 36;
  const innerX = x + stripeW + pad;
  const innerW = w - stripeW - pad * 2;

  const meterW = Math.max(1, Math.floor(innerW * 0.4));
  const meterH = 12;
  const meterX = innerX + Math.floor((innerW - meterW) / 2);
  const meterY = y + h - meterH - 8;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = lighten(baseColor, -25);
  roundRect(ctx, meterX, meterY, meterW, meterH, 6);
  ctx.fill();

  ctx.fillStyle = "#22c55e";
  roundRect(ctx, meterX, meterY, Math.floor(meterW * pct), meterH, 6);
  ctx.fill();
  ctx.restore();
}

function getWidgetsBottomY(node) {
  const startY = node.widgets_start_y ?? node.widgetsStartY ?? 32;
  if (Array.isArray(node.widgets) && node.widgets.length) {
    const last = node.widgets[node.widgets.length - 1];
    const yStamped = last?.last_y ?? last?.y;
    const hStamped = last?.height ?? 20;
    if (typeof yStamped === "number") return yStamped + hStamped + 2;
  }
  const SPACING = 4;
  let y = startY;
  if (Array.isArray(node.widgets)) {
    for (const w of node.widgets) y += (typeof w?.height === "number" ? w.height : 20) + SPACING;
  }
  return y;
}

const CATEGORIES = {
  "== System ==": ["Python version", "Operating System", "CPU", "RAM"],
  "== GPU / CUDA ==": ["VRAM", "GPU", "CUDA version", "Flash Attention", "flash-attn (package)"],
  "== Core libs ==": ["PyTorch", "torchvision", "xformers", "numpy"],
  "== Vision / Audio ==": ["OpenCV", "Pillow", "ultralytics", "mediapipe"],
  "== ONNX / Runtime ==": ["onnx", "onnxruntime", "accelerate", "bitsandbytes"],
  "== Text ==": ["transformers", "diffusers", "huggingface_hub", "tokenizers", "sentencepiece"],
  "== Others ==": ["kornia", "insightface", "scipy", "scikit-image", "pandas", "triton", "sageattention"],
};
const CATEGORY_ORDER = Object.keys(CATEGORIES);

function prettyFormat(info) {
  const cat = {
    "== GPU / CUDA ==": ["GPU", "CUDA version", "Flash Attention", "flash-attn (package)"],
    "== Core libs ==": ["PyTorch", "torchvision", "xformers", "numpy"],
    "== Vision / Audio ==": ["OpenCV", "Pillow", "timm", "ultralytics", "mediapipe"],
    "== ONNX / Runtime ==": ["onnx", "onnxruntime", "accelerate", "bitsandbytes"],
    "== Text ==": ["transformers", "diffusers", "huggingface_hub", "tokenizers", "sentencepiece"],
    "== Others ==": ["kornia", "insightface", "scipy", "scikit-image", "pandas", "triton", "sageattention"],
  };
  let out = `RAM: ${info["RAM"] || "Unknown"}\n`;
  for (const [title, keys] of Object.entries(cat)) {
    out += `\n${title}\n`;
    for (const k of keys) {
      if (info[k] !== undefined) out += `${k}: ${info[k]}\n`;
    }
  }
  return out.trim();
}


function startInteliwebTelemetry(node) {
  if (node.__inteliweb_timer) return; // already running
  const tick = async () => {
    try {
      const t = await fetchJSON("/inteliweb/telemetry");
      if (t?.vram) node._inteliweb_vram = t.vram;
      if (t?.ram) node._inteliweb_ram = t.ram;
      node.setDirtyCanvas(true);
    } catch (e) {
      // swallow errors to avoid spamming console if server reloads
    }
  };
  // fire once immediately, then every second
  tick();
  node.__inteliweb_timer = setInterval(tick, 1000);
}
function stopInteliwebTelemetry(node) {
  if (node.__inteliweb_timer) {
    clearInterval(node.__inteliweb_timer);
    node.__inteliweb_timer = null;
  }
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return await r.json();
}

app.registerExtension({
  name: "inteliweb.system.check",
  async nodeCreated(node) {
    ensureCursorStyles();
    if (node.comfyClass !== "InteliwebSystemCheck") return;

    startInteliwebTelemetry(node);

    node._inteliweb_info = null;
    node._inteliweb_text = "";
    node._inteliweb_style = "Pretty";
    node._inteliweb_vram = { free_mb: 0, total_mb: 0 };
    node._inteliweb_ram = { used_mb: 0, total_mb: 0, free_mb: 0 };
    node.color = COLORS.headerBg;
    node.bgcolor = COLORS.panelBg;

    const baseStart =
      typeof node.widgets_start_y === "number"
        ? node.widgets_start_y
        : typeof node.widgetsStartY === "number"
        ? node.widgetsStartY
        : 6;

    node.widgets_start_y = baseStart + 2;
    node.widgetsStartY = node.widgets_start_y;

    const runBtn = node.addWidget("button", "Run", null, async () => {
      try {
        const info = await fetchJSON("/inteliweb_sysinfo");
        node._inteliweb_info = info;
        node.__inteliweb_data = info;
        try {
          const sys = await fetchJSON("/inteliweb/system_info");
          if (sys?.vram) node._inteliweb_vram = sys.vram;
          if (sys?.ram) node._inteliweb_ram = sys.ram;
        } catch (e) {}

        if (!node.__inteliweb_firstRunDone) {
          node.__inteliweb_collapsed = node.__inteliweb_collapsed || {};
          const order = typeof CATEGORY_ORDER !== "undefined" ? CATEGORY_ORDER : [];
          for (let i = 0; i < order.length; i++) {
            node.__inteliweb_collapsed[order[i]] = i < 3 ? false : true;
          }
          node.__inteliweb_firstRunDone = true;
        }
        node.__inteliweb_anim0 = node.__inteliweb_anim0 || Math.random();
        renderCurrent(node);
        node.setDirtyCanvas(true);
      } catch (e) {
        console.error(e);
      }
    });
    runBtn.serialize = false;

    node.__inteliweb_actions = {
      async free_vram() {
        try {
          const res = await fetchJSON(`/inteliweb/free_vram?mode=aggressive`);
          if (res?.vram) node._inteliweb_vram = res.vram;
          node.setDirtyCanvas(true);
        } catch (e) { console.error(e); }
      },
      async free_ram() {
        try {
          const res = await fetchJSON(`/inteliweb/free_ram`);
          if (res?.ram) node._inteliweb_ram = res.ram;
          node.setDirtyCanvas(true);
        } catch (e) { console.error(e); }
      },
      copy() {
        try { navigator.clipboard.writeText(node._inteliweb_text || ""); }
        catch (e) { console.warn("Clipboard not available", e); }
      },
    };

    node.onDrawForeground = function (ctx) {
      ctx.save();
      const PAD = 14;
      const innerW = node.size[0] - PAD * 2;

      const TOOLBAR_GAP_TOP = 6;
      const TOOLBAR_GAP_BOTTOM = 8;
      const BTN_H = 28;
      const GAP = 8;
      const colW = Math.floor((innerW - GAP * 2) / 3);

      const toolbarX = PAD;
      const toolbarY = getWidgetsBottomY(node) + TOOLBAR_GAP_TOP;

      if (!Array.isArray(node.__inteliweb_hits)) node.__inteliweb_hits = [];
      node.__inteliweb_hits = node.__inteliweb_hits.filter((h) => h.type !== "btn" && h.type !== "cat");

      function drawToolbarBtn(x, y, w, h, label) {
        ctx.save();
        ctx.fillStyle = lighten(COLORS.headerBg, -15);
        roundRect(ctx, x, y, w, h, 6);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "12px ui-sans-serif, system-ui, Segoe UI, Roboto";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x + w / 2, y + h / 2 + 1);
        ctx.restore();
      }

      drawToolbarBtn(toolbarX, toolbarY, colW, BTN_H, "Free VRAM");
      node.__inteliweb_hits.push({ type: "btn", key: "free_vram", x: toolbarX, y: toolbarY, w: colW, h: BTN_H });

      drawToolbarBtn(toolbarX + colW + GAP, toolbarY, colW, BTN_H, "Free RAM");
      node.__inteliweb_hits.push({ type: "btn", key: "free_ram", x: toolbarX + colW + GAP, y: toolbarY, w: colW, h: BTN_H });

      drawToolbarBtn(toolbarX + (colW + GAP) * 2, toolbarY, colW, BTN_H, "Copy");
      node.__inteliweb_hits.push({ type: "btn", key: "copy", x: toolbarX + (colW + GAP) * 2, y: toolbarY, w: colW, h: BTN_H });

      let y = toolbarY + BTN_H + TOOLBAR_GAP_BOTTOM;
      const prettyMode = !!node.__inteliweb_data;

      if (prettyMode) {
        const data = node.__inteliweb_data;
        node.__inteliweb_collapsed = node.__inteliweb_collapsed || {};
        for (const cat of CATEGORY_ORDER) {
          if (!(cat in node.__inteliweb_collapsed)) node.__inteliweb_collapsed[cat] = false;
        }

        const badgeH = 30;
        const gap = 8;
        const catH = 24;
        const animT0 = (performance.now() / 2000 + (node.__inteliweb_anim0 || 0)) % 1;

        for (const cat of CATEGORY_ORDER) {
          const hx = PAD, hy = y, hw = innerW, hh = catH;
          ctx.fillStyle = lighten(COLORS.headerBg, -10);
          roundRect(ctx, hx, hy, hw, hh, 6);
          ctx.fill();

          ctx.fillStyle = "#fff";
          ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
          const collapsed = !!node.__inteliweb_collapsed[cat];
          const chev = collapsed ? "▶" : "▼";
          ctx.fillText(`${chev} ${cat}`, hx + 8, hy + 16);

          node.__inteliweb_hits.push({ type: "cat", key: cat, x: hx, y: hy, w: hw, h: hh });

          y += catH + 6;
          if (collapsed) continue;

          const keys = CATEGORIES[cat];
          for (const k of keys) {
            if (k === "VRAM") {
              const vram = node._inteliweb_vram || { free_mb: 0, total_mb: 0 };
              const base = "#4a90e2";
              drawVRAMBadge(ctx, PAD, y, innerW, badgeH, vram, base, (animT0 + (y % 1000) * 0.0003) % 1);
              y += badgeH + gap;
              continue;
            }
            if (k === "RAM") {
              const ram = node._inteliweb_ram || { used_mb: 0, total_mb: 0, free_mb: 0 };
              const base = statusColor(String(data?.["RAM"] ?? "")) || "#4a90e2";
              drawRAMBadge(ctx, PAD, y, innerW, badgeH, ram, base, (animT0 + (y % 1000) * 0.0003) % 1);
              y += badgeH + gap;
              continue;
            }
            if (!(k in data)) continue;
            const v = data[k];
            const icon = ICONS[k] || "ℹ️";
            const base = statusColor(String(v));
            drawBadge(ctx, PAD, y, innerW, badgeH, k, v, icon, base, (animT0 + (y % 1000) * 0.0003) % 1);
            y += badgeH + gap;
          }
        }

        node.__inteliweb_y_end = y;
        const desired = Math.min(1100, Math.max(220, y + PAD));
        if (node.size[1] !== desired) node.size[1] = desired;
      } else {
        ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
        ctx.fillStyle = "#ddd";
        const text = node._inteliweb_text || " ";
        const lines = text.split("\n");
        for (const ln of lines) { ctx.fillText(ln, PAD, y); y += 16; }
        node.__inteliweb_y_end = y;
        const desired = Math.max(180, y + 10);
        if (node.size[1] !== desired) node.size[1] = desired;
      }

      ctx.restore();
    };

    function renderCurrent(node) {
      const info = node._inteliweb_info;
      node.__inteliweb_data = info;
      if (!info) { node._inteliweb_text = ""; return; }
      const header = [
        `Python version: ${info["Python version"]}`,
        `Operating System: ${info["Operating System"]}`,
        `CPU: ${info["CPU"]}`,
      ].join("\n");
      const body = prettyFormat(info);
      node._inteliweb_text = header + "\n\n" + body + "\n";
      node.size[0] = Math.max(520, node.size[0]);
    }

    node.size = [560, 360];

    const _origMouse = node.onMouseDown;
    node.onMouseDown = function (e, pos, graphcanvas) {
      if (Array.isArray(node.__inteliweb_hits)) {
        for (const hit of node.__inteliweb_hits) {
          if (pos[0] >= hit.x && pos[0] <= hit.x + hit.w && pos[1] >= hit.y && pos[1] <= hit.h + hit.y) {
            if (hit.type === "cat") {
              node.__inteliweb_collapsed[hit.key] = !node.__inteliweb_collapsed[hit.key];
              node.setDirtyCanvas(true, true);
              return true;
            } else if (hit.type === "btn" && node.__inteliweb_actions?.[hit.key]) {
              node.__inteliweb_actions[hit.key]();
              return true;
            }
          }
        }
      }
      return _origMouse ? _origMouse.apply(this, arguments) : false;
    };

    // Future-proof cursor handling: only while the pointer is inside *this node*
    node.onMouseMove = function (e, pos, graphcanvas) {
      const c = graphcanvas?.canvas || app?.graph?.canvas?.canvas || app?.canvas?.canvas;
      if (!c) return false;

      const insideNode = pos[0] >= 0 && pos[1] >= 0 && pos[0] <= this.size[0] && pos[1] <= this.size[1];
      let overHotspot = false;
      if (insideNode && Array.isArray(node.__inteliweb_hits)) {
        for (const h of node.__inteliweb_hits) {
          if (pos[0] >= h.x && pos[0] <= h.x + h.w && pos[1] >= h.y && pos[1] <= h.y + h.h) { overHotspot = true; break; }
        }
      }

      if (insideNode) {
        c.setAttribute("data-inteliweb-cursor", overHotspot ? "hand" : "arrow");
      } else {
        c.removeAttribute("data-inteliweb-cursor");
      }
      return false;
    };

    const _origOnRemoved = node.onRemoved;
    node.onRemoved = function () {
      const c = app?.graph?.canvas?.canvas || app?.canvas?.canvas;
      if (c) c.removeAttribute("data-inteliweb-cursor");
      stopInteliwebTelemetry(this);
      if (_origOnRemoved) _origOnRemoved.apply(this, arguments);
    };
  },
});
