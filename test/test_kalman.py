import io
import unittest
from contextlib import redirect_stdout

import numpy as np
from kalman import (
    Boat,
    Kalman,
    cov_ellipse,
    scale_factor,
    to2pi,
    to180,
    to360,
    to_lonlat,
    to_webmercator,
    topi,
)


class ProjectionTests(unittest.TestCase):
    def test_webmercator_round_trip(self):
        lon, lat = 12.5, 55.7

        x, y = to_webmercator(lon, lat)
        actual_lon, actual_lat = to_lonlat(x, y)

        self.assertAlmostEqual(actual_lon, lon)
        self.assertAlmostEqual(actual_lat, lat)

    def test_scale_factor(self):
        self.assertAlmostEqual(scale_factor(60), 0.5)


class AngleTests(unittest.TestCase):
    def test_degree_wrapping(self):
        np.testing.assert_allclose(to360(-1), 359)
        np.testing.assert_allclose(to180(180), -180)
        np.testing.assert_allclose(to180(np.array([0, 180, 270])), [0, -180, -90])

    def test_radian_wrapping(self):
        self.assertAlmostEqual(to2pi(-np.pi / 2), 3 * np.pi / 2)
        self.assertAlmostEqual(topi(np.pi), -np.pi)


class CovarianceEllipseTests(unittest.TestCase):
    def test_returns_points_for_covariance(self):
        center = np.array([3.0, -2.0])
        ellipse = cov_ellipse(center, np.diag([4.0, 1.0]), npoints=32)

        self.assertEqual(ellipse.shape, (2, 32))
        self.assertTrue(np.isfinite(ellipse).all())
        nsigma = np.sqrt(-2 * np.log(0.5))
        np.testing.assert_allclose(ellipse[:, 0], center + [2 * nsigma, 0])

    def test_invalid_covariance_returns_empty_ellipse(self):
        output = io.StringIO()
        with redirect_stdout(output):
            ellipse = cov_ellipse(np.zeros(2), np.array([[1.0, 2.0], [2.0, 1.0]]))

        self.assertEqual(ellipse.shape, (2, 0))


class KalmanTests(unittest.TestCase):
    def test_prediction_updates_state_and_covariance(self):
        kalman = Kalman([1.0, 2.0], p0=1)
        kalman.P = np.diag([4.0, 9.0])
        transition = np.array([[1.0, 1.0], [0.0, 1.0]])
        process_noise = np.diag([1.0, 2.0])

        kalman.prediction(transition, process_noise)

        np.testing.assert_allclose(kalman.x, [3.0, 2.0])
        np.testing.assert_allclose(kalman.P, [[14.0, 9.0], [9.0, 11.0]])

    def test_linear_correction_updates_state_and_covariance(self):
        kalman = Kalman([0.0], p0=1)
        kalman.P = kalman.P.astype(float)

        kalman.correction(
            z=np.array([2.0]),
            R=np.array([[1.0]]),
            H=np.array([[1.0]]),
            h=lambda x: x,
        )

        np.testing.assert_allclose(kalman.x, [1.0])
        np.testing.assert_allclose(kalman.P, [[0.5]])


