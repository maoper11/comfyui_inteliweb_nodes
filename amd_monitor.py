"""Optional AMD GPU telemetry fallbacks for Resource Monitor (Inteliweb).

This module deliberately wraps the already working resource monitor instead of
changing its NVIDIA path. AMD tools are queried only when the existing monitor
returns no GPU data.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from typing import Any

from . import resource_monitor

LOGGER = logging.getLogger(__name__)
MIB = 1024 * 1024
_ORIGINAL_COLLECT = resource_monitor.collect_resource_status


def _run(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=3,
        check=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return completed.stdout


def _number(value: Any) -> float | None:
    if isinstance(value, dict):
        value = value.get("value")
    if isinstance(value, (int, float)):
        return float(value)
    if value is None:
        return None
    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value).replace(",", ""))
    return float(match.group()) if match else None


def _memory_mb(value: Any, key: str) -> float | None:
    unit = ""
    if isinstance(value, dict):
        unit = str(value.get("unit", ""))
        value = value.get("value")
    number = _number(value)
    if number is None:
        return None
    text = f"{key} {unit} {value}".lower()
    if "byte" in text or key.endswith(("_b", "_bytes")):
        return number / MIB
    if "gib" in text or re.search(r"\bgb\b", text):
        return number * 1024
    if "kib" in text or re.search(r"\bkb\b", text):
        return number / 1024
    return number


def _flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    output: dict[str, Any] = {}
    if isinstance(value, dict):
        if "value" in value and set(value).issubset({"value", "unit"}):
            output[prefix] = value
        else:
            for key, child in value.items():
                normalized = re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")
                output.update(_flatten(child, f"{prefix}_{normalized}".strip("_")))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            output.update(_flatten(child, f"{prefix}_{index}".strip("_")))
    else:
        output[prefix] = value
    return output


def _find(flat: dict[str, Any], *, all_terms=(), any_terms=(), exclude=()):
    for key, value in flat.items():
        if not all(term in key for term in all_terms):
            continue
        if any_terms and not any(term in key for term in any_terms):
            continue
        if any(term in key for term in exclude):
            continue
        return key, value
    return None


def _torch_name(index: int) -> str:
    try:
        import torch
        if torch.cuda.is_available() and index < torch.cuda.device_count():
            return str(torch.cuda.get_device_name(index))
    except Exception:
        pass
    return f"AMD GPU {index}"


def _entry_to_gpu(entry: Any, fallback_index: int, source: str):
    if not isinstance(entry, dict):
        return None
    flat = _flatten(entry)

    index_hit = _find(
        flat,
        any_terms=("gpu", "card", "device"),
        exclude=("use", "util", "temp", "memory", "vram", "clock"),
    )
    index_value = _number(index_hit[1]) if index_hit else None
    index = int(index_value) if index_value is not None else fallback_index

    gpu_hit = _find(
        flat,
        all_terms=("gfx",),
        any_terms=("util", "use", "activity"),
        exclude=("clock",),
    ) or _find(
        flat,
        all_terms=("gpu",),
        any_terms=("util", "use", "activity"),
        exclude=("temp", "memory", "vram", "clock"),
    )

    temp_hit = _find(
        flat,
        any_terms=("gpu_temp", "temperature_edge", "edge_temperature", "hotspot_temperature"),
        exclude=("limit", "shutdown", "slowdown"),
    ) or _find(
        flat,
        any_terms=("temperature", "temp"),
        exclude=("memory", "mem_temp", "vram", "limit", "shutdown", "slowdown"),
    )

    used_hit = _find(flat, all_terms=("vram", "used"), exclude=("percent",))
    total_hit = _find(flat, all_terms=("vram", "total"), exclude=("used", "percent"))
    percent_hit = _find(
        flat,
        all_terms=("vram",),
        any_terms=("percent", "usage_percent", "used_percent"),
    )

    gpu_percent = _number(gpu_hit[1]) if gpu_hit else None
    temperature = _number(temp_hit[1]) if temp_hit else None
    used_mb = _memory_mb(used_hit[1], used_hit[0]) if used_hit else None
    total_mb = _memory_mb(total_hit[1], total_hit[0]) if total_hit else None
    vram_percent = _number(percent_hit[1]) if percent_hit else None
    if vram_percent is None and used_mb is not None and total_mb:
        vram_percent = used_mb / total_mb * 100

    if all(value is None for value in (gpu_percent, temperature, used_mb, total_mb)):
        return None

    return {
        "index": index,
        "name": _torch_name(index),
        "gpu_percent": float(gpu_percent) if gpu_percent is not None else -1,
        "vram_percent": float(vram_percent) if vram_percent is not None else -1,
        "vram_used_mb": int(round(used_mb)) if used_mb is not None else -1,
        "vram_total_mb": int(round(total_mb)) if total_mb is not None else -1,
        "temperature_c": float(temperature) if temperature is not None else -1,
        "source": source,
    }


def _entries(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        entries = [
            value
            for key, value in payload.items()
            if isinstance(value, dict)
            and re.search(r"(?:card|gpu|device)\d*", str(key), re.IGNORECASE)
        ]
        return entries or [payload]
    return []


def _from_command(executable: str, arguments: list[str], source: str):
    try:
        payload = json.loads(_run([executable, *arguments]))
        gpus = []
        for index, entry in enumerate(_entries(payload)):
            gpu = _entry_to_gpu(entry, index, source)
            if gpu is not None:
                gpus.append(gpu)
        return gpus
    except Exception as exc:
        LOGGER.debug("%s telemetry unavailable: %s", source, exc)
        return []


def _amd_gpus():
    executable = shutil.which("amd-smi")
    if executable:
        gpus = _from_command(
            executable,
            ["monitor", "-t", "-u", "-v", "--json"],
            "amd-smi",
        )
        if gpus:
            return gpus

    executable = shutil.which("rocm-smi") or shutil.which("rocm-smi.py")
    if executable:
        return _from_command(
            executable,
            ["--showuse", "--showmeminfo", "vram", "--showtemp", "--json"],
            "rocm-smi",
        )
    return []


def collect_resource_status_with_amd():
    status = _ORIGINAL_COLLECT()
    if status.get("gpus"):
        status["gpu_available"] = True
        return status

    gpus = _amd_gpus()
    status["gpus"] = gpus
    status["gpu_available"] = bool(gpus)
    return status


# The existing route resolves this module global at request time. Replacing the
# function here preserves the proven NVIDIA path and adds AMD only as fallback.
resource_monitor.collect_resource_status = collect_resource_status_with_amd
