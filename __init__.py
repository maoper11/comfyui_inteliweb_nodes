from .system_check import InteliwebSystemCheck
from .purge_vram import InteliwebPurgeVRAM

# Registers scanner-friendly HTTP endpoints.
from . import resource_monitor as _resource_monitor  # noqa: F401
from . import photopea_bridge as _photopea_bridge  # noqa: F401

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
    "InteliwebPurgeVRAM": InteliwebPurgeVRAM,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
    "InteliwebPurgeVRAM": "Free Memory (Inteliweb)",
}

import os as _os

WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
