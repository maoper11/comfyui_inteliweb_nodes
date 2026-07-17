import { app } from "../../scripts/app.js";

function parseMemoryPayload(message) {
  const raw = Array.isArray(message?.inteliweb_memory)
    ? message.inteliweb_memory[0]
    : message?.inteliweb_memory;

  if (!raw) return null;
  if (typeof raw === "object") return raw;

  try {
    return JSON.parse(String(raw));
  } catch (error) {
    console.warn("[Inteliweb] Could not parse memory report", error);
    return null;
  }
}

function formatMb(value, signed = false) {
  const number = Number(value) || 0;
  const prefix = signed && number > 0 ? "+" : "";
  return `${prefix}${Math.round(number).toLocaleString()} MB`;
}

function setOutputLabel(node, index, label) {
  if (!Array.isArray(node.outputs) || !node.outputs[index]) return;
  node.outputs[index].label = label;
}

app.registerExtension({
  name: "inteliweb.free.memory",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "InteliwebPurgeVRAM") return;

    const originalOnExecuted = nodeType.prototype.onExecuted;

    nodeType.prototype.onExecuted = function (message) {
      const result = originalOnExecuted
        ? originalOnExecuted.apply(this, arguments)
        : undefined;

      const data = parseMemoryPayload(message);
      if (!data) return result;

      setOutputLabel(this, 1, `VRAM before: ${formatMb(data.vram_before_mb)}`);
      setOutputLabel(this, 2, `VRAM after: ${formatMb(data.vram_after_mb)}`);
      setOutputLabel(
        this,
        3,
        `VRAM freed: ${formatMb(data.vram_freed_mb, true)}`
      );
      setOutputLabel(this, 4, `RAM before: ${formatMb(data.ram_before_mb)}`);
      setOutputLabel(this, 5, `RAM after: ${formatMb(data.ram_after_mb)}`);
      setOutputLabel(
        this,
        6,
        `RAM freed: ${formatMb(data.ram_freed_mb, true)}`
      );

      this.__inteliwebMemoryReport = data.report || "";
      this.setDirtyCanvas?.(true, true);
      return result;
    };
  },
});
