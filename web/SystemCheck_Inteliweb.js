import { app } from "../../scripts/app.js";

const CATEGORIES = {
  System: ["Python version", "Operating System", "CPU", "RAM"],
  "GPU & Runtime": ["VRAM", "GPU", "Accelerator runtime"],
  "Acceleration & Attention": ["PyTorch", "torchvision", "xformers", "triton", "SageAttention", "FlashAttention", "bitsandbytes"],
  "Vision & Media": ["numpy", "Pillow", "OpenCV", "timm", "kornia", "scipy", "scikit-image", "AV"],
  "Model Ecosystem": ["transformers", "diffusers", "accelerate", "huggingface_hub", "tokenizers", "sentencepiece"],
  "ONNX Runtime": ["onnx", "onnxruntime"],
};

const ICONS = {
  "Python version": "🐍", "Operating System": "🖥️", CPU: "⚙️", RAM: "🧠",
  VRAM: "🎮", GPU: "🎮", "Accelerator runtime": "🚀", PyTorch: "🔥",
  torchvision: "👁️", xformers: "⚡", triton: "🔱", SageAttention: "🌿",
  FlashAttention: "⚡", bitsandbytes: "🧮", numpy: "🔢", Pillow: "🖼️",
  OpenCV: "📷", timm: "🖼️", kornia: "🧪", scipy: "📐",
  "scikit-image": "🧷", AV: "🎞️", transformers: "🧩", diffusers: "💧",
  accelerate: "🏎️", huggingface_hub: "🤗", tokenizers: "🔤",
  sentencepiece: "✂️", onnx: "🧱", onnxruntime: "🏃",
};

async function fetchJSON(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

function isMissing(value) {
  return /not installed/i.test(String(value ?? ""));
}

function formatValue(state, key) {
  if (key === "VRAM") {
    const used = state.vram?.used_mb || 0;
    const total = state.vram?.total_mb || 0;
    const percent = Number.isFinite(Number(state.vram?.percent))
      ? Number(state.vram.percent)
      : total
        ? (used / total) * 100
        : 0;
    return total ? `${used} / ${total} MB (${Math.round(percent)}%)` : "0 / 0 MB";
  }
  if (key === "RAM") {
    const used = state.ram?.used_mb || 0;
    const total = state.ram?.total_mb || 0;
    const percent = Number.isFinite(Number(state.ram?.percent))
      ? Number(state.ram.percent)
      : total
        ? (used / total) * 100
        : 0;
    return total
      ? `${(used / 1024).toFixed(2)} / ${(total / 1024).toFixed(2)} GB (${Math.round(percent)}%)`
      : state.info?.RAM || "Unknown";
  }
  return state.info?.[key];
}

function displayLabel(state, key) {
  if (key !== "RAM") return key;
  const source = String(state.ram?.source || "");
  if (source.startsWith("cgroup-")) return "RAM (Container)";
  if (source === "psutil-system") return "RAM (System)";
  return "RAM";
}

function metricTitle(state, key, value) {
  if (key === "RAM") {
    const source = state.ram?.source || "unknown";
    const raw = Number(state.ram?.raw_used_mb || 0) / 1024;
    const inactive = Number(state.ram?.inactive_file_mb || 0) / 1024;
    const details = [`${value}`, `Source: ${source}`];
    if (source.startsWith("cgroup-")) {
      details.push(`Raw usage: ${raw.toFixed(2)} GB`);
      details.push(`Inactive file cache: ${inactive.toFixed(2)} GB`);
    }
    return details.join("\n");
  }
  if (key === "VRAM") {
    const source = state.vram?.source || "unknown";
    const name = state.vram?.name || "Unknown GPU";
    return `${value}\n${name}\nSource: ${source}`;
  }
  return String(value);
}

function createButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = "border:1px solid #334155;border-radius:6px;padding:7px 8px;background:#020617;color:#fff;cursor:pointer;font-size:12px";
  button.addEventListener("click", action);
  return button;
}

