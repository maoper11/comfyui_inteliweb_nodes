"""Node implementations for comfyui_inteliweb_nodes."""

from .image_compare import InteliwebImageCompare
from .input_switch import InteliwebInputSwitch
from .label import InteliwebLabel
from .lora_stack import InteliwebLoraStack
from .prompt_list import InteliwebPromptList
from .purge_vram import InteliwebPurgeVRAM
from .replace_text_multi import InteliwebReplaceTextMulti
from .set_get import GetInteliwebRegistration, SetInteliwebRegistration
from .string_index_selector import InteliwebStringIndexSelector
from .system_check import InteliwebSystemCheck

__all__ = [
    "GetInteliwebRegistration",
    "InteliwebImageCompare",
    "InteliwebInputSwitch",
    "InteliwebLabel",
    "InteliwebLoraStack",
    "InteliwebPromptList",
    "InteliwebPurgeVRAM",
    "InteliwebReplaceTextMulti",
    "InteliwebStringIndexSelector",
    "InteliwebSystemCheck",
    "SetInteliwebRegistration",
]
