"""Dual-renderer image comparison output node for ComfyUI."""

from __future__ import annotations

import os
import random

import numpy as np
from PIL import Image

import folder_paths


class InteliwebImageCompare:
    """Display two IMAGE inputs in an interactive frontend comparer."""

    DESCRIPTION = (
        "Compare two images directly inside the workflow. Supports Left Right, "
        "Up Down, Toggle and Side by Side views in both Classic and Nodes 2.0."
    )

    def __init__(self) -> None:
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        suffix = "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
        self.prefix = f"inteliweb_compare_{suffix}"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "image_a": ("IMAGE", {"tooltip": "First image to compare."}),
                "image_b": ("IMAGE", {"tooltip": "Second image to compare."}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "compare_images"
    OUTPUT_NODE = True
    CATEGORY = "Inteliweb/Image"

    def _save_preview(self, tensor, slot: str):
        if tensor is None or len(tensor) == 0:
            return None

        image_tensor = tensor[0]
        height, width = image_tensor.shape[0], image_tensor.shape[1]
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            self.prefix,
            self.output_dir,
            width,
            height,
        )

        pixels = 255.0 * image_tensor.cpu().numpy()
        image = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
        file_name = f"{filename}_{counter:05}_{slot}.png"
        image.save(os.path.join(full_output_folder, file_name), compress_level=4)

        return {
            "filename": file_name,
            "subfolder": subfolder,
            "type": self.type,
            "slot": slot,
        }

    def compare_images(self, image_a=None, image_b=None):
        images = []
        preview_a = self._save_preview(image_a, "a")
        preview_b = self._save_preview(image_b, "b")
        if preview_a is not None:
            images.append(preview_a)
        if preview_b is not None:
            images.append(preview_b)

        # Avoid the conventional "images" UI key so ComfyUI does not render its
        # own permanent Preview Image widget below the custom comparison canvas.
        return {"ui": {"inteliweb_compare": images}}
