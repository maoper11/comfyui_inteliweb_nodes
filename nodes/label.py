"""Lightweight visual label node for ComfyUI workflows."""

from __future__ import annotations


class InteliwebLabel:
    """A frontend-rendered label backed by normal ComfyUI widgets.

    The Python node intentionally performs no work. Keeping the configuration as
    standard widgets makes the label serialize like any other server node and
    avoids a frontend-only registration.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "default": "Label Inteliweb",
                        "multiline": True,
                        "dynamicPrompts": False,
                    },
                ),
                "font_size": (
                    "INT",
                    {"default": 36, "min": 8, "max": 160, "step": 1},
                ),
                "font_family": (
                    [
                        "Arial",
                        "Inter",
                        "Roboto",
                        "Verdana",
                        "Tahoma",
                        "Georgia",
                        "Times New Roman",
                        "Courier New",
                        "Impact",
                    ],
                    {"default": "Arial"},
                ),
                "font_weight": (
                    ["normal", "bold"],
                    {"default": "bold"},
                ),
                "text_color": (
                    "STRING",
                    {"default": "#000000", "multiline": False},
                ),
                "background_color": (
                    "STRING",
                    {"default": "#a3e635", "multiline": False},
                ),
                "text_align": (
                    ["left", "center", "right"],
                    {"default": "center"},
                ),
                "padding": (
                    "INT",
                    {"default": 16, "min": 0, "max": 96, "step": 1},
                ),
                "border_radius": (
                    "INT",
                    {"default": 22, "min": 0, "max": 96, "step": 1},
                ),
                "opacity": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.1, "max": 1.0, "step": 0.05},
                ),
                "line_height": (
                    "FLOAT",
                    {"default": 1.1, "min": 0.8, "max": 2.0, "step": 0.05},
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "inteliweb/text"
    DESCRIPTION = (
        "Lightweight visual label for documenting workflows. Double-click the "
        "label or use Edit Label from the context menu to change its appearance."
    )
    SEARCH_ALIASES = ["Label", "Workflow Label", "Text Label", "Note"]

    @staticmethod
    def noop(**_kwargs):
        return ()
