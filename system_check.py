# custom_nodes/comfyui_inteliweb_nodes/system_check.py
import sys
import platform
import importlib
import json


def _get(mod):
    """Return module version or 'Not installed'."""
    try:
        m = importlib.import_module(mod)
        v = getattr(m, "__version__", None)
        if v is None and hasattr(m, "version"):
            try:
                v = m.version()
            except Exception:
                v = None
        return str(v) if v else "present"
    except Exception:
        return "Not installed"


def _collect():
    info = {}
    # Basics
    info["Python version"] = sys.version.split()[0]
    info["Operating System"] = f"{platform.system()} {platform.release()}"
    info["CPU"] = platform.processor() or platform.machine()
    try:
        import psutil
        m = psutil.virtual_memory()
        info["RAM"] = f"{m.used/1024/1024/1024:.2f} / {m.total/1024/1024/1024:.2f} GB ({m.percent:.0f}%)"
    except Exception:
        info["RAM"] = "Unknown"

    # PyTorch / CUDA + Flash Attention
    try:
        import torch
        import torchvision
        info["PyTorch"] = torch.__version__
        info["torchvision"] = getattr(torchvision, "__version__", "present")

        if torch.cuda.is_available():
            try:
                name = torch.cuda.get_device_name(0)
            except Exception:
                name = "cuda:0"
            info["GPU"] = f"CUDA available: {name}"
        else:
            info["GPU"] = "CPU only"

        info["CUDA version"] = getattr(torch.version, "cuda", "unknown")

        # Flash Attention status (PyTorch flash SDP)
        try:
            sup = getattr(torch.backends.cuda,
                          "flash_sdp_supported", lambda: False)()
            en = getattr(torch.backends.cuda,
                         "flash_sdp_enabled", lambda: False)()
            info["Flash Attention"] = f"supported={sup}, enabled={en}"
        except Exception:
            info["Flash Attention"] = "Unknown"

    except Exception:
        info["PyTorch"] = "Not installed"

    # External package 'flash-attn' if present
    try:
        _fa = importlib.import_module("flash_attn")
        _ver = getattr(_fa, "__version__", None)
        if not _ver and hasattr(_fa, "version"):
            try:
                _ver = _fa.version()
            except Exception:
                _ver = None
        info["flash-attn (package)"] = _ver or "present"
    except Exception:
        info["flash-attn (package)"] = "Not installed"

    # Other useful libs
    libs = [
        "xformers", "numpy", "Pillow", "cv2", "transformers", "diffusers",
        "huggingface_hub", "tokenizers", "onnx", "onnxruntime", "timm",
        "accelerate", "bitsandbytes", "sentencepiece", "kornia", "insightface",
        "ultralytics", "mediapipe", "scipy", "skimage", "pandas", "triton", "sageattention"
    ]
    aliases = {"cv2": "OpenCV", "Pillow": "Pillow", "skimage": "scikit-image"}
    for m in libs:
        label = aliases.get(m, m)
        info[label] = _get(m)

    return info


# --- HTTP endpoints used by the JS ---
try:
    from aiohttp import web
    from server import PromptServer
    routes = PromptServer.instance.routes

    @routes.get("/inteliweb_sysinfo")
    async def inteliweb_sysinfo(request):
        return web.json_response(_collect())
except Exception:
    # In headless import-path contexts, server routes may not be available
    routes = None


def _vram_info():
    try:
        import torch
        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            return {"free_mb": free // (1024*1024), "total_mb": total // (1024*1024)}
    except Exception:
        pass
    return {"free_mb": 0, "total_mb": 0}


def _ram_info():
    try:
        import psutil
        m = psutil.virtual_memory()
        return {
            "used_mb": m.used // (1024 * 1024),
            "free_mb": m.available // (1024 * 1024),
            "total_mb": m.total // (1024 * 1024),
        }
    except Exception:
        return {"used_mb": 0, "free_mb": 0, "total_mb": 0}



if routes is not None:
    @routes.get("/inteliweb/telemetry")
    async def inteliweb_telemetry(request):
        # Lightweight endpoint polled by the UI every second
        return web.json_response({"vram": _vram_info(), "ram": _ram_info()})

if routes is not None:
    @routes.get("/inteliweb/system_info")  # legacy alias
    async def inteliweb_system_info_alias(request):
        d = _collect()
        return web.json_response({"text": "\n".join(f"{k}: {v}" for k, v in d.items()),
                                  "vram": _vram_info(), "ram": _ram_info(), **d})

    @routes.get("/inteliweb/free_vram")
    async def inteliweb_free_vram(request):
        mode = request.query.get("mode", "")
        try:
            import torch
            import gc
            if "aggressive" in mode:
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.ipc_collect()
                    torch.cuda.synchronize()
            else:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            vram = _vram_info()
            return web.json_response({"ok": True, "vram": vram,
                                      "text": f"VRAM freed. Free {vram['free_mb']} / {vram['total_mb']} MB"})
        except Exception as e:
            return web.json_response({"ok": False, "text": f"Error freeing VRAM: {e}"})

    @routes.get("/inteliweb/free_ram")
    async def inteliweb_free_ram(request):
        try:
            import gc
            import sys
            gc.collect()

            trimmed = False
            try:
                if sys.platform.startswith("linux"):
                    import ctypes
                    libc = ctypes.CDLL("libc.so.6")
                    libc.malloc_trim(0)
                    trimmed = True
                elif sys.platform.startswith("win"):
                    import ctypes
                    psapi = ctypes.WinDLL("psapi")
                    kernel32 = ctypes.WinDLL("kernel32")
                    handle = kernel32.GetCurrentProcess()
                    psapi.EmptyWorkingSet(handle)
                    trimmed = True
                # macOS: no hay una API pública estable para recortar working set;
                # dejamos gc.collect() como mejor esfuerzo.
            except Exception:
                pass

            return web.json_response({"ok": True, "ram": _ram_info(), "trimmed": trimmed})
        except Exception as e:
            return web.json_response({"ok": False, "text": f"Error freeing RAM: {e}"})


class InteliwebSystemCheck:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = tuple()
    OUTPUT_NODE = True
    CATEGORY = "inteliweb/utils"
    FUNCTION = "noop"

    def noop(self):
        txt = "\n".join([f"{k}: {v}" for k, v in _collect().items()])
        return {"ui": {"inteliweb_text": txt}, "result": ()}
