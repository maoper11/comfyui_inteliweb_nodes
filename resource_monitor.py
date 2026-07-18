# custom_nodes/comfyui_inteliweb_nodes/resource_monitor.py
"""Lightweight hardware telemetry endpoint for the Inteliweb top-bar monitor.

This scanner-friendly implementation uses Python APIs only. It never starts a
shell or external process. NVIDIA telemetry is read with pynvml when available;
PyTorch is used as a portable fallback for VRAM information.
"""

from __future__ import annotations

import logging
import os
from typing import Any

LOGGER = logging.getLogger(__name__)
MIB = 1024 * 1024


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
            utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
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
                    "gpu_percent": float(utilization.gpu),
                    "vram_percent": (
                        float(memory.used / memory.total * 100)
                        if memory.total
                        else -1
                    ),
                    "vram_used_mb": int(memory.used // MIB),
                    "vram_total_mb": int(memory.total // MIB),
                    "temperature_c": float(temperature),
                    "source": "pynvml",
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
