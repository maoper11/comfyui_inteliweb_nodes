# custom_nodes/comfyui_inteliweb_nodes/purge_vram.py
"""Memory cleanup utilities and pass-through node for ComfyUI.

Adapted from the PurgeVRAM concept in ComfyUI_LayerStyle by chflame163.
Original project: https://github.com/chflame163/ComfyUI_LayerStyle
Original code is licensed under the MIT License.
See THIRD_PARTY_NOTICES.md.
"""

from __future__ import annotations

import gc
import json
import logging

LOGGER = logging.getLogger(__name__)
MIB = 1024 * 1024
GIB = 1024 * 1024 * 1024


class AnyType(str):
    """ComfyUI wildcard type that can connect to any socket type."""

    def __eq__(self, other):
        return True

    def __ne__(self, other):
        return False


ANY = AnyType("*")


def _safe_sync(model_management):
    try:
        synchronize = getattr(model_management, "synchronize", None)
        if callable(synchronize):
            synchronize()
    except Exception as exc:
        LOGGER.debug("Accelerator synchronization skipped: %s", exc)


def _safe_free_memory(model_management, device):
    try:
        return int(model_management.get_free_memory(device))
    except Exception as exc:
        LOGGER.debug("Memory measurement failed for %s: %s", device, exc)
        return 0


def _memory_snapshot(model_management, torch):
    device = model_management.get_torch_device()
    device_type = getattr(device, "type", None)
    vram_free = 0
    if device_type != "cpu":
        vram_free = _safe_free_memory(model_management, device)
    ram_free = _safe_free_memory(model_management, torch.device("cpu"))
    return {
        "vram_free_bytes": vram_free,
        "ram_free_bytes": ram_free,
    }


def _loaded_model_count(model_management):
    try:
        loaded_models = getattr(model_management, "loaded_models", None)
        if callable(loaded_models):
            return len(loaded_models())
    except Exception:
        pass
    return None


def purge_memory(
    purge_cache=True,
    purge_models=False,
    gc_collect=True,
):
    """Release ComfyUI-managed models, accelerator caches and Python garbage."""
    import comfy.model_management as model_management

    status = {
        "models_before": _loaded_model_count(model_management),
        "models_after": None,
        "models_unloaded": None,
        "python_gc_collected": 0,
        "cache_emptied": False,
    }

    if purge_models:
        model_management.unload_all_models()

    if gc_collect:
        status["python_gc_collected"] = int(gc.collect())

    if purge_cache:
        # Official ComfyUI path supports CUDA, ROCm, XPU, MPS and NPU.
        model_management.soft_empty_cache()
        status["cache_emptied"] = True

    status["models_after"] = _loaded_model_count(model_management)
    if status["models_before"] is not None and status["models_after"] is not None:
        status["models_unloaded"] = max(
            0, status["models_before"] - status["models_after"]
        )

    return status


def _to_mb(value):
    return int(round(value / MIB))


def _format_gb(value):
    return f"{value / GIB:.2f} GB"


def _signed_gb(value):
    return f"{value / GIB:+.2f} GB"


def _build_report(stage_name, before, after, status):
    vram_delta = after["vram_free_bytes"] - before["vram_free_bytes"]
    ram_delta = after["ram_free_bytes"] - before["ram_free_bytes"]

    metrics = {
        "stage_name": stage_name,
        "vram_before_mb": _to_mb(before["vram_free_bytes"]),
        "vram_after_mb": _to_mb(after["vram_free_bytes"]),
        "vram_freed_mb": _to_mb(vram_delta),
        "ram_before_mb": _to_mb(before["ram_free_bytes"]),
        "ram_after_mb": _to_mb(after["ram_free_bytes"]),
        "ram_freed_mb": _to_mb(ram_delta),
        **status,
    }

    models_text = (
        str(status["models_unloaded"])
        if status["models_unloaded"] is not None
        else "unknown"
    )
    report = (
        f"[Inteliweb][{stage_name}] Memory cleanup completed | "
        f"VRAM free: {_format_gb(before['vram_free_bytes'])} -> "
        f"{_format_gb(after['vram_free_bytes'])} ({_signed_gb(vram_delta)}) | "
        f"RAM free: {_format_gb(before['ram_free_bytes'])} -> "
        f"{_format_gb(after['ram_free_bytes'])} ({_signed_gb(ram_delta)}) | "
        f"models unloaded: {models_text} | "
        f"gc objects: {status['python_gc_collected']} | "
        f"cache emptied: {status['cache_emptied']}"
    )
    metrics["report"] = report
    return report, metrics


def run_memory_cleanup(
    *,
    stage_name="Memory Cleanup",
    purge_cache=True,
    purge_models=False,
    gc_collect=True,
    show_report=True,
):
    """Run the shared cleanup implementation and return metrics."""
    import comfy.model_management as model_management
    import torch

    stage_name = str(stage_name).strip() or "Memory Cleanup"
    _safe_sync(model_management)
    before = _memory_snapshot(model_management, torch)

    if show_report:
        LOGGER.info(
            "[Inteliweb][%s] Starting memory cleanup "
            "(purge_cache=%s, purge_models=%s, gc_collect=%s)",
            stage_name,
            purge_cache,
            purge_models,
            gc_collect,
        )

    status = purge_memory(
        purge_cache=purge_cache,
        purge_models=purge_models,
        gc_collect=gc_collect,
    )

    _safe_sync(model_management)
    after = _memory_snapshot(model_management, torch)
    report, metrics = _build_report(stage_name, before, after, status)

    if show_report:
        LOGGER.info(report)

    return report, metrics


class InteliwebPurgeVRAM:
    """Pass-through node that frees memory without breaking the workflow chain."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "anything": (ANY, {}),
                "purge_cache": ("BOOLEAN", {"default": True}),
                "purge_models": ("BOOLEAN", {"default": False}),
                "gc_collect": ("BOOLEAN", {"default": True}),
                "show_report": ("BOOLEAN", {"default": True}),
                "stage_name": (
                    "STRING",
                    {"default": "Memory Cleanup", "multiline": False},
                ),
            }
        }

    RETURN_TYPES = (ANY, "INT", "INT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = (
        "anything",
        "vram_before_mb",
        "vram_after_mb",
        "vram_freed_mb",
        "ram_before_mb",
        "ram_after_mb",
        "ram_freed_mb",
    )
    FUNCTION = "purge_vram"
    CATEGORY = "inteliweb/utils"
    OUTPUT_NODE = True
    SEARCH_ALIASES = ["Purge VRAM", "Free VRAM", "Clean Memory", "Free RAM"]
    DESCRIPTION = (
        "Passes the input through unchanged while optionally unloading ComfyUI "
        "models, running garbage collection and clearing accelerator caches. "
        "Reports free VRAM and RAM before/after."
    )

    def purge_vram(
        self,
        anything,
        purge_cache=True,
        purge_models=False,
        gc_collect=True,
        show_report=True,
        stage_name="Memory Cleanup",
    ):
        report, metrics = run_memory_cleanup(
            stage_name=stage_name,
            purge_cache=purge_cache,
            purge_models=purge_models,
            gc_collect=gc_collect,
            show_report=show_report,
        )

        result = (
            anything,
            metrics["vram_before_mb"],
            metrics["vram_after_mb"],
            metrics["vram_freed_mb"],
            metrics["ram_before_mb"],
            metrics["ram_after_mb"],
            metrics["ram_freed_mb"],
        )
        ui = {"inteliweb_memory": [json.dumps(metrics, ensure_ascii=False)]}
        if show_report:
            ui["text"] = [report]

        return {"ui": ui, "result": result}
