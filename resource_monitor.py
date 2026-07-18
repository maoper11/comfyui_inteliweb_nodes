# custom_nodes/comfyui_inteliweb_nodes/resource_monitor.py
"""Lightweight hardware telemetry endpoint for the Inteliweb top-bar monitor.

This scanner-friendly implementation uses Python APIs only. It never starts a
shell or external process. NVIDIA telemetry is read with NVML through pynvml;
PyTorch is used as a portable fallback for VRAM information.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

LOGGER = logging.getLogger(__name__)
MIB = 1024 * 1024
NVML_SAMPLE_WINDOW_US = 2_000_000
_NVML_LAST_SAMPLE_US: dict[int, int] = {}


def _cpu_ram_disk() -> dict[str, Any]:
    try:
        import psutil

        ram = psutil.virtual_memory()
        disk_path = os.path.abspath(os.sep)
        try:
            import folder_paths

            disk_path = os.path.abspath(folder_paths.base_path)
        except Exception:
            pass

        disk = psutil.disk_usage(disk_path)
        return {
            "cpu_percent": float(psutil.cpu_percent(interval=None)),
            "ram_percent": float(ram.percent),
            "ram_used_mb": int(ram.used // MIB),
            "ram_total_mb": int(ram.total // MIB),
            "disk_percent": float(disk.percent),
            "disk_used_mb": int(disk.used // MIB),
            "disk_total_mb": int(disk.total // MIB),
            "disk_path": disk_path,
        }
    except Exception as exc:
        LOGGER.debug("CPU/RAM/disk telemetry unavailable: %s", exc)
        return {
            "cpu_percent": -1,
            "ram_percent": -1,
            "ram_used_mb": -1,
            "ram_total_mb": -1,
            "disk_percent": -1,
            "disk_used_mb": -1,
            "disk_total_mb": -1,
            "disk_path": "",
        }


def _nvml_sample_value(pynvml: Any, sample: Any, value_type: int) -> float:
    """Convert an NVML sample union to a Python number."""
    value = sample.sampleValue
    mapping = {
        pynvml.NVML_VALUE_TYPE_DOUBLE: "dVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_INT: "uiVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_LONG: "ulVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_LONG_LONG: "ullVal",
        pynvml.NVML_VALUE_TYPE_SIGNED_LONG_LONG: "sllVal",
        pynvml.NVML_VALUE_TYPE_SIGNED_INT: "siVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_SHORT: "usVal",
    }
    attribute = mapping.get(value_type)
    if attribute is None:
        raise ValueError(f"Unsupported NVML value type: {value_type}")
    return float(getattr(value, attribute))


def _nvml_gpu_percent(pynvml: Any, handle: Any, index: int) -> tuple[float, str]:
    """Read GPU utilization using recent NVML samples when supported."""
    instant = -1.0
    try:
        instant = float(pynvml.nvmlDeviceGetUtilizationRates(handle).gpu)
    except Exception as exc:
        LOGGER.debug("NVML instant utilization unavailable for GPU %s: %s", index, exc)

    try:
        now_us = time.time_ns() // 1_000
        last_seen_us = _NVML_LAST_SAMPLE_US.get(index, now_us - NVML_SAMPLE_WINDOW_US)
        value_type, samples = pynvml.nvmlDeviceGetSamples(
            handle,
            pynvml.NVML_GPU_UTILIZATION_SAMPLES,
            last_seen_us,
        )

        values = []
        newest_us = last_seen_us
        for sample in samples:
            newest_us = max(newest_us, int(sample.timeStamp))
            value = _nvml_sample_value(pynvml, sample, value_type)
            if 0 <= value <= 100:
                values.append(value)

        if newest_us > last_seen_us:
            _NVML_LAST_SAMPLE_US[index] = newest_us

        if values:
            average = sum(values) / len(values)
            return max(instant, average), "pynvml-samples"
    except Exception as exc:
        LOGGER.debug("NVML sampled utilization unavailable for GPU %s: %s", index, exc)

    return instant, "pynvml"


def _gpu_from_pynvml() -> list[dict[str, Any]]:
    try:
        import pynvml

        pynvml.nvmlInit()
        gpus = []
        for index in range(pynvml.nvmlDeviceGetCount()):
            handle = pynvml.nvmlDeviceGetHandleByIndex(index)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")

            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            gpu_percent, source = _nvml_gpu_percent(pynvml, handle, index)
            try:
                temperature = pynvml.nvmlDeviceGetTemperature(
                    handle, pynvml.NVML_TEMPERATURE_GPU
                )
            except Exception:
                temperature = -1

            gpus.append(
                {
                    "index": index,
                    "name": str(name),
                    "gpu_percent": gpu_percent,
                    "vram_percent": (
                        float(memory.used / memory.total * 100)
                        if memory.total
                        else -1
                    ),
                    "vram_used_mb": int(memory.used // MIB),
                    "vram_total_mb": int(memory.total // MIB),
                    "temperature_c": float(temperature),
                    "source": source,
                }
            )
        return gpus
    except Exception as exc:
        LOGGER.debug("pynvml telemetry unavailable: %s", exc)
        return []


def _gpu_from_torch() -> list[dict[str, Any]]:
    """Fallback that reports accelerator VRAM but not load or temperature."""
    try:
        import torch

        if not torch.cuda.is_available():
            return []

        gpus = []
        for index in range(torch.cuda.device_count()):
            free, total = torch.cuda.mem_get_info(index)
            used = total - free
            gpus.append(
                {
                    "index": index,
                    "name": torch.cuda.get_device_name(index),
                    "gpu_percent": -1,
                    "vram_percent": float(used / total * 100) if total else -1,
                    "vram_used_mb": int(used // MIB),
                    "vram_total_mb": int(total // MIB),
                    "temperature_c": -1,
                    "source": "torch",
                }
            )
        return gpus
    except Exception as exc:
        LOGGER.debug("PyTorch GPU telemetry unavailable: %s", exc)
        return []


def collect_resource_status() -> dict[str, Any]:
    status = _cpu_ram_disk()
    gpus = _gpu_from_pynvml()
    if not gpus:
        gpus = _gpu_from_torch()
    status["gpus"] = gpus
    status["gpu_available"] = bool(gpus)
    return status


try:
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/inteliweb/resource_monitor")
    async def inteliweb_resource_monitor(request):
        return web.json_response(collect_resource_status())
except Exception as exc:
    LOGGER.debug("Resource monitor route was not registered: %s", exc)
