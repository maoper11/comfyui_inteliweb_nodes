"""Prompt list node for ComfyUI."""

from __future__ import annotations


class InteliwebPromptList:
    """Build a prompt list from up to five multiline text fields."""

    @classmethod
    def INPUT_TYPES(cls):
        prompt_widget = (
            "STRING",
            {
                "default": "",
                "multiline": True,
                "dynamicPrompts": False,
            },
        )

        return {
            "required": {
                "prompt_1": prompt_widget,
                "prompt_2": prompt_widget,
                "prompt_3": prompt_widget,
                "prompt_4": prompt_widget,
                "prompt_5": prompt_widget,
            },
            "optional": {
                "optional_prompt_list": (
                    "LIST",
                    {
                        "tooltip": "Optional existing prompt list to prepend before the five prompt fields.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("LIST", "STRING")
    RETURN_NAMES = ("prompt_list", "prompt_strings")
    OUTPUT_IS_LIST = (False, True)
    OUTPUT_TOOLTIPS = (
        "The prompts packaged as one LIST value for nodes that explicitly accept a LIST.",
        "The prompts exposed as a STRING sequence so downstream nodes execute once per prompt.",
    )
    FUNCTION = "build_prompt_list"
    CATEGORY = "inteliweb/text"
    DESCRIPTION = (
        "Creates a prompt list from five multiline fields. Empty prompts are ignored. "
        "Use prompt_strings to run downstream generation once for each prompt, or "
        "prompt_list for nodes that expect a LIST value."
    )
    SEARCH_ALIASES = ["Prompt List", "String List", "Batch Prompts", "Multiple Prompts"]

    @staticmethod
    def build_prompt_list(
        prompt_1="",
        prompt_2="",
        prompt_3="",
        prompt_4="",
        prompt_5="",
        optional_prompt_list=None,
    ):
        prompts = []

        if optional_prompt_list:
            for prompt in optional_prompt_list:
                if isinstance(prompt, str) and prompt.strip():
                    prompts.append(prompt)

        for prompt in (prompt_1, prompt_2, prompt_3, prompt_4, prompt_5):
            if isinstance(prompt, str) and prompt.strip():
                prompts.append(prompt)

        return prompts, prompts
