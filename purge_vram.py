# custom_nodes/comfyui_inteliweb_nodes/purge_vram.py
"""VRAM cleanup node for ComfyUI.

Adapted from the PurgeVRAM concept in ComfyUI_LayerStyle by chflame163.
Original project: https://github.com/chflame163/ComfyUI_LayerStyle
Original code is licensed under the MIT License.
See THIRD_PARTY_NOTICES.md.
"""


class AnyType(str):
    """ComfyUI wildcard type that can connect to any socket type."""

    def __eq__(self, other):
        return True

    def __ne__(self, other):
        return False


ANY = AnyType("*")


def purge_memory(purge_cache=True, purge_models=True):
    """Release ComfyUI model memory and cached Python/CUDA memory.

    Returns a status dictionary so the function can also be reused by other
    Inteliweb nodes or HTTP endpoints later.
    """
    import gc

    import comfy.model_management as model_management
    import torch

    status = {
        "models_unloaded": False,
        "python_gc": False,
        "cuda_cache_cleared": False,
        "cuda_ipc_collected": False,
    }

    # Unload models first so their references can be released before clearing
    # Python and CUDA allocator caches.
    if purge_models:
        model_management.unload_all_models()
        status["models_unloaded"] = True

    if purge_cache:
        gc.collect()
        status["python_gc"] = True

        # Let ComfyUI perform its own cache cleanup when available.
        try:
            model_management.soft_empty_cache()
        except Exception:
            pass

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            status["cuda_cache_cleared"] = True

            # ipc_collect is not available or usable in every runtime, so keep
            # it best-effort instead of failing the workflow.
            try:
                torch.cuda.ipc_collect()
                status["cuda_ipc_collected"] = True
            except Exception:
                pass

    return status


class InteliwebPurgeVRAM:
    """Pass-through node that frees VRAM without breaking the workflow chain."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "anything": (ANY, {}),
                "purge_cache": ("BOOLEAN", {"default": True}),
                "purge_models": ("BOOLEAN", {"default": True}),
            }
        }

    RETURN_TYPES = (ANY,)
    RETURN_NAMES = ("anything",)
    FUNCTION = "purge_vram"
    CATEGORY = "inteliweb/utils"
    OUTPUT_NODE = True
    DESCRIPTION = (
        "Unloads ComfyUI models and/or clears Python and CUDA caches, then "
        "returns the input unchanged so it can remain inside a workflow chain."
    )

    def purge_vram(self, anything, purge_cache=True, purge_models=True):
        purge_memory(
            purge_cache=purge_cache,
            purge_models=purge_models,
        )
        return (anything,)
