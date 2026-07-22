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
    if not isinstance(name, str) or not name.startswith(_INPUT_PREFIX):
        return False
    suffix = name[len(_INPUT_PREFIX) :]
    return suffix.isdigit() and int(suffix) >= 1


class _DynamicOptionalInputs(dict):
    """Expose input1 to the frontend while accepting inputN at execution time."""

    def __init__(self):
        super().__init__({_INPUT_PREFIX + "1": _INPUT_SPEC})

    def __contains__(self, key: object) -> bool:
        return _is_dynamic_input_name(key) or super().__contains__(key)

    def __getitem__(self, key: str):
        if _is_dynamic_input_name(key):
            return _INPUT_SPEC
        return super().__getitem__(key)

    def get(self, key: str, default=None):
        if _is_dynamic_input_name(key):
            return _INPUT_SPEC
        return super().get(key, default)


def _selected_index(value: object) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1


def _find_workflow_node(container: object, node_id: object) -> dict[str, Any] | None:
    """Find a node recursively, including nodes stored inside subgraph definitions."""
    if isinstance(container, dict):
        if str(container.get("id")) == str(node_id) and isinstance(
            container.get("inputs"), list
        ):
            return container
        for value in container.values():
            found = _find_workflow_node(value, node_id)
            if found is not None:
                return found
    elif isinstance(container, list):
        for value in container:
            found = _find_workflow_node(value, node_id)
            if found is not None:
                return found
    return None


def _selected_label(extra_pnginfo: object, node_id: object, input_name: str) -> str:
    fallback = input_name
    if not isinstance(extra_pnginfo, dict):
        return fallback

    workflow = extra_pnginfo.get("workflow")
    node = _find_workflow_node(workflow, node_id)
    if not node:
        return fallback

    for slot in node.get("inputs", []):
        if slot.get("name") == input_name:
            label = slot.get("label")
            return str(label) if label not in (None, "") else fallback
    return fallback


class InteliwebInputSwitch:
    """Select one lazily evaluated value from a dynamic list of matching inputs."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "select": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 999999,
                        "step": 1,
                        "tooltip": "Input number to send to the output.",
                    },
                ),
            },
            "optional": _DynamicOptionalInputs(),
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = (ANY, "STRING", "INT")
    RETURN_NAMES = ("selected_value", "selected_label", "selected_index")
    OUTPUT_TOOLTIPS = (
        "Value from the selected input.",
        "Custom label of the selected input, or its input name.",
        "Selected one-based input index.",
    )
    FUNCTION = "switch"
    CATEGORY = "inteliweb/utils"
    DESCRIPTION = (
        "Selects one value from a dynamic list of matching inputs. Only the selected "
        "lazy input is evaluated."
    )
    SEARCH_ALIASES = ["Switch Any", "Any Switch", "Input Selector", "Router"]

    def check_lazy_status(self, *args, **kwargs):
        input_name = f"{_INPUT_PREFIX}{_selected_index(kwargs.get('select', 1))}"
        return [input_name] if input_name in kwargs else []

    @staticmethod
    def switch(*args, **kwargs):
        selected_index = _selected_index(kwargs.get("select", 1))
        input_name = f"{_INPUT_PREFIX}{selected_index}"
        label = _selected_label(
            kwargs.get("extra_pnginfo"), kwargs.get("unique_id"), input_name
        )

        if input_name in kwargs:
            return kwargs[input_name], label, selected_index

        LOGGER.warning(
            "[Inteliweb] Input Switch selected %s, but that input is not connected.",
            input_name,
        )
        return None, "", selected_index
