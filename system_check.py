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


def _flash_attn_simple():
    """
    Devuelve: version (o 'Not installed'), supported (True/False), sm (int o None).
    - supported se toma de torch.backends.cuda.flash_sdp_supported()
    - version se obtiene via importlib.metadata sin forzar el import del paquete
    """
    version = "Not installed"
    supported = False
    sm = None
    # Paquete (sin importar)
    try:
        from importlib import metadata as im
    except Exception:
        import importlib_metadata as im  # fallback
    for dist in ("flash-attn", "flash_attn", "FlashAttention"):
        try:
            version = im.version(dist)
            break
        except Exception:
            continue
    # Soporte y SM
    try:
        import torch
        if torch.cuda.is_available():
            try:
                major, minor = torch.cuda.get_device_capability(0)
                sm = major * 10 + minor
            except Exception:
                sm = None
        # soporte de Flash SDP nativa
        try:
            supported = bool(getattr(torch.backends.cuda,
                             "flash_sdp_supported", lambda: False)())
        except Exception:
            supported = False
    except Exception:
        supported = False
        sm = None
    return version, supported, sm


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

    # PyTorch / CUDA
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

        # Flash Attention (simple, estilo sageattention)
        ver, sup, sm = _flash_attn_simple()
        sm_s = f", sm={sm}" if sm is not None else ""
        info["Flash Attention"] = f"{ver} (supported={sup}{sm_s})"

    except Exception:
        info["PyTorch"] = "Not installed"

    # Other useful libs
    libs = [
        "xformers", "numpy", "PIL", "cv2", "transformers", "diffusers",
        "huggingface_hub", "tokenizers", "onnx", "onnxruntime", "timm",
        "accelerate", "bitsandbytes", "sentencepiece", "kornia", "insightface",
        "ultralytics", "mediapipe", "scipy", "skimage", "pandas", "triton", "sageattention", "av"
    ]
    aliases = {"cv2": "OpenCV", "PIL": "Pillow",
               "skimage": "scikit-image", "av": "AV"}
    for m in libs:
        label = aliases.get(m, m)
        info[label] = _get(m)

    # --- SageAttention: versión y soporte (robusto) ---
    try:
        from importlib import metadata as im

        sa = importlib.import_module("sageattention")

        # 1) versión
        ver = getattr(sa, "__version__", None)
        if not ver:
            for attr_path in ("__about__.__version__", "version.__version__"):
                try:
                    mod, var = attr_path.split(".")
                    sub = getattr(sa, mod)
                    ver = getattr(sub, var, None)
                    if ver:
                        break
                except Exception:
                    pass
        if not ver:
            for dist in ("sageattention", "sage-attention", "SageAttention", "Sage-Attention"):
                try:
                    ver = im.version(dist)
                    if ver:
                        break
                except Exception:
                    pass

        # 2) soporte
        supported = None
        for name in ("is_available", "is_supported", "available"):
            fn = getattr(sa, name, None)
            if callable(fn):
                try:
                    supported = bool(fn())
                except Exception:
                    pass
                break
        if supported is None:
            fn = getattr(sa, "supports_device", None)
            if callable(fn):
                try:
                    import torch
                    dev = torch.device(
                        "cuda") if torch.cuda.is_available() else torch.device("cpu")
                    supported = bool(fn(dev))
                except Exception:
                    supported = None
        if supported is None:
            try:
                import torch
                supported = hasattr(torch.ops, "sageattention") or hasattr(
                    torch.ops, "sage_attention")
            except Exception:
                supported = None

        info["sageattention"] = (
            ver or "present") if supported is None else f"{ver or 'present'} (supported={supported})"

    except Exception:
        pass

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
            import sys as _sys
            gc.collect()

            trimmed = False
            try:
                if _sys.platform.startswith("linux"):
                    import ctypes
                    libc = ctypes.CDLL("libc.so.6")
                    libc.malloc_trim(0)
                    trimmed = True
                elif _sys.platform.startswith("win"):
                    import ctypes
                    psapi = ctypes.WinDLL("psapi")
                    kernel32 = ctypes.WinDLL("kernel32")
                    handle = kernel32.GetCurrentProcess()
                    psapi.EmptyWorkingSet(handle)
                    trimmed = True
                # macOS: no API pública estable; queda gc.collect() como mejor esfuerzo.
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
