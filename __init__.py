from .system_check import InteliwebSystemCheck
from .purge_vram import InteliwebPurgeVRAM

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
    "InteliwebPurgeVRAM": InteliwebPurgeVRAM,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
    "InteliwebPurgeVRAM": "Purge VRAM (Inteliweb)",
}

import os as _os
WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
