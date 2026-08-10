import { app } from "../../scripts/app.js";

const MONITOR_ID = "inteliweb-resource-monitor";
const STYLE_ID = "inteliweb-resource-monitor-style";
const STORAGE_PREFIX = "inteliweb.resourceMonitor.";
const MASTER_SETTING_ID = "Inteliweb.ResourceMonitor.enabled";

let masterEnabled = true;
let extensionReady = false;
let mountObserver = null;
let mountRetryTimer = null;

const defaults = {
  enabled: true,
  interval: 1,
  showDisk: true,
  showCPU: true,
  showRAM: true,
  showGPU: true,
  showVRAM: true,
  showTemp: true,
};

function readSetting(key) {
  const raw = localStorage.getItem(STORAGE_PREFIX + key);
  if (raw === null) return defaults[key];
  if (typeof defaults[key] === "boolean") return raw === "true";
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaults[key];
}

function writeSetting(key, value) {
  localStorage.setItem(STORAGE_PREFIX + key, String(value));
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${MONITOR_ID} {
      display: inline-flex;
      align-items: stretch;
      height: 34px;
      padding: 0;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 6px;
      background: rgba(19, 23, 30, .95);
      box-shadow: 0 2px 8px rgba(0,0,0,.28);
      font: 11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      color: #e5e7eb;
      user-select: none;
      flex: 0 0 auto;
    }
    #${MONITOR_ID} .iw-resource {
      position: relative;
      display: flex;
      min-width: 48px;
      padding: 0 7px;
      align-items: center;
      justify-content: center;
      gap: 4px;
      border-left: 1px solid rgba(255,255,255,.08);
      overflow: hidden;
      cursor: default;
      box-sizing: border-box;
    }
    #${MONITOR_ID} .iw-resource:first-child { border-left: 0; }
    #${MONITOR_ID} .iw-resource::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 5px;
      border-radius: 3px 3px 0 0;
      transform-origin: left center;
      transform: scaleX(var(--iw-progress, 0));
      background: var(--iw-color, #3b82f6);
      box-shadow: 0 -1px 2px color-mix(in srgb, var(--iw-color, #3b82f6) 20%, transparent);
      transition: transform .35s ease;
    }
    #${MONITOR_ID} .iw-label { opacity: .62; font-size: 9px; }
    #${MONITOR_ID} .iw-value { font-variant-numeric: tabular-nums; font-weight: 650; }
    #${MONITOR_ID} .iw-settings,
    #${MONITOR_ID} .iw-restore {
      min-width: 30px;
      border: 0;
      border-left: 1px solid rgba(255,255,255,.08);
      background: transparent;
      color: #d1d5db;
      cursor: pointer;
      font-size: 14px;
      align-items: center;
      justify-content: center;
    }
    #${MONITOR_ID} .iw-settings { display: flex; }
    #${MONITOR_ID} .iw-restore {
      display: none;
      width: 38px;
      border-left: 0;
      font-size: 17px;
    }
    #${MONITOR_ID} .iw-settings:hover,
    #${MONITOR_ID} .iw-restore:hover { background: rgba(255,255,255,.08); }
    #${MONITOR_ID}[data-disabled="true"] .iw-resource,
    #${MONITOR_ID}[data-disabled="true"] .iw-settings { display: none !important; }
    #${MONITOR_ID}[data-disabled="true"] .iw-restore { display: flex; }
    .iw-resource-popover {
      position: fixed;
      z-index: 100000;
      width: 230px;
      padding: 10px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 8px;
      background: #151922;
      color: #e5e7eb;
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
      font: 12px ui-sans-serif, system-ui, sans-serif;
    }
    .iw-resource-popover label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 2px;
      gap: 10px;
    }
    .iw-resource-popover .iw-toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      min-height: 26px;
      padding: 3px 2px;
      gap: 12px;
    }
    .iw-resource-popover .iw-switch {
      position: relative;
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: flex-start;
      gap: 0;
      padding: 0;
      cursor: pointer;
    }
    .iw-resource-popover .iw-switch input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    .iw-resource-popover .iw-switch-track {
      position: relative;
      width: 32px;
      height: 18px;
      border: 1px solid #626875;
      border-radius: 999px;
      background: #383d48;
      box-sizing: border-box;
      transition: background .12s ease, border-color .12s ease;
    }
    .iw-resource-popover .iw-switch-track::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #b8bec9;
      transition: transform .12s ease, background .12s ease;
    }
    .iw-resource-popover .iw-switch input:checked + .iw-switch-track {
      border-color: #168bd2;
      background: #168bd2;
    }
    .iw-resource-popover .iw-switch input:checked + .iw-switch-track::after {
      transform: translateX(14px);
      background: #fff;
    }
    .iw-resource-popover .iw-switch input:focus-visible + .iw-switch-track {
      outline: 2px solid rgba(56, 189, 248, .7);
      outline-offset: 2px;
    }
    .iw-resource-popover select {
      min-width: 85px;
      background: #252a35;
      color: #fff;
      border: 1px solid rgba(255,255,255,.15);
      border-radius: 4px;
      padding: 3px;
    }
    @media (max-width: 1200px) {
      #${MONITOR_ID} .iw-label { display: none; }
      #${MONITOR_ID} .iw-resource { min-width: 38px; padding: 0 5px; }
    }
  `;
  document.head.appendChild(style);
}

function percent(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.max(0, Math.min(100, value));
}

function makeMetric(key, label, color) {
  const el = document.createElement("div");
  el.className = "iw-resource";
  el.dataset.metric = key;
  el.style.setProperty("--iw-color", color);
  el.innerHTML = `<span class="iw-label">${label}</span><span class="iw-value">--</span>`;
  return el;
}

function updateMetric(root, key, value, progress, title) {
  const el = root.querySelector(`[data-metric="${key}"]`);
  if (!el) return;
  const valueElement = el.querySelector(".iw-value");
  if (valueElement) valueElement.textContent = value;
  el.style.setProperty("--iw-progress", String(percent(progress) / 100));
  el.title = title || "";
}

function applyVisibility(root) {
  const mapping = {
    disk: "showDisk",
    cpu: "showCPU",
    ram: "showRAM",
    gpu: "showGPU",
    vram: "showVRAM",
    temp: "showTemp",
  };
  for (const [metric, setting] of Object.entries(mapping)) {
    const el = root.querySelector(`[data-metric="${metric}"]`);
    if (el) el.style.display = readSetting(setting) ? "flex" : "none";
  }
  root.dataset.disabled = String(!readSetting("enabled"));
}

function makeSwitch(checked, label) {
  const control = document.createElement("label");
  control.className = "iw-switch";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-label", label);

  const track = document.createElement("span");
  track.className = "iw-switch-track";
  control.append(input, track);
  return { control, input };
}

function closeOpenPopovers() {
  document.querySelectorAll(".iw-resource-popover").forEach((element) => {
    if (typeof element.__inteliwebClose === "function") {
      element.__inteliwebClose();
    } else {
      element.remove();
    }
  });
}

function createPopover(button, root, restart) {
  closeOpenPopovers();

  const popover = document.createElement("div");
  popover.className = "iw-resource-popover";
  let closed = false;

  const closePopover = () => {
    if (closed) return;
    closed = true;
    popover.remove();
    window.removeEventListener("pointerdown", closeIfOutside, true);
    window.removeEventListener("mousedown", closeIfOutside, true);
    window.removeEventListener("blur", closePopover);
    document.removeEventListener("keydown", closeOnEscape, true);
  };

  const closeIfOutside = (event) => {
    const target = event.target;
    if (!popover.contains(target) && !button.contains(target)) closePopover();
  };

  const closeOnEscape = (event) => {
    if (event.key === "Escape") closePopover();
  };
  popover.__inteliwebClose = closePopover;

  const toggles = [
    ["enabled", "Show monitor"],
    ["showDisk", "Disk"],
    ["showCPU", "CPU"],
    ["showRAM", "RAM"],
    ["showGPU", "GPU utilization"],
    ["showVRAM", "VRAM"],
    ["showTemp", "GPU temperature"],
  ];

  for (const [key, label] of toggles) {
    const row = document.createElement("div");
    row.className = "iw-toggle-row";
    const text = document.createElement("span");
    text.textContent = label;
    const toggle = makeSwitch(readSetting(key), label);
    toggle.input.addEventListener("change", () => {
      writeSetting(key, toggle.input.checked);
      applyVisibility(root);
      if (key === "enabled") {
        if (toggle.input.checked) root.__inteliwebRestart?.();
        else root.__inteliwebStop?.();
      }
      if (key === "enabled" && !toggle.input.checked) closePopover();
    });
    row.append(text, toggle.control);
    popover.appendChild(row);
  }

  const rateRow = document.createElement("label");
  rateRow.append("Refresh interval");
  const select = document.createElement("select");
  for (const value of [0.5, 1, 2, 5]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} s`;
    option.selected = readSetting("interval") === value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => {
    writeSetting("interval", Number(select.value));
    restart();
  });
  rateRow.appendChild(select);
  popover.appendChild(rateRow);

  document.body.appendChild(popover);
  const rect = button.getBoundingClientRect();
  popover.style.top = `${Math.min(window.innerHeight - popover.offsetHeight - 8, rect.bottom + 6)}px`;
  popover.style.left = `${Math.max(8, rect.right - popover.offsetWidth)}px`;

  setTimeout(() => {
    if (closed) return;
    window.addEventListener("pointerdown", closeIfOutside, true);
    window.addEventListener("mousedown", closeIfOutside, true);
    window.addEventListener("blur", closePopover);
    document.addEventListener("keydown", closeOnEscape, true);
  }, 0);
}

