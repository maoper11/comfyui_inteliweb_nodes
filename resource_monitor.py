# custom_nodes/comfyui_inteliweb_nodes/resource_monitor.py
"""Lightweight hardware telemetry endpoint for the Inteliweb top-bar monitor.

The implementation is independent from System Check and does not start a
background thread. The browser requests a snapshot at the configured interval.

The compact top-bar monitor is inspired by ComfyUI-Crystools by Crystian
(MIT License). This implementation uses its own endpoint and frontend code.
See THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import csv
import io
import logging
import os
import shutil
import subprocess
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

        try:
            pynvml.nvmlInit()
        except Exception:
            # It may already be initialized by another package.
            pass

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
                    "vram_percent": float(memory.used / memory.total * 100)
                    if memory.total
                    else -1,
                    "vram_used_mb": int(memory.used // MIB),
                    "vram_total_mb": int(memory.total // MIB),
                    "temperature_c": float(temperature),
                    "source": "pynvml",
                }
            )
        return gpus
    except Exception:
        return []


def _gpu_from_nvidia_smi() -> list[dict[str, Any]]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []

    fields = (
        "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu"
    )
    try:
        completed = subprocess.run(
            [
                executable,
                f"--query-gpu={fields}",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        rows = csv.reader(io.StringIO(completed.stdout))
        gpus = []
        for row in rows:
            if len(row) < 6:
                continue
            index = int(row[0].strip())
            used = int(float(row[3].strip()))
            total = int(float(row[4].strip()))
            gpus.append(
                {
                    "index": index,
                    "name": row[1].strip(),
                    "gpu_percent": float(row[2].strip()),
                    "vram_percent": float(used / total * 100) if total else -1,
                    "vram_used_mb": used,
                    "vram_total_mb": total,
                    "temperature_c": float(row[5].strip()),
                    "source": "nvidia-smi",
                }
            )
        return gpus
    except Exception as exc:
        LOGGER.debug("nvidia-smi telemetry unavailable: %s", exc)
        return []


def _gpu_from_torch() -> list[dict[str, Any]]:
    """Fallback that reports VRAM but not utilization or temperature."""
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
    except Exception:
        return []


def collect_resource_status() -> dict[str, Any]:
    status = _cpu_ram_disk()
    gpus = _gpu_from_pynvml()
    if not gpus:
        gpus = _gpu_from_nvidia_smi()
    if not gpus:
        gpus = _gpu_from_torch()
    status["gpus"] = gpus
    return status


try:
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/inteliweb/resource_monitor")
    async def inteliweb_resource_monitor(request):
        return web.json_response(collect_resource_status())
except Exception as exc:
    LOGGER.debug("Resource monitor route was not registered: %s", exc)
