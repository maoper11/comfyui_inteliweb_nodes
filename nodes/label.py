"""Lightweight visual label node for ComfyUI workflows."""

from __future__ import annotations


class InteliwebLabel:
    """Backend registration for the visual Inteliweb label.

    The label has no execution inputs or outputs. Its visual configuration is
    stored in the workflow by the frontend under ``node.properties``. Keeping a
    real Python registration prevents ComfyUI from classifying it as a
    frontend-only node without exposing normal ComfyUI widgets behind the label.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "inteliweb/text"
    DESCRIPTION = (
        "Visual label for documenting workflows. Double-click the label or use "
        "Edit Label from the context menu to change its appearance."
    )
    SEARCH_ALIASES = ["Label", "Workflow Label", "Text Label", "Note"]

    @staticmethod
    def noop():
        return ()
