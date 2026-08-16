from .nodes import (
    InteliwebImageCompare,
    InteliwebInputSwitch,
    InteliwebLabel,
    InteliwebLoraStack,
    InteliwebPromptList,
    InteliwebPurgeVRAM,
    InteliwebReplaceTextMulti,
    InteliwebSeed,
    InteliwebStringIndexSelector,
    InteliwebSystemCheck,
)
from .nodes.gpu_profile import (
    InteliwebGPUProfileSelector,
    InteliwebModelProfileRouter,
)

# Keep every node under one consistently capitalized top-level category.
InteliwebSystemCheck.CATEGORY = "Inteliweb/Utils"
InteliwebPurgeVRAM.CATEGORY = "Inteliweb/Utils"
InteliwebInputSwitch.CATEGORY = "Inteliweb/Utils"
InteliwebSeed.CATEGORY = "Inteliweb/Utils"
InteliwebReplaceTextMulti.CATEGORY = "Inteliweb/Text"
InteliwebPromptList.CATEGORY = "Inteliweb/Text"
InteliwebStringIndexSelector.CATEGORY = "Inteliweb/Text"
InteliwebLabel.CATEGORY = "Inteliweb/Text"
InteliwebLoraStack.CATEGORY = "Inteliweb/Loaders"
InteliwebImageCompare.CATEGORY = "Inteliweb/Image"
InteliwebGPUProfileSelector.CATEGORY = "Inteliweb/Utils"
InteliwebModelProfileRouter.CATEGORY = "Inteliweb/Loaders"

# Registers the scanner-friendly /inteliweb/resource_monitor endpoint.
from . import resource_monitor as _resource_monitor  # noqa: F401

NODE_CLASS_MAPPINGS = {
    "InteliwebSystemCheck": InteliwebSystemCheck,
    "InteliwebPurgeVRAM": InteliwebPurgeVRAM,
    "InteliwebInputSwitch": InteliwebInputSwitch,
    "InteliwebSeed": InteliwebSeed,
    "InteliwebReplaceTextMulti": InteliwebReplaceTextMulti,
    "InteliwebPromptList": InteliwebPromptList,
    "InteliwebStringIndexSelector": InteliwebStringIndexSelector,
    "InteliwebLabel": InteliwebLabel,
    "InteliwebLoraStack": InteliwebLoraStack,
    "InteliwebImageCompare": InteliwebImageCompare,
    "InteliwebGPUProfileSelector": InteliwebGPUProfileSelector,
    "InteliwebModelProfileRouter": InteliwebModelProfileRouter,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "InteliwebSystemCheck": "System Check (Inteliweb)",
    "InteliwebPurgeVRAM": "Free Memory (Inteliweb)",
    "InteliwebInputSwitch": "Input Switch (Inteliweb)",
    "InteliwebSeed": "Seed (Inteliweb)",
    "InteliwebReplaceTextMulti": "Replace Text Multi (Inteliweb)",
    "InteliwebPromptList": "Prompt List (Inteliweb)",
    "InteliwebStringIndexSelector": "String Index Selector (Inteliweb)",
    "InteliwebLabel": "Label (Inteliweb)",
    "InteliwebLoraStack": "Load LoRA Stack (Inteliweb)",
    "InteliwebImageCompare": "Image Compare (Inteliweb)",
    "InteliwebGPUProfileSelector": "GPU Profile Selector (Inteliweb)",
    "InteliwebModelProfileRouter": "Model Profile Router (Inteliweb)",
}

import os as _os

WEB_DIRECTORY = _os.path.join(_os.path.dirname(__file__), "web")
