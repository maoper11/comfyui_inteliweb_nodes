"""Select one string from ten multiline string widgets by index."""

from __future__ import annotations


class InteliwebStringIndexSelector:
    """Return one of ten strings using a one-based index."""

    @classmethod
    def INPUT_TYPES(cls):
        required = {}

        for index in range(1, 11):
            required[f"string_{index}"] = (
                "STRING",
                {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": f"String option {index}.",
                },
            )

        required["index"] = (
            "INT",
            {
                "default": 1,
                "min": 1,
                "max": 10,
                "step": 1,
                "tooltip": "Selects string_1 through string_10. Uses one-based indexing.",
            },
        )

        return {"required": required}

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("string", "selected_index")
    FUNCTION = "select_string"
    CATEGORY = "inteliweb/text"
    DESCRIPTION = (
        "Selects one of ten multiline strings using an index from 1 to 10. "
        "All STRING widgets and the index widget can be converted to input sockets."
    )
    SEARCH_ALIASES = [
        "String Index Selector",
        "String Selector",
        "Prompt Selector",
        "Indexed String",
    ]

    @staticmethod
    def select_string(index=1, **kwargs):
        try:
            selected_index = int(index)
        except (TypeError, ValueError):
            selected_index = 1

        selected_index = max(1, min(10, selected_index))
        value = kwargs.get(f"string_{selected_index}", "")
        selected_string = "" if value is None else str(value)

        return selected_string, selected_index
