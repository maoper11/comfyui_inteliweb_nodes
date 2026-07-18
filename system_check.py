# custom_nodes/comfyui_inteliweb_nodes/system_check.py
"""System diagnostics for ComfyUI using scanner-friendly Python APIs."""

from __future__ import annotations

import json
import platform
import sys
from importlib import metadata


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


def _flash_attention_info():
    version = _distribution_version("flash-attn", "flash_attn", "FlashAttention")
    supported = False
    sm = None
    try:
        import torch

        if torch.cuda.is_available():
            try:
                major, minor = torch.cuda.get_device_capability(0)
                sm = major * 10 + minor
            except Exception:
                sm = None
        try:
            checker = getattr(torch.backends.cuda, "flash_sdp_supported", None)
            supported = bool(checker()) if callable(checker) else False
        except Exception:
            supported = False
    except Exception:
        pass
    return version, supported, sm


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
                gpu_name = "cuda:0"
            info["GPU"] = f"Accelerator available: {gpu_name}"
        else:
            info["GPU"] = "CPU only"
        info["CUDA version"] = getattr(torch.version, "cuda", None) or "unknown"

        version, supported, sm = _flash_attention_info()
        sm_text = f", sm={sm}" if sm is not None else ""
        info["Flash Attention"] = f"{version} (supported={supported}{sm_text})"
    except Exception:
        info["PyTorch"] = "Not installed"
        info["torchvision"] = _distribution_version("torchvision")
        info["GPU"] = "Unknown"
        info["CUDA version"] = "unknown"

    packages = {
        "xformers": ("xformers",),
        "numpy": ("numpy",),
        "Pillow": ("Pillow",),
        "OpenCV": ("opencv-python", "opencv-python-headless"),
        "transformers": ("transformers",),
        "diffusers": ("diffusers",),
        "huggingface_hub": ("huggingface-hub",),
        "tokenizers": ("tokenizers",),
        "onnx": ("onnx",),
        "onnxruntime": ("onnxruntime", "onnxruntime-gpu"),
        "timm": ("timm",),
        "accelerate": ("accelerate",),
        "bitsandbytes": ("bitsandbytes",),
        "sentencepiece": ("sentencepiece",),
        "kornia": ("kornia",),
        "insightface": ("insightface",),
        "ultralytics": ("ultralytics",),
        "mediapipe": ("mediapipe",),
        "scipy": ("scipy",),
        "scikit-image": ("scikit-image",),
        "pandas": ("pandas",),
        "triton": ("triton",),
        "SageAttention": ("sageattention", "sage-attention"),
        "AV": ("av",),
    }
    for label, distribution_names in packages.items():
        info[label] = _distribution_version(*distribution_names)

    return info


try:
    from aiohttp import web
    from server import PromptServer

    routes = PromptServer.instance.routes

    @routes.get("/inteliweb_sysinfo")
    async def inteliweb_sysinfo(request):
        return web.json_response(_collect())
except Exception:
    routes = None


def _vram_info():
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            return {
                "free_mb": free // (1024 * 1024),
                "total_mb": total // (1024 * 1024),
            }
    except Exception:
        pass
    return {"free_mb": 0, "total_mb": 0}


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


if routes is not None:

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

    @routes.get("/inteliweb/free_vram")
    async def inteliweb_free_vram(request):
        mode = request.query.get("mode", "")
        try:
            import gc
            import torch

            if "aggressive" in mode:
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
                    torch.cuda.synchronize()
            elif torch.cuda.is_available():
                torch.cuda.empty_cache()

            vram = _vram_info()
            return web.json_response(
                {
                    "ok": True,
                    "vram": vram,
                    "text": (
                        f"VRAM freed. Free {vram['free_mb']} / "
                        f"{vram['total_mb']} MB"
                    ),
                }
            )
        except Exception as exc:
            return web.json_response({"ok": False, "text": f"Error freeing VRAM: {exc}"})

    @routes.get("/inteliweb/free_ram")
    async def inteliweb_free_ram(request):
        try:
            import gc

            gc.collect()
            return web.json_response({"ok": True, "ram": _ram_info(), "trimmed": False})
        except Exception as exc:
            return web.json_response({"ok": False, "text": f"Error freeing RAM: {exc}"})


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
