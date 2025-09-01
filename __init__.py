from .system_check import InteliwebSystemCheck

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
}

import os as _os
WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