function createMonitor() {
  if (!masterEnabled) return null;
  const existing = document.getElementById(MONITOR_ID);
  if (existing) return existing;

  const root = document.createElement("div");
  root.id = MONITOR_ID;
  root.className = "comfyui-button-group";
  root.append(
    makeMetric("disk", "DISK", "#64748b"),
    makeMetric("cpu", "CPU", "#22c55e"),
    makeMetric("ram", "RAM", "#16a34a"),
    makeMetric("gpu", "GPU", "#3b82f6"),
    makeMetric("vram", "VRAM", "#2563eb"),
    makeMetric("temp", "TEMP", "#f59e0b"),
  );

  const restore = document.createElement("button");
  restore.className = "iw-restore";
  restore.type = "button";
  restore.textContent = "▥";
  restore.title = "Show Inteliweb Resource Monitor";
  restore.addEventListener("click", () => {
    writeSetting("enabled", true);
    applyVisibility(root);
    root.__inteliwebRestart?.();
  });
  root.appendChild(restore);

  const settings = document.createElement("button");
  settings.className = "iw-settings";
  settings.type = "button";
  settings.textContent = "⋮";
  settings.title = "Inteliweb Resource Monitor settings";
  root.appendChild(settings);

  let timer = null;
  let activeRequest = null;
  const poll = async () => {
    if (!masterEnabled || !readSetting("enabled") || activeRequest) return;
    const controller = new AbortController();
    activeRequest = controller;
    try {
      const response = await fetch("/inteliweb/resource_monitor", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const gpu =
        Array.isArray(data.gpus) && data.gpus.length ? data.gpus[0] : null;

      updateMetric(
        root,
        "disk",
        `${Math.round(data.disk_percent)}%`,
        data.disk_percent,
        `Disk ${data.disk_path || ""}: ${(data.disk_used_mb / 1024).toFixed(1)} / ${(data.disk_total_mb / 1024).toFixed(1)} GB`,
      );
      updateMetric(
        root,
        "cpu",
        `${Math.round(data.cpu_percent)}%`,
        data.cpu_percent,
        "CPU utilization",
      );
      updateMetric(
        root,
        "ram",
        `${Math.round(data.ram_percent)}%`,
        data.ram_percent,
        `RAM: ${(data.ram_used_mb / 1024).toFixed(1)} / ${(data.ram_total_mb / 1024).toFixed(1)} GB`,
      );

      if (gpu) {
        updateMetric(
          root,
          "gpu",
          gpu.gpu_percent >= 0 ? `${Math.round(gpu.gpu_percent)}%` : "--",
          gpu.gpu_percent,
          `${gpu.index}: ${gpu.name} (${gpu.source})`,
        );
        updateMetric(
          root,
          "vram",
          `${Math.round(gpu.vram_percent)}%`,
          gpu.vram_percent,
          `VRAM: ${gpu.vram_used_mb} / ${gpu.vram_total_mb} MB`,
        );
        updateMetric(
          root,
          "temp",
          gpu.temperature_c >= 0 ? `${Math.round(gpu.temperature_c)}°` : "--",
          gpu.temperature_c >= 0 ? gpu.temperature_c : 0,
          `${gpu.name} temperature`,
        );
      } else {
        updateMetric(root, "gpu", "--", 0, "GPU telemetry unavailable");
        updateMetric(root, "vram", "--", 0, "VRAM telemetry unavailable");
        updateMetric(
          root,
          "temp",
          "--",
          0,
          "Temperature telemetry unavailable",
        );
      }
      root.title = "";
    } catch (error) {
      if (error?.name === "AbortError") return;
      root.title = `Inteliweb Resource Monitor: ${error.message}`;
      console.warn("[Inteliweb] Resource Monitor polling failed:", error);
    } finally {
      if (activeRequest === controller) activeRequest = null;
    }
  };

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    activeRequest?.abort();
    activeRequest = null;
  };

  const restart = () => {
    stop();
    if (!masterEnabled || !readSetting("enabled")) return;
    poll();
    timer = setInterval(poll, Math.max(0.5, readSetting("interval")) * 1000);
  };

  settings.addEventListener("click", () =>
    createPopover(settings, root, restart),
  );
  root.__inteliwebStop = stop;
  root.__inteliwebRestart = restart;
  applyVisibility(root);
  restart();
  return root;
}

