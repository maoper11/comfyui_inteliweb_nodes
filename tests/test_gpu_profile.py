"""Regression tests for GPU profile routing and Router-to-Router chaining."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "nodes" / "gpu_profile.py"
SPEC = importlib.util.spec_from_file_location("inteliweb_gpu_profile", MODULE_PATH)
assert SPEC and SPEC.loader
GPU_PROFILE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GPU_PROFILE)


class ModelProfileRouterTests(unittest.TestCase):
    def test_profile_input_has_priority_over_local_profile(self):
        router = GPU_PROFILE.InteliwebModelProfileRouter()

        result = router.route(
            profile="ULTRA",
            effective_profile="ULTRA • LOCAL",
            profile_in="LOW",
            low_model="low-model",
            low_text_encoder="low-clip",
            low_vae="low-vae",
            ultra_model="ultra-model",
        )

        self.assertEqual(result, ("low-model", "low-clip", "low-vae", "LOW"))

    def test_router_output_can_select_the_next_router(self):
        first = GPU_PROFILE.InteliwebModelProfileRouter()
        second = GPU_PROFILE.InteliwebModelProfileRouter()

        first_result = first.route(
            profile="MEDIUM",
            effective_profile="MEDIUM • LOCAL",
        )
        second_result = second.route(
            profile="HIGH",
            effective_profile="HIGH • LOCAL",
            profile_in=first_result[3],
            medium_model="medium-model",
            medium_text_encoder="medium-clip",
            medium_vae="medium-vae",
            high_model="high-model",
        )

        self.assertEqual(first_result[3], "MEDIUM")
        self.assertEqual(
            second_result,
            ("medium-model", "medium-clip", "medium-vae", "MEDIUM"),
        )

    def test_lazy_evaluation_requests_profile_input_before_model_inputs(self):
        router = GPU_PROFILE.InteliwebModelProfileRouter()

        first_request = router.check_lazy_status(
            profile="HIGH",
            effective_profile="HIGH • LOCAL",
            profile_in=None,
            low_model=None,
            high_model=None,
        )
        branch_request = router.check_lazy_status(
            profile="HIGH",
            effective_profile="HIGH • LOCAL",
            profile_in="LOW",
            low_model=None,
            high_model=None,
        )

        self.assertEqual(first_request, ["profile_in"])
        self.assertEqual(branch_request, ["low_model"])


if __name__ == "__main__":
    unittest.main()
