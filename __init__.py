from .nodes import (
    InteliwebInputSwitch,
    InteliwebPromptList,
    InteliwebPurgeVRAM,
    InteliwebReplaceTextMulti,
    InteliwebStringIndexSelector,
    InteliwebSystemCheck,
)

# Registers the scanner-friendly /inteliweb/resource_monitor endpoint.
from . import resource_monitor as _resource_monitor  # noqa: F401

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
    "InteliwebPurgeVRAM": InteliwebPurgeVRAM,
    "InteliwebInputSwitch": InteliwebInputSwitch,
    "InteliwebReplaceTextMulti": InteliwebReplaceTextMulti,
    "InteliwebPromptList": InteliwebPromptList,
    "InteliwebStringIndexSelector": InteliwebStringIndexSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
    "InteliwebPurgeVRAM": "Free Memory (Inteliweb)",
    "InteliwebInputSwitch": "Input Switch (Inteliweb)",
    "InteliwebReplaceTextMulti": "Replace Text Multi (Inteliweb)",
    "InteliwebPromptList": "Prompt List (Inteliweb)",
    "InteliwebStringIndexSelector": "String Index Selector (Inteliweb)",
}

import os as _os

WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