function findToolbarAnchor() {
  const settingsGroup = app?.menu?.settingsGroup?.element;
  if (settingsGroup?.parentElement) {
    return { parent: settingsGroup.parentElement, before: settingsGroup };
  }

  const managerControl = [
    ...document.querySelectorAll("button, [role='button']"),
  ].find((element) => /manager/i.test((element.textContent || "").trim()));
  const managerGroup = managerControl?.closest?.(".comfyui-button-group");
  if (managerGroup?.parentElement) {
    return { parent: managerGroup.parentElement, before: managerGroup };
  }

  const candidates = [
    ".comfyui-menu-right",
    ".comfy-menu-right",
    "#comfy-menu-secondary",
    "header .flex.items-center",
  ];
  for (const selector of candidates) {
    const parent = document.querySelector(selector);
    if (parent) return { parent, before: parent.firstChild };
  }
  return null;
}

function mountMonitor() {
  if (!masterEnabled) return false;
  ensureStyles();
  const anchor = findToolbarAnchor();
  if (!anchor) return false;
  const monitor = createMonitor();
  if (!monitor) return false;
  if (
    monitor.parentElement !== anchor.parent ||
    monitor.nextSibling !== anchor.before
  ) {
    anchor.parent.insertBefore(monitor, anchor.before);
  }
  return true;
}

