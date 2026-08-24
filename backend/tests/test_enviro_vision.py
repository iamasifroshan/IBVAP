import unittest
import sys
import os
import numpy as np
import cv2

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai.enviro_vision import enviro_vision, EnviroVisionAnalyzer


class TestEnviroVisionAnalyzer(unittest.TestCase):

    def test_normal_frame_analysis(self):
        """
        Synthesize a bright, high-contrast daylight frame.
        → Should classify as NORMAL with high AI reliability.
        """
        # Create a bright daylight frame with sharp objects (high contrast & brightness)
        grid = np.ones((400, 400, 3), dtype=np.uint8) * 160
        grid[::20, :, :] = 240
        grid[:, ::20, :] = 40

        res = enviro_vision.analyze_frame(grid)
        self.assertEqual(res["condition"], "NORMAL")
        self.assertGreaterEqual(res["ai_reliability"], 80)
        self.assertFalse(res["human_verification_required"])
        self.assertIn("Nominal operational status", res["recommendation"])

    def test_night_frame_analysis(self):
        """
        Synthesize a dark night frame (mean brightness < 35).
        → Should classify as NIGHT.
        """
        dark_frame = np.ones((400, 400, 3), dtype=np.uint8) * 20  # Dark pixel values

        res = enviro_vision.analyze_frame(dark_frame)
        self.assertEqual(res["condition"], "NIGHT")
        self.assertLess(res["brightness"], 35.0)
        self.assertIn("Night illumination mode active", res["recommendation"])

    def test_degraded_visibility_fog_dust_analysis(self):
        """
        Synthesize a low-contrast, blurred image matrix (fog / dust simulation).
        → Should classify as POSSIBLE_VISIBILITY_DEGRADATION and recommend human verification.
        """
        # Create low contrast uniform gray frame with tiny noise
        fog_frame = np.ones((400, 400, 3), dtype=np.uint8) * 120
        # Add very low contrast noise
        noise = np.random.randint(-4, 5, (400, 400, 3), dtype=np.int16)
        fog_frame = np.clip(fog_frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)

        res = enviro_vision.analyze_frame(fog_frame)
        self.assertEqual(res["condition"], "POSSIBLE_VISIBILITY_DEGRADATION")
        self.assertTrue(res["human_verification_required"])
        self.assertEqual(res["possible_causes"], "fog/dust/smoke")
        self.assertIn("Human verification recommended", res["recommendation"])


if __name__ == "__main__":
    unittest.main()