function createPanel(node) {
  const root = document.createElement("div");
  root.className = "inteliweb-system-check";
  root.style.cssText = "box-sizing:border-box;width:100%;height:100%;padding:8px;overflow:auto;background:#0f172a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px";
  const results = document.createElement("div");
  results.textContent = "Press Run to collect system information.";
  results.style.cssText = "font-size:12px;color:#cbd5e1";
  root.append(toolbar, results);

  const state = {
    info: null,
    vram: { used_mb: 0, free_mb: 0, total_mb: 0, percent: 0, source: "unavailable", name: "Unknown GPU" },
    ram: { used_mb: 0, free_mb: 0, total_mb: 0, percent: 0, raw_used_mb: 0, inactive_file_mb: 0, source: "unavailable" },
    openCategories: Object.fromEntries(
      Object.keys(CATEGORIES).map((category) => [
        category,
        category === "System" || category === "GPU & Runtime" || category === "Acceleration & Attention",
      ]),
    ),
  };

  const render = () => {
    if (!state.info) return;
    results.replaceChildren();

    for (const [category, keys] of Object.entries(CATEGORIES)) {
      const details = document.createElement("details");
      details.open = Boolean(state.openCategories[category]);
      details.style.cssText = "margin-bottom:7px";
      details.addEventListener("toggle", () => {
        state.openCategories[category] = details.open;
      });

      const summary = document.createElement("summary");
      summary.textContent = category;
      summary.style.cssText = "cursor:pointer;padding:6px 8px;border-radius:6px;background:#020617;font-weight:600;font-size:12px";
      details.appendChild(summary);

      const cards = document.createElement("div");
      cards.style.cssText = "display:grid;gap:7px;margin-top:7px";

      for (const key of keys) {
        const value = formatValue(state, key);
        if (value === undefined) continue;
        const missing = isMissing(value);

        const card = document.createElement("div");
        card.style.cssText = `display:grid;grid-template-columns:34px minmax(120px,1fr) minmax(120px,2fr);align-items:center;min-height:30px;border-radius:7px;background:${missing ? "#ef4444" : "#4a90e2"};overflow:hidden;font-size:12px`;

        const icon = document.createElement("div");
        icon.textContent = ICONS[key] || "ℹ️";
        icon.style.cssText = `display:grid;place-items:center;height:100%;background:${missing ? "#c81e1e" : "#2b73bf"}`;

        const label = document.createElement("strong");
        label.textContent = displayLabel(state, key);
        label.style.cssText = "padding:0 10px;white-space:nowrap";

        const valueElement = document.createElement("span");
        valueElement.textContent = String(value);
        valueElement.title = metricTitle(state, key, value);
        valueElement.style.cssText = "padding:0 10px;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

        card.append(icon, label, valueElement);
        cards.appendChild(card);
      }

      details.appendChild(cards);
      results.appendChild(details);
    }
  };

  const refreshTelemetry = async () => {
    try {
      const telemetry = await fetchJSON("/inteliweb/telemetry");
      if (telemetry?.vram) state.vram = telemetry.vram;
      if (telemetry?.ram) state.ram = telemetry.ram;
      render();
    } catch (_) {
      // Ignore temporary server disconnects.
    }
  };

  let runButton;
  let freeButton;
  let copyButton;

  const run = async () => {
    runButton.disabled = true;
    runButton.textContent = "Running...";
    try {
      state.info = await fetchJSON("/inteliweb_sysinfo");
      node._inteliweb_text = Object.entries(state.info).map(([key, value]) => `${key}: ${value}`).join("\n");
      await refreshTelemetry();
    } catch (error) {
      console.error("[Inteliweb] System Check failed:", error);
      results.textContent = `System Check failed: ${error.message}`;
    } finally {
      runButton.disabled = false;
      runButton.textContent = "Run";
    }
  };

  const freeMemory = async () => {
    freeButton.disabled = true;
    freeButton.textContent = "Freeing...";
    try {
      const response = await fetchJSON("/inteliweb/free_memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response?.ok) throw new Error(response?.text || "Memory cleanup failed");
      if (response.vram) state.vram = response.vram;
      if (response.ram) state.ram = response.ram;
      render();
    } catch (error) {
      console.error("[Inteliweb] Free Memory failed:", error);
    } finally {
      freeButton.disabled = false;
      freeButton.textContent = "Free Memory";
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node._inteliweb_text || "");
      copyButton.textContent = "Copied";
      setTimeout(() => (copyButton.textContent = "Copy"), 900);
    } catch (error) {
      console.warn("[Inteliweb] Clipboard unavailable:", error);
    }
  };

  runButton = createButton("Run", run);
  freeButton = createButton("Free Memory", freeMemory);
  copyButton = createButton("Copy", copy);
  toolbar.append(runButton, freeButton, copyButton);

  const timer = setInterval(refreshTelemetry, 1000);
  node.__inteliweb_stop = () => clearInterval(timer);
  return root;
}

app.registerExtension({
  name: "inteliweb.system.check",
  nodeCreated(node) {
    if (node.comfyClass !== "InteliwebSystemCheck") return;
    node.color = "#1f2430";
    node.bgcolor = "#0f172a";
    node.size = [560, 520];
    node._inteliweb_text = "";

    const panel = createPanel(node);
    const widget = node.addDOMWidget("inteliweb_system_check", "INTELIWEB_SYSTEM_CHECK", panel, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => 360,
      getHeight: () => Math.max(360, node.size?.[1] - 40),
    });
    widget.serialize = false;
    widget.serializeValue = () => undefined;

    const originalRemoved = node.onRemoved;
    node.onRemoved = function () {
      node.__inteliweb_stop?.();
      if (originalRemoved) originalRemoved.apply(this, arguments);
    };
  },
});
