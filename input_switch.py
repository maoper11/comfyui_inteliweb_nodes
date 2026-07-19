"""Standalone lazy input switch for ComfyUI.

This is an independent implementation of a general-purpose dynamic input switch.
It does not import or depend on ComfyUI-Impact-Pack.
"""

from __future__ import annotations

import logging
from typing import Any

from .purge_vram import ANY

LOGGER = logging.getLogger(__name__)
_INPUT_PREFIX = "input"
_INPUT_SPEC = (
    ANY,
    {
        "lazy": True,
        "tooltip": "Any input. Connecting the last slot adds another input.",
    },
)


def _is_dynamic_input_name(name: object) -> bool:
