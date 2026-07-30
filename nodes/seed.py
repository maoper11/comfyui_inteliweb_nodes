"""Seed source node with frontend-managed random/fixed behavior."""

from __future__ import annotations

import json
import secrets


SEED_MAX = 1125899906842624  # 2^50; exactly representable in JavaScript.


def _random_seed() -> int:
    """Return a positive seed in the range supported by the frontend."""
    return secrets.randbelow(SEED_MAX + 1)


class InteliwebSeed:
    """Outputs a fixed seed or a frontend-resolved random seed."""

    DESCRIPTION = (
        "The seed controls image variation. Change it to create alternatives, "
        "or reuse it with the same settings to repeat a result."
    )
    SEARCH_ALIASES = [
        "Seed Inteliweb",
        "Seed Node",
        "Random Seed",
        "Fixed Seed",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "seed_state": ("STRING", {"default": '{"seed": -1}'}),
            },
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("SEED",)
    OUTPUT_TOOLTIPS = (
        "Seed value to connect to KSampler or any other seed input.",
    )
    FUNCTION = "get_seed"
    CATEGORY = "Inteliweb/Utils"

    @classmethod
    def IS_CHANGED(cls, seed_state: str):
        """Use the resolved run seed as the cache key."""
        try:
            state = json.loads(seed_state)
            seed = int(state.get("run_seed", state.get("seed", -1)))
        except (TypeError, ValueError, json.JSONDecodeError):
            return _random_seed()
        return _random_seed() if seed == -1 else seed

    @staticmethod
    def get_seed(seed_state: str):
        """Return the resolved seed, with a server-side fallback for API calls."""
        try:
            state = json.loads(seed_state)
            seed = int(state.get("run_seed", state.get("seed", -1)))
        except (TypeError, ValueError, json.JSONDecodeError):
            seed = -1

        if seed == -1:
            seed = _random_seed()
        seed = max(0, min(SEED_MAX, seed))
        return (seed,)
