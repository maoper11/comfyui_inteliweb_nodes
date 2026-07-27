"""Backend metadata registrations for the Inteliweb virtual Set/Get nodes.

The interactive behavior is implemented in ``web/SetGet_Inteliweb.js``. These
small backend definitions give ComfyUI stable display names, categories, search
metadata and help text in both Classic and Nodes 2.0. The frontend replaces the
generated node classes with virtual nodes, so these methods are not executed in
normal workflows.
"""

from __future__ import annotations


class SetInteliwebRegistration:
    """Metadata definition for the virtual Set Inteliweb node."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Inteliweb/Logic"
    DESCRIPTION = (
        "Stores a connected value under a name so it can be retrieved elsewhere "
        "in the workflow with Get Inteliweb, reducing visible cables."
    )
    SEARCH_ALIASES = [
        "Set Inteliweb",
        "Set Node",
        "Set Variable",
        "Named Variable",
        "Wireless Connection",
    ]

    @staticmethod
    def noop():
        return ()


class GetInteliwebRegistration:
    """Metadata definition for the virtual Get Inteliweb node."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Inteliweb/Logic"
    DESCRIPTION = (
        "Retrieves a value registered by Set Inteliweb without drawing a long "
        "connection across the workflow canvas."
    )
    SEARCH_ALIASES = [
        "Get Inteliweb",
        "Get Node",
        "Get Variable",
        "Named Variable",
        "Wireless Connection",
    ]

    @staticmethod
    def noop():
        return ()