class BoatTests(unittest.TestCase):
    def _boat_with_state(self, state):
        boat = Boat(qw=1 if len(state) == 6 else 0, p0=1)
        boat.x = np.array(state, dtype=float)
        boat.P = np.eye(len(state)) * 25
        boat.predict(0.1)
        return boat

    def test_4d_properties_use_ground_velocity(self):
        boat = Boat()
        boat.x = np.array([10.0, 20.0, 3.0, 4.0])

        np.testing.assert_allclose(boat.pos, [10.0, 20.0])
        np.testing.assert_allclose(boat.vtw, [3.0, 4.0])
        np.testing.assert_allclose(boat.vcr, [0.0, 0.0])
        np.testing.assert_allclose(boat.ctw, np.degrees(np.arctan2(3, 4)))
        np.testing.assert_allclose(boat.stw, 5.0)
        np.testing.assert_allclose(boat.set, 0.0)
        np.testing.assert_allclose(boat.dft, 0.0)
        np.testing.assert_allclose(boat.vog, [3.0, 4.0])
        np.testing.assert_allclose(boat.cog, np.degrees(np.arctan2(3, 4)))
        np.testing.assert_allclose(boat.sog, 5.0)

    def test_6d_properties_combine_water_velocity_and_current(self):
        boat = Boat(qw=1)
        boat.x = np.array([10.0, 20.0, 3.0, 4.0, 4.0, 3.0])

        np.testing.assert_allclose(boat.pos, [10.0, 20.0])
        np.testing.assert_allclose(boat.vtw, [3.0, 4.0])
        np.testing.assert_allclose(boat.vcr, [4.0, 3.0])
        np.testing.assert_allclose(boat.ctw, np.degrees(np.arctan2(3, 4)))
        np.testing.assert_allclose(boat.stw, 5.0)
        np.testing.assert_allclose(boat.set, np.degrees(np.arctan2(4, 3)))
        np.testing.assert_allclose(boat.dft, 5.0)
        np.testing.assert_allclose(boat.vog, [7.0, 7.0])
        np.testing.assert_allclose(boat.cog, 45.0)
        np.testing.assert_allclose(boat.sog, np.sqrt(98.0))

    def test_predict_advances_position_and_time(self):
        boat = Boat(qv=0, p0=1)
        boat.x = np.array([1.0, 2.0, 3.0, 4.0])

        boat.predict(2)

        np.testing.assert_allclose(boat.pos, [7.0, 10.0])
        self.assertEqual(boat.t, 2)

    def test_position_measurement_corrects_position(self):
        boat = Boat(qv=0, p0=1)
        boat.x = boat.x.astype(float)
        boat.P = boat.P.astype(float)
        boat.predict(1)

        boat.measure_position(10, 20, error=1)

        np.testing.assert_allclose(boat.pos, [20 / 3, 40 / 3])

    def test_velocity_measurement_corrects_course_and_speed(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_course = boat.ctw

        boat.measure_velocity(90, 6, course_error=1, speed_error=0.2)

        self.assertGreater(boat.ctw, initial_course)
        self.assertLess(boat.ctw, 90)
        self.assertGreater(boat.stw, 5)

    def test_zero_speed_measurement_corrects_speed_only(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_course = boat.ctw

        boat.measure_velocity(90, 0, speed_error=0.2)

        self.assertLess(boat.stw, 5.0)
        self.assertGreaterEqual(boat.stw, 0.0)
        np.testing.assert_allclose(boat.ctw, initial_course)

    def test_nan_course_uses_speed_measurement_only(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_course = boat.ctw

        boat.measure_velocity(float("nan"), 6, speed_error=0.2)

        self.assertGreater(boat.stw, 5.0)
        np.testing.assert_allclose(boat.ctw, initial_course)

    def test_nan_speed_uses_course_measurement_only(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_course = boat.ctw

        boat.measure_velocity(90, float("nan"), course_error=1)

        self.assertGreater(boat.ctw, initial_course)
        self.assertLess(boat.ctw, 90)
        self.assertTrue(np.isfinite(boat.x).all())

    def test_stationary_velocity_ignores_zero_speed_measurements(self):
        boat = self._boat_with_state([0.0, 0.0, 0.0, 0.0])
        initial_state = boat.x.copy()
        initial_covariance = boat.P.copy()

        boat.measure_velocity(90, 0)
        boat.measure_velocity(float("nan"), 0)

        np.testing.assert_allclose(boat.x, initial_state)
        np.testing.assert_allclose(boat.P, initial_covariance)

    def test_reset_velocity_measurement_sets_velocity(self):
        boat = self._boat_with_state([0.0, 0.0, 0.0, 0.0])

        boat.measure_velocity(90, 2, reset=True)

        np.testing.assert_allclose(boat.vtw, [2.0, 0.0], atol=1e-12)

    def test_bearing_measurement_corrects_position(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_covariance = boat.P[:2, :2].copy()

        boat.measure_bearing(0, 100, bearing=5, error=1)

        self.assertLess(boat.pos[0], 0)
        self.assertLess(np.trace(boat.P[:2, :2]), np.trace(initial_covariance))

    def test_range_measurement_corrects_distance(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_covariance = boat.P[:2, :2].copy()

        boat.measure_range(0, 100, range=110, range_error=1)

        measured_distance = np.linalg.norm(np.array([0.0, 100.0]) - boat.pos)
        self.assertGreater(measured_distance, 100)
        self.assertLess(measured_distance, 110)
        self.assertLess(np.trace(boat.P[:2, :2]), np.trace(initial_covariance))

    def test_angle_measurement_corrects_position(self):
        boat = self._boat_with_state([0.0, 0.0, 3.0, 4.0])
        initial_covariance = boat.P[:2, :2].copy()

        boat.measure_angle(0, 100, 100, 0, angle=100, error=1)

        self.assertFalse(np.allclose(boat.pos, [0.0, 0.0]))
        self.assertLess(np.trace(boat.P[:2, :2]), np.trace(initial_covariance))


if __name__ == "__main__":
    unittest.main()
