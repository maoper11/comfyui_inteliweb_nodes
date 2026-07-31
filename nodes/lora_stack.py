"""Portable multi-LoRA stack node for ComfyUI."""

from __future__ import annotations

import json
import logging
import posixpath
from typing import Any

import folder_paths
import nodes as comfy_nodes

LOGGER = logging.getLogger(__name__)

_DEFAULT_STATE = {
    "version": 1,
    "separate_strengths": False,
    "loras": [],
}
_DEFAULT_STATE_JSON = json.dumps(_DEFAULT_STATE, separators=(",", ":"))


def _normalize_lora_name(value: object) -> str:
    """Return a portable, forward-slash relative LoRA path."""
    if not isinstance(value, str):
        return ""

    normalized = value.strip().replace("\\", "/").lstrip("/")
    if not normalized:
        return ""

    normalized = posixpath.normpath(normalized)
    if normalized in ("", "."):
        return ""
    if normalized == ".." or normalized.startswith("../"):
        raise ValueError(f"Invalid LoRA path: {value!r}")
    return normalized


def _parse_state(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        state = value
    elif isinstance(value, str) and value.strip():
        try:
            state = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid LoRA Stack state JSON: {exc}") from exc
    else:
        state = dict(_DEFAULT_STATE)

    if not isinstance(state, dict):
        raise ValueError("LoRA Stack state must be a JSON object.")

    rows = state.get("loras", [])
    if not isinstance(rows, list):
        raise ValueError("LoRA Stack 'loras' value must be a list.")

    return {
        "version": 1,
        "separate_strengths": bool(state.get("separate_strengths", False)),
        "loras": rows,
    }


def _safe_strength(value: object, fallback: float = 1.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return max(-100.0, min(100.0, number))


def _unique_match(matches: list[str], requested: str, match_type: str) -> str | None:
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        portable_matches = ", ".join(_normalize_lora_name(item) for item in matches[:8])
        suffix = " ..." if len(matches) > 8 else ""
        raise FileNotFoundError(
            f"LoRA path {requested!r} is ambiguous by {match_type}: "
            f"{portable_matches}{suffix}"
        )
    return None


def _resolve_lora_name(requested_name: object) -> str:
    """Resolve Windows/Linux separator differences against this installation."""
    requested = _normalize_lora_name(requested_name)
    if not requested:
        raise FileNotFoundError("The LoRA row does not contain a filename.")

    available = folder_paths.get_filename_list("loras")
    normalized_pairs = [(_normalize_lora_name(name), name) for name in available]

    match = _unique_match(
        [actual for portable, actual in normalized_pairs if portable == requested],
        requested,
        "portable path",
    )
    if match is not None:
        return match

    requested_folded = requested.casefold()
    match = _unique_match(
        [actual for portable, actual in normalized_pairs if portable.casefold() == requested_folded],
        requested,
        "case-insensitive path",
    )
    if match is not None:
        return match

    requested_basename = requested.rsplit("/", 1)[-1].casefold()
    match = _unique_match(
        [
            actual
            for portable, actual in normalized_pairs
            if portable.rsplit("/", 1)[-1].casefold() == requested_basename
        ],
        requested,
        "filename",
    )
    if match is not None:
        LOGGER.warning(
            "LoRA Stack resolved missing path %r by unique filename match: %r",
            requested,
            _normalize_lora_name(match),
        )
        return match

    raise FileNotFoundError(
        f"LoRA {requested!r} was not found. Select an available LoRA file."
    )


class InteliwebLoraStack:
    """Apply multiple enabled LoRAs sequentially with portable saved paths."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": (
                    "MODEL",
                    {"tooltip": "Diffusion model that receives the enabled LoRAs in row order."},
                ),
            },
            "optional": {
                "clip": (
                    "CLIP",
                    {
                        "tooltip": (
                            "Optional CLIP model. When disconnected, LoRAs are applied only "
                            "to the diffusion model."
                        )
                    },
                ),
            },
            # The browser stores this JSON in node.properties and injects it into
            # the execution prompt. Keeping it in hidden prevents Classic and
            # Nodes 2.0 from creating a widget-backed connection socket.
            "hidden": {
                "lora_stack": (
                    "STRING",
                    {"default": _DEFAULT_STATE_JSON},
                ),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("MODEL", "CLIP")
    OUTPUT_TOOLTIPS = (
        "Model after applying all enabled LoRAs in order.",
        "Modified CLIP when connected; otherwise None.",
    )
    FUNCTION = "apply_loras"
    CATEGORY = "inteliweb/loaders"
    DESCRIPTION = (
        "Applies multiple LoRAs sequentially. CLIP is optional for model-only loading. "
        "Saved LoRA paths use forward slashes and are resolved portably between Windows "
        "and Linux."
    )
    SEARCH_ALIASES = [
        "LoRA Stack",
        "Power LoRA Loader",
        "Multiple LoRAs",
        "LoRA Loader",
        "Apply LoRAs",
    ]

    def __init__(self):
        self._loader = comfy_nodes.LoraLoader()

    def apply_loras(self, model, lora_stack=_DEFAULT_STATE_JSON, clip=None):
        state = _parse_state(lora_stack)
        separate_strengths = state["separate_strengths"]
        current_model = model
        current_clip = clip

        for index, row in enumerate(state["loras"], start=1):
            if not isinstance(row, dict) or not bool(row.get("on", True)):
                continue

            requested_name = row.get("name", "")
            if not str(requested_name).strip():
                continue

            if separate_strengths:
                strength_model = _safe_strength(row.get("strength_model", 1.0))
                strength_clip = _safe_strength(row.get("strength_clip", 1.0))
            else:
                linked_strength = _safe_strength(
                    row.get("strength", row.get("strength_model", 1.0))
                )
                strength_model = linked_strength
                strength_clip = linked_strength

            if current_clip is None:
                strength_clip = 0.0

            if strength_model == 0.0 and strength_clip == 0.0:
                continue

            try:
                actual_name = _resolve_lora_name(requested_name)
                current_model, current_clip = self._loader.load_lora(
                    current_model,
                    current_clip,
                    actual_name,
                    strength_model,
                    strength_clip,
                )
            except Exception as exc:
                portable_name = _normalize_lora_name(requested_name)
                raise RuntimeError(
                    f"LoRA Stack failed on row {index} ({portable_name!r}): {exc}"
                ) from exc

        return current_model, current_clip
