from .system_check import InteliwebSystemCheck
from .purge_vram import InteliwebPurgeVRAM
from .input_switch import InteliwebInputSwitch

# Registers the scanner-friendly /inteliweb/resource_monitor endpoint.
from . import resource_monitor as _resource_monitor  # noqa: F401

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
    "InteliwebPurgeVRAM": InteliwebPurgeVRAM,
    "InteliwebInputSwitch": InteliwebInputSwitch,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
    "InteliwebPurgeVRAM": "Free Memory (Inteliweb)",
    "InteliwebInputSwitch": "Input Switch (Inteliweb)",
}

import os as _os

WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
