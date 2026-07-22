from .system_check import InteliwebSystemCheck
from .purge_vram import InteliwebPurgeVRAM
from .input_switch import InteliwebInputSwitch
from .replace_text_multi import InteliwebReplaceTextMulti

# Registers the scanner-friendly /inteliweb/resource_monitor endpoint.
from . import resource_monitor as _resource_monitor  # noqa: F401

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
    "InteliwebPurgeVRAM": InteliwebPurgeVRAM,
    "InteliwebInputSwitch": InteliwebInputSwitch,
    "InteliwebReplaceTextMulti": InteliwebReplaceTextMulti,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
    "InteliwebPurgeVRAM": "Free Memory (Inteliweb)",
    "InteliwebInputSwitch": "Input Switch (Inteliweb)",
    "InteliwebReplaceTextMulti": "Replace Text Multi - Inteliweb",
}

import os as _os

WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