function stopMounting() {
  mountObserver?.disconnect();
  mountObserver = null;
  if (mountRetryTimer !== null) clearInterval(mountRetryTimer);
  mountRetryTimer = null;
}

function removeMonitor() {
  stopMounting();
  closeOpenPopovers();
  const monitor = document.getElementById(MONITOR_ID);
  monitor?.__inteliwebStop?.();
  monitor?.remove();
}

function startMounting() {
  if (!masterEnabled || mountObserver || mountRetryTimer !== null) return;
  let attempts = 0;
  const tryMount = () => {
    if (!masterEnabled) return false;
    attempts += 1;
    if (mountMonitor()) {
      stopMounting();
      console.info(
        "[Inteliweb] Resource Monitor mounted in the ComfyUI top bar.",
      );
      return true;
    }
    return false;
  };

  if (tryMount()) return;

  mountObserver = new MutationObserver(() => {
    tryMount();
  });
  mountObserver.observe(document.body, { childList: true, subtree: true });

  mountRetryTimer = setInterval(() => {
    if (tryMount() || attempts >= 60) {
      stopMounting();
      if (!document.getElementById(MONITOR_ID)) {
        console.warn(
          "[Inteliweb] Resource Monitor could not find a top-bar anchor.",
        );
      }
    }
  }, 500);
}

function applyMasterSetting(value) {
  masterEnabled = value !== false;
  if (!extensionReady) return;
  if (masterEnabled) startMounting();
  else removeMonitor();
}

app.registerExtension({
  name: "inteliweb.resource.monitor",
  settings: [
    {
      id: MASTER_SETTING_ID,
      name: "Enable Resource Monitor",
      type: "boolean",
      defaultValue: true,
      tooltip: "Show the Inteliweb Resource Monitor in the top bar and collect its metrics.",
      category: ["Inteliweb", "Resource Monitor", "Enable Resource Monitor"],
      onChange: (value) => applyMasterSetting(value),
    },
  ],
  setup() {
    const savedValue = app.extensionManager?.setting?.get?.(MASTER_SETTING_ID)
      ?? app.ui?.settings?.getSettingValue?.(MASTER_SETTING_ID);
    if (savedValue !== undefined) masterEnabled = savedValue !== false;
    extensionReady = true;
    applyMasterSetting(masterEnabled);
  },
});
