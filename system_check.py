# custom_nodes/comfyui_inteliweb_nodes/system_check.py
"""System diagnostics for ComfyUI using scanner-friendly Python APIs."""

from __future__ import annotations

import platform
import sys
from importlib import metadata

from .purge_vram import run_memory_cleanup
from .resource_monitor import collect_resource_status


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


def _collect():
    info = {
        "Python version": sys.version.split()[0],
        "Operating System": f"{platform.system()} {platform.release()}",
        "CPU": platform.processor() or platform.machine(),
    }

    try:
        import psutil

        memory = psutil.virtual_memory()
        info["RAM"] = (
            f"{memory.used / 1024**3:.2f} / {memory.total / 1024**3:.2f} GB "
            f"({memory.percent:.0f}%)"
        )
    except Exception:
        info["RAM"] = "Unknown"

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

    # Version checks use importlib.metadata only. They do not import or execute
    # the optional packages, which keeps diagnostics lightweight and scanner-safe.
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


def _vram_info():
    """Return the same primary-GPU VRAM values used by Resource Monitor."""
    try:
        status = collect_resource_status()
        gpus = status.get("gpus") or []
        if gpus:
            gpu = gpus[0]
            used_mb = max(int(gpu.get("vram_used_mb", 0)), 0)
            total_mb = max(int(gpu.get("vram_total_mb", 0)), 0)
            return {
                "used_mb": used_mb,
                "free_mb": max(total_mb - used_mb, 0),
                "total_mb": total_mb,
                "source": gpu.get("source", "unknown"),
            }
    except Exception:
        pass
    return {"used_mb": 0, "free_mb": 0, "total_mb": 0, "source": "unavailable"}


def _ram_info():
    try:
        import psutil

        memory = psutil.virtual_memory()
        return {
            "used_mb": memory.used // (1024 * 1024),
            "free_mb": memory.available // (1024 * 1024),
            "total_mb": memory.total // (1024 * 1024),
        }
    except Exception:
        return {"used_mb": 0, "free_mb": 0, "total_mb": 0}


try:
    from aiohttp import web
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.get("/inteliweb_sysinfo")
    async def inteliweb_sysinfo(request):
        return web.json_response(_collect())

    @routes.get("/inteliweb/telemetry")
    async def inteliweb_telemetry(request):
        return web.json_response({"vram": _vram_info(), "ram": _ram_info()})

    @routes.get("/inteliweb/system_info")
    async def inteliweb_system_info_alias(request):
        data = _collect()
        return web.json_response(
            {
                "text": "\n".join(f"{key}: {value}" for key, value in data.items()),
                "vram": _vram_info(),
                "ram": _ram_info(),
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
                trim_ram=False,
                show_report=True,
            )
            return web.json_response(
                {
                    "ok": True,
                    "text": report,
                    "metrics": metrics,
                    "vram": _vram_info(),
                    "ram": _ram_info(),
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
        text = "\n".join(f"{key}: {value}" for key, value in _collect().items())
        return {"ui": {"inteliweb_text": text}, "result": ()}
