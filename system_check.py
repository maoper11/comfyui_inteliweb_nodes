# custom_nodes/comfyui_inteliweb_nodes/system_check.py
"""System diagnostics for ComfyUI using scanner-friendly Python APIs."""

from __future__ import annotations

import platform
import sys
from importlib import metadata
from typing import Any

from .purge_vram import run_memory_cleanup
from .resource_monitor import collect_resource_status

MIB = 1024 * 1024


def _distribution_version(*names: str) -> str:
    """Return the first installed distribution version without importing code."""
    for name in names:
        try:
            return metadata.version(name)
        except metadata.PackageNotFoundError:
            continue
        except Exception:
            continue
    return "Not installed"


def _accelerator_runtime(torch) -> str:
    """Describe the runtime reported by PyTorch without invoking external tools."""
    cuda_version = getattr(torch.version, "cuda", None)
    if cuda_version:
        return f"CUDA {cuda_version}"

    hip_version = getattr(torch.version, "hip", None)
    if hip_version:
        return f"ROCm / HIP {hip_version}"

    return "CPU / unavailable"


def _resource_status() -> dict[str, Any]:
    """Return one shared Resource Monitor snapshot for RAM and VRAM."""
    try:
        return collect_resource_status()
    except Exception:
        return {}


def _ram_info(status: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the same RAM values and source used by Resource Monitor."""
    status = status if status is not None else _resource_status()
    try:
        used_mb = max(int(status.get("ram_used_mb", 0)), 0)
        total_mb = max(int(status.get("ram_total_mb", 0)), 0)
        raw_used_mb = max(int(status.get("ram_raw_used_mb", used_mb)), 0)
        inactive_file_mb = max(
            int(status.get("ram_inactive_file_mb", max(raw_used_mb - used_mb, 0))),
            0,
        )
        percent = float(status.get("ram_percent", 0.0))
        source = str(status.get("ram_source", "unavailable"))
        return {
            "used_mb": used_mb,
            "free_mb": max(total_mb - used_mb, 0),
            "total_mb": total_mb,
            "percent": max(0.0, min(100.0, percent)),
            "raw_used_mb": raw_used_mb,
            "inactive_file_mb": inactive_file_mb,
            "source": source,
        }
    except Exception:
        return {
            "used_mb": 0,
            "free_mb": 0,
            "total_mb": 0,
            "percent": 0.0,
            "raw_used_mb": 0,
            "inactive_file_mb": 0,
            "source": "unavailable",
        }


def _vram_info(status: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the same primary-GPU VRAM values used by Resource Monitor."""
    status = status if status is not None else _resource_status()
    try:
        gpus = status.get("gpus") or []
        if gpus:
            gpu = gpus[0]
            used_mb = max(int(gpu.get("vram_used_mb", 0)), 0)
            total_mb = max(int(gpu.get("vram_total_mb", 0)), 0)
            percent = float(gpu.get("vram_percent", 0.0))
            return {
                "used_mb": used_mb,
                "free_mb": max(total_mb - used_mb, 0),
                "total_mb": total_mb,
                "percent": max(0.0, min(100.0, percent)),
                "source": str(gpu.get("source", "unknown")),
                "name": str(gpu.get("name", "Unknown GPU")),
            }
    except Exception:
        pass
    return {
        "used_mb": 0,
        "free_mb": 0,
        "total_mb": 0,
        "percent": 0.0,
        "source": "unavailable",
        "name": "Unknown GPU",
    }


def _collect(status: dict[str, Any] | None = None):
    status = status if status is not None else _resource_status()
    ram = _ram_info(status)

    info = {
        "Python version": sys.version.split()[0],
        "Operating System": f"{platform.system()} {platform.release()}",
        "CPU": platform.processor() or platform.machine(),
        "RAM": (
            f"{ram['used_mb'] / 1024:.2f} / {ram['total_mb'] / 1024:.2f} GB "
            f"({ram['percent']:.0f}%)"
            if ram["total_mb"]
            else "Unknown"
        ),
    }

    try:
        import torch

        info["PyTorch"] = torch.__version__
        info["torchvision"] = _distribution_version("torchvision")
        if torch.cuda.is_available():
            try:
                gpu_name = torch.cuda.get_device_name(0)
            except Exception:
                gpu_name = "accelerator:0"
            info["GPU"] = f"Accelerator available: {gpu_name}"
        else:
            info["GPU"] = "CPU only"
        info["Accelerator runtime"] = _accelerator_runtime(torch)
    except Exception:
        info["PyTorch"] = "Not installed"
        info["torchvision"] = _distribution_version("torchvision")
        info["GPU"] = "Unknown"
        info["Accelerator runtime"] = "Unknown"

    packages = {
        "xformers": ("xformers",),
        "triton": ("triton",),
        "SageAttention": ("sageattention", "sage-attention"),
        "FlashAttention": ("flash-attn", "flash_attn", "FlashAttention"),
        "numpy": ("numpy",),
        "Pillow": ("Pillow",),
        "OpenCV": ("opencv-python", "opencv-python-headless"),
        "timm": ("timm",),
        "kornia": ("kornia",),
        "scipy": ("scipy",),
        "scikit-image": ("scikit-image",),
        "AV": ("av",),
        "transformers": ("transformers",),
        "diffusers": ("diffusers",),
        "accelerate": ("accelerate",),
        "bitsandbytes": ("bitsandbytes",),
        "huggingface_hub": ("huggingface-hub",),
        "tokenizers": ("tokenizers",),
        "sentencepiece": ("sentencepiece",),
        "onnx": ("onnx",),
        "onnxruntime": ("onnxruntime", "onnxruntime-gpu"),
    }
    for label, distribution_names in packages.items():
        info[label] = _distribution_version(*distribution_names)

    return info


def _telemetry_payload(status: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build RAM and VRAM telemetry from one shared backend snapshot."""
    status = status if status is not None else _resource_status()
    return {"vram": _vram_info(status), "ram": _ram_info(status)}


try:
    from aiohttp import web
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.get("/inteliweb_sysinfo")
    async def inteliweb_sysinfo(request):
        status = _resource_status()
        return web.json_response(_collect(status))

    @routes.get("/inteliweb/telemetry")
    async def inteliweb_telemetry(request):
        return web.json_response(_telemetry_payload())

    @routes.get("/inteliweb/system_info")
    async def inteliweb_system_info_alias(request):
        status = _resource_status()
        data = _collect(status)
        return web.json_response(
            {
                "text": "\n".join(f"{key}: {value}" for key, value in data.items()),
                **_telemetry_payload(status),
                **data,
            }
        )

    @routes.post("/inteliweb/free_memory")
    async def inteliweb_free_memory(request):
        """Run the same cleanup used by the canvas Free Memory node."""
        try:
            report, metrics = run_memory_cleanup(
                stage_name="System Check Free Memory",
                purge_cache=True,
                purge_models=True,
                gc_collect=True,
                show_report=True,
            )
            status = _resource_status()
            return web.json_response(
                {
                    "ok": True,
                    "text": report,
                    "metrics": metrics,
                    **_telemetry_payload(status),
                }
            )
        except Exception as exc:
            return web.json_response(
                {"ok": False, "text": f"Error freeing memory: {exc}"},
                status=500,
            )
except Exception:
    routes = None


class InteliwebSystemCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = tuple()
    OUTPUT_NODE = True
    CATEGORY = "inteliweb/utils"
    FUNCTION = "noop"

    def noop(self):
        status = _resource_status()
        text = "\n".join(f"{key}: {value}" for key, value in _collect(status).items())
        return {"ui": {"inteliweb_text": text}, "result": ()}
