import unittest
import sys
import os

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai.threat_engine import threat_engine, BorderThreatEngine
from config import settings


class TestBorderThreatEngine(unittest.TestCase):
    def test_animal_low_threat_scoring(self):
        """
        Non-threat biological target (animal) outside night hours.
        → Should produce a low score and LOW priority classification.
        """
        score, level, factors, reason, rec_action = threat_engine.evaluate_threat(
            object_type="animal",
            fine_class="dog",
            zone_breached=False,
            time_hour_utc=14,  # Daytime
            frames_seen=2,
            has_persistent_track=False,
            direction_inward=False,
            ai_reliability=95
        )
        self.assertLess(score, 30)
        self.assertEqual(level, "low")
        self.assertIn("Biological quadruped", str(factors))

    def test_human_night_zone_crossing_critical(self):
        """
        Human target crossing restricted zero-tolerance zone during dark hours.
        → Should score >= 80 and classify as CRITICAL.
        """
        score, level, factors, reason, rec_action = threat_engine.evaluate_threat(
            object_type="human",
            fine_class="person",
            zone_breached=True,
            zone_name="Sector B Zero-Tolerance Zone",
            zone_severity="critical",
            time_hour_utc=2,  # Night time
            frames_seen=10,
            has_persistent_track=True,
            loitering_sec=20.0,  # Loitering stationary
            direction_inward=True,
            repeated_approach_count=2,
            ai_reliability=90
        )
        self.assertGreaterEqual(score, 80)
        self.assertEqual(level, "critical")
        self.assertIn("Human target class identified", reason)
        self.assertIn("Sector B Zero-Tolerance Zone", reason)
        self.assertIn("dark hours", reason)

    def test_score_changes_when_conditions_change(self):
        """
        Verify that score dynamically increases when night hours & loitering are added.
        """
        # Base daytime breach
        score_day, _, _, _, _ = threat_engine.evaluate_threat(
            object_type="human",
            zone_breached=True,
            time_hour_utc=12,  # Noon
            loitering_sec=0.0,
            frames_seen=3
        )

        # Same breach at night with loitering
        score_night_loiter, _, _, _, _ = threat_engine.evaluate_threat(
            object_type="human",
            zone_breached=True,
            time_hour_utc=23,  # Night
            loitering_sec=25.0,  # 25s loitering
            frames_seen=3
        )

        self.assertGreater(score_night_loiter, score_day)

    def test_environmental_penalty(self):
        """
        Degraded environmental visibility (AI reliability < 70) should apply negative score adjustment.
        """
        score_degraded, level_deg, factors_deg, _, _ = threat_engine.evaluate_threat(
            object_type="human",
            zone_breached=True,
            ai_reliability=40,  # Dehaze/fog degraded
            environmental_condition="fog"
        )
        has_penalty_factor = any(f["category"] == "Environmental Reliability Penalty" for f in factors_deg)
        self.assertTrue(has_penalty_factor)

    def test_configurable_threshold_overrides(self):
        """
        Changing configurable settings in Settings should directly adjust calculated weights.
        """
        custom_engine = BorderThreatEngine()
        custom_engine.weights["human"] = 50  # Overridden human weight

        score, _, _, _, _ = custom_engine.evaluate_threat(
            object_type="human",
            zone_breached=False,
            time_hour_utc=12
        )
        self.assertGreaterEqual(score, 50)


if __name__ == "__main__":
    unittest.main()
