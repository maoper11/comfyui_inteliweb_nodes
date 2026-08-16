"""GPU profile selector and lazy model stack router for Inteliweb workflows.

The backend deliberately stays small: global/local synchronization and automatic
muting are frontend concerns, while execution-time routing remains deterministic
and lazy.
"""

from __future__ import annotations

from typing import Any

PROFILE_TYPE = "INTELIWEB_GPU_PROFILE"
PROFILE_VALUES = ("LOW", "MEDIUM", "HIGH", "ULTRA")
ROUTER_PROFILE_VALUES = ("GLOBAL",) + PROFILE_VALUES
NO_GLOBAL_CHANNEL = "none"


def _normalize_profile(value: object, fallback: str = "HIGH") -> str:
    text = str(value or "").upper().strip()
    return text if text in PROFILE_VALUES else fallback


def _profile_from_status(value: object, fallback: str = "HIGH") -> str:
    """Extract LOW/MEDIUM/HIGH/ULTRA from an informational status string."""
    text = str(value or "").upper().strip()
    head = text.split("•", 1)[0].strip()
    return _normalize_profile(head, fallback)


class InteliwebGPUProfileSelector:
    """Emit a GPU profile and optionally publish it to a frontend global channel."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "scope": (
                    ["GLOBAL", "LOCAL"],
                    {
                        "default": "GLOBAL",
                        "tooltip": "GLOBAL publishes to the selected channel; LOCAL only emits GPU PROFILE.",
                    },
                ),
                "profile": (
                    list(PROFILE_VALUES),
                    {
                        "default": "HIGH",
                        "tooltip": "GPU/VRAM profile emitted by this node.",
                    },
                ),
                "global_channel": (
                    "STRING",
                    {
                        "default": "gpu_profile",
                        "multiline": False,
                        "advanced": True,
                        "tooltip": "Global synchronization channel name. Additional GLOBAL selectors are automatically assigned a unique channel.",
                    },
                ),
            }
        }

    RETURN_TYPES = (PROFILE_TYPE,)
    RETURN_NAMES = ("GPU PROFILE",)
    FUNCTION = "select_profile"
    CATEGORY = "Inteliweb/Loaders"
    DESCRIPTION = (
        "Selects LOW, MEDIUM, HIGH or ULTRA. In GLOBAL scope the frontend publishes "
        "the value on a named workflow channel; LOCAL scope only emits GPU PROFILE."
    )
    SEARCH_ALIASES = ["GPU Profile", "VRAM Profile", "Hardware Profile"]

    @staticmethod
    def select_profile(scope: str, profile: str, global_channel: str):
        del scope, global_channel
        return (_normalize_profile(profile),)


class InteliwebModelProfileRouter:
    """Route MODEL / text encoder / VAE stacks by GPU profile with lazy evaluation."""

    @classmethod
    def INPUT_TYPES(cls):
        lazy_model = {"lazy": True, "tooltip": "Optional MODEL for this profile."}
        lazy_clip = {"lazy": True, "tooltip": "Optional text encoder (CLIP type) for this profile."}
        lazy_vae = {"lazy": True, "tooltip": "Optional VAE for this profile."}

        optional: dict[str, Any] = {
            "profile_in": (
                PROFILE_TYPE,
                {
                    "lazy": True,
                    "tooltip": "Optional external GPU PROFILE. When connected it has highest priority.",
                },
            )
        }
        for prefix in ("low", "medium", "high", "ultra"):
            optional[f"{prefix}_model"] = ("MODEL", lazy_model)
            optional[f"{prefix}_text_encoder"] = ("CLIP", lazy_clip)
            optional[f"{prefix}_vae"] = ("VAE", lazy_vae)

        return {
            "required": {
                "profile": (
                    list(ROUTER_PROFILE_VALUES),
                    {
                        "default": "HIGH",
                        "tooltip": "GLOBAL follows Global Channel. LOW/MEDIUM/HIGH/ULTRA make this router local.",
                    },
                ),
                "effective_profile": (
                    "STRING",
                    {
                        "default": "HIGH • LOCAL",
                        "multiline": False,
                        "tooltip": "Informational status automatically updated by the Inteliweb frontend extension.",
                    },
                ),
                "global_channel": (
                    [NO_GLOBAL_CHANNEL],
                    {
                        "default": NO_GLOBAL_CHANNEL,
                        "advanced": True,
                        "tooltip": "Global channel listened to by this router. The list is populated from GLOBAL GPU Profile Selectors in the workflow.",
                    },
                ),
            },
            "optional": optional,
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE", PROFILE_TYPE)
    RETURN_NAMES = ("MODEL", "TEXT ENCODER", "VAE", "GPU PROFILE")
    FUNCTION = "route"
    CATEGORY = "Inteliweb/Loaders"
    DESCRIPTION = (
        "Lazily selects MODEL, text encoder and VAE for LOW/MEDIUM/HIGH/ULTRA. "
        "PROFILE IN overrides GLOBAL or local selection."
    )
    SEARCH_ALIASES = ["Model Profile Router", "GPU Router", "VRAM Router", "Model Switch"]

    @staticmethod
    def VALIDATE_INPUTS(global_channel):
        """Accept workflow-local channel names populated dynamically by the frontend.

        The backend node definition exposes a placeholder combo containing only
        ``none`` because workflow-local channels are not knowable from INPUT_TYPES.
        Declaring custom validation for this input intentionally bypasses ComfyUI's
        static combo-membership check while leaving the frontend free to present the
        real channel list discovered in the current workflow.
        """
        del global_channel
        return True

    @staticmethod
    def _effective_profile(
        profile: str,
        effective_profile: str,
        profile_in: object = None,
    ) -> str:
        if profile_in is not None:
            return _normalize_profile(profile_in)
        if str(profile).upper() == "GLOBAL":
            return _profile_from_status(effective_profile)
        return _normalize_profile(profile)

    def check_lazy_status(self, *args, **kwargs):
        if "profile_in" in kwargs and kwargs.get("profile_in") is None:
            return ["profile_in"]

        effective = self._effective_profile(
            kwargs.get("profile", "HIGH"),
            kwargs.get("effective_profile", "HIGH • LOCAL"),
            kwargs.get("profile_in"),
        ).lower()

        needed = []
        for suffix in ("model", "text_encoder", "vae"):
            name = f"{effective}_{suffix}"
            if name in kwargs and kwargs.get(name) is None:
                needed.append(name)
        return needed

    def route(self, *args, **kwargs):
        effective = self._effective_profile(
            kwargs.get("profile", "HIGH"),
            kwargs.get("effective_profile", "HIGH • LOCAL"),
            kwargs.get("profile_in"),
        )
        prefix = effective.lower()
        return (
            kwargs.get(f"{prefix}_model"),
            kwargs.get(f"{prefix}_text_encoder"),
            kwargs.get(f"{prefix}_vae"),
            effective,
        )
