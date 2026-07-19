"""Standalone lazy input switch for ComfyUI.

This is an independent implementation of a general-purpose dynamic input switch.
It does not import or depend on ComfyUI-Impact-Pack.
"""

from __future__ import annotations

import logging
from typing import Any

from .purge_vram import ANY

LOGGER = logging.getLogger(__name__)
_NODE_CLASS = "InteliwebInputSwitch"
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


def _prompt_node(prompt: dict, node_id: object) -> dict | None:
    return prompt.get(str(node_id)) or prompt.get(node_id)


def _resolve_static_select(prompt: dict, value: object, visited: set[str] | None = None):
    """Resolve literal or simple linked integer selectors for select-on-prompt mode."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _selected_index(value)
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None

    source_id, source_output = value
    key = str(source_id)
    visited = visited or set()
    if key in visited:
        return None
    visited.add(key)

    source = _prompt_node(prompt, source_id)
    if not isinstance(source, dict):
        return None
    source_inputs = source.get("inputs", {})

    literal = source_inputs.get("value")
    if isinstance(literal, (int, float)) and not isinstance(literal, bool):
        return _selected_index(literal)

    if source.get("class_type") == _NODE_CLASS and int(source_output) == 2:
        return _resolve_static_select(prompt, source_inputs.get("select"), visited)
    return None


def _on_prompt(json_data: dict):
    """Optionally prune unselected branches before execution for legacy workflows."""
    prompt = json_data.get("prompt")
    if not isinstance(prompt, dict):
        return json_data

    for node in prompt.values():
        if not isinstance(node, dict) or node.get("class_type") != _NODE_CLASS:
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict) or not inputs.get("sel_mode"):
            continue

        selected = _resolve_static_select(prompt, inputs.get("select"))
        if selected is None:
            continue
        selected_name = f"{_INPUT_PREFIX}{selected}"
        for name in list(inputs):
            if _is_dynamic_input_name(name) and name != selected_name:
                inputs.pop(name, None)

    return json_data


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
                "sel_mode": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "label_on": "select_on_prompt",
                        "label_off": "select_on_execution",
                        "forceInput": False,
                        "tooltip": (
                            "Execution mode evaluates the selected lazy input at runtime. "
                            "Prompt mode prunes other literal/static branches before execution."
                        ),
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
        "lazy input is evaluated in the default execution mode."
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


try:
    from server import PromptServer

    PromptServer.instance.add_on_prompt_handler(_on_prompt)
except Exception as exc:
    LOGGER.debug("Input Switch prompt handler was not registered: %s", exc)
