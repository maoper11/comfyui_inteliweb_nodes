"""Multi-pair text replacement node for ComfyUI."""

from __future__ import annotations


class InteliwebReplaceTextMulti:
    """Apply up to ten sequential find/replace operations to a string."""

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "string": (
                "STRING",
                {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": "Text containing the values or placeholders to replace.",
                },
            ),
        }

        for index in range(1, 11):
            required[f"find_{index}"] = (
                "STRING",
                {
                    "default": "",
                    "multiline": False,
                    "dynamicPrompts": False,
                    "tooltip": f"Text to find for replacement {index}.",
                },
            )
            required[f"replace_{index}"] = (
                "STRING",
                {
                    "default": "",
                    "multiline": False,
                    "dynamicPrompts": False,
                    "tooltip": f"Replacement text for pair {index}.",
                },
            )

        return {"required": required}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("string",)
    FUNCTION = "replace_text"
    CATEGORY = "inteliweb/text"
    DESCRIPTION = (
        "Applies up to ten find/replace pairs sequentially. Empty find fields are "
        "ignored. Every STRING widget can be converted to an input socket."
    )
    SEARCH_ALIASES = [
        "Replace Text Multi",
        "Multi Replace",
        "Prompt Replace Multi",
        "String Replace Multi",
    ]

    @staticmethod
    def replace_text(string: str, **kwargs):
        result = "" if string is None else str(string)

        for index in range(1, 11):
            find_value = kwargs.get(f"find_{index}", "")
            replace_value = kwargs.get(f"replace_{index}", "")

            find_text = "" if find_value is None else str(find_value)
            if find_text == "":
                continue

            replace_text = "" if replace_value is None else str(replace_value)
            result = result.replace(find_text, replace_text)

        return (result,)
