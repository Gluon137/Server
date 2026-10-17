"""Continuous nominal-solid regression checks; run with .baustein-venv/bin/python."""
import importlib.util
import math
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / 'website/box-studio/backend/motion.py'
spec = importlib.util.spec_from_file_location('box_motion', PATH)
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)


def part(name, x=0, y=0, z=0, width=1, height=1, thickness=1, holes=None):
    return {'id': name, 'nominal': [[0, 0], [width, 0], [width, height], [0, height]],
            'nominalHoles': holes or [], 'thickness': thickness,
            'frame': {'origin': [x, y, z], 'u': [1, 0, 0], 'v': [0, 1, 0], 'normal': [0, 0, 1]}}


def slider(ids=('moving',), low=0, high=10, value=0, axis=(1, 0, 0)):
    return {'id': 'slide', 'type': 'slider', 'partIds': list(ids), 'axis': list(axis),
            'pivot': [0, 0, 0], 'min': low, 'max': high, 'value': value, 'contacts': []}


def rotor(ids=('moving',), low=0, high=90, value=0, pivot=(0, 0, 0)):
    joint = slider(ids, low, high, value, (0, 0, 1))
    joint.update(id='rotate', type='revolute', pivot=list(pivot))
    return joint


class MotionChecks(unittest.TestCase):
    def test_clear_static_and_boundary_touch(self):
        self.assertEqual(motion.check_project([part('a'), part('b', x=1)], [])['status'], 'clear')

    def test_static_containment(self):
        result = motion.check_project([part('a', width=10, height=10, thickness=10), part('b', x=4, y=4, z=4)], [])
        self.assertEqual(result['status'], 'collision')
        self.assertEqual(result['errors'][0]['partIds'], ['a', 'b'])

    def test_hole_is_not_filled_by_decomposition(self):
        holes = [[[2, 2], [8, 2], [8, 8], [2, 8]]]
        plate = part('plate', width=10, height=10, holes=holes)
        self.assertEqual(motion.check_project([plate, part('inside-hole', x=3, y=3)], [])['status'], 'clear')
        self.assertEqual(motion.check_project([plate, part('on-material', x=1, y=3, width=2)], [])['status'], 'collision')

    def test_slider_collision_between_clear_frames(self):
        # Deliberately narrower than a conventional fixed 20-frame sampling step.
        result = motion.check_project([part('moving', width=.001), part('fixed', x=3.123, width=.001)], [slider()])
        self.assertEqual(result['status'], 'collision')
        self.assertGreater(result['results'][0]['value'], 3.12)

    def test_clear_slider_and_tangent_support_plane(self):
        result = motion.check_project([part('moving'), part('fixed', x=4, z=1)], [slider()])
        self.assertEqual(result['status'], 'clear')

    def test_negative_slider_interval(self):
        result = motion.check_project([part('moving'), part('fixed', x=-4)], [slider(low=-10, high=0)])
        self.assertEqual(result['status'], 'collision')

    def test_revolute_collision_at_distant_pivot(self):
        angle = math.radians(22.345)
        moving = part('moving', x=100, width=.01, height=.01, thickness=.1)
        obstacle = part('fixed', x=100 * math.cos(angle) - .003,
                        y=100 * math.sin(angle) - .003, width=.02, height=.02, thickness=.1)
        result = motion.check_project([moving, obstacle], [rotor()], max_work=100000)
        self.assertEqual(result['status'], 'collision')

    def test_clear_revolute(self):
        result = motion.check_project([part('moving', x=10), part('fixed', x=30)], [rotor()])
        self.assertEqual(result['status'], 'clear')

    def test_revolution_wrap_extrema(self):
        result = motion.check_project([part('moving', x=10), part('fixed', x=-11)], [rotor(low=-10, high=370)])
        self.assertEqual(result['status'], 'collision')

    def test_work_budget_never_proves_clear(self):
        result = motion.check_project([part('moving'), part('fixed', x=5)], [slider()], max_work=0)
        self.assertEqual(result['status'], 'unchecked')

    def test_interval_depth_exhaustion_is_unknown(self):
        result = motion.check_project([part('moving', width=.001), part('fixed', x=3.123, width=.001)],
                                      [slider()], max_depth=0)
        self.assertEqual(result['status'], 'unchecked')

    def test_groups_other_joint_at_current_position(self):
        parts = [part('moving'), part('groupmate', y=3), part('other', x=20)]
        # Other joint's current value puts its obstacle into moving group's interval.
        result = motion.check_project(parts, [slider(('moving', 'groupmate')),
                                              dict(slider(('other',), -20, 0, -15), id='other-joint')])
        self.assertEqual(result['status'], 'collision')
        self.assertEqual(result['results'][0]['status'], 'collision')

    def test_rigid_group_internal_overlap_is_checked(self):
        result = motion.check_project([part('moving'), part('mate', x=.5)], [slider(('moving', 'mate'))])
        self.assertEqual(result['status'], 'collision')
        self.assertEqual(result['results'][0]['status'], 'collision')

    def test_group_starts_from_zero_and_current_pose_is_checked(self):
        result = motion.check_project([part('moving'), part('fixed', x=20)], [slider(low=0, high=1, value=20)])
        self.assertEqual(result['status'], 'collision')

    def test_contact_box_exempts_only_local_overlap(self):
        joint = slider(low=0, high=0)
        joint['contacts'] = [{'partIds': ['moving', 'fixed'], 'min': [.4, -.1, -.1], 'max': [1.1, 1.1, 1.1]}]
        parts = [part('moving'), part('fixed', x=.5)]
        self.assertEqual(motion.check_project(parts, [joint])['status'], 'clear')
        joint['contacts'][0]['max'][1] = .5
        self.assertEqual(motion.check_project(parts, [joint])['status'], 'collision')

    def test_contact_exemption_cannot_hide_remote_motion_collision(self):
        joint = slider()
        joint['contacts'] = [{'partIds': ['moving', 'fixed'], 'min': [-.1, -.1, -.1], 'max': [.2, 1.1, 1.1]}]
        self.assertEqual(motion.check_project([part('moving'), part('fixed', x=5)], [joint])['status'], 'collision')

    def test_curved_surface_explicitly_unchecked(self):
        curved = part('wrap')
        curved['surface'] = {'type': 'wrap', 'samples': []}
        result = motion.check_project([curved], [])
        self.assertEqual(result['status'], 'unchecked')
        self.assertIn('gebogene Oberfläche', result['messages'][0])

    def test_wrap_bands_prove_clearance_and_real_collision(self):
        wrap = part('wrap', width=10, height=2)
        wrap['surface'] = {'type': 'wrap', 'samples': [
            {'s': 0, 'x': 0, 'y': 0, 'nx': 0, 'ny': 1},
            {'s': 10, 'x': 10, 'y': 0, 'nx': -.2, 'ny': .98}], 'z': 0}
        self.assertEqual(motion.check_project([wrap, part('remote', x=5, y=5)], [])['status'], 'clear')
        self.assertEqual(motion.check_project([wrap, part('inside', x=5, y=.25, z=.25, width=.2, height=.2, thickness=.2)], [])['status'], 'collision')

    def test_invalid_nonpositive_solid_is_not_clear(self):
        self.assertEqual(motion.check_project([part('bad', thickness=0)], [])['status'], 'unchecked')

    def test_curve_boundary_tolerance_never_fabricates_clearance(self):
        curved = part('curve')
        curved['motionTolerance'] = .02
        self.assertEqual(motion.check_project([curved, part('near', x=1.01)], [])['status'], 'unchecked')
        self.assertEqual(motion.check_project([curved, part('far', x=1.1)], [])['status'], 'clear')
        self.assertEqual(motion.check_project([curved, part('deep', x=.5)], [])['status'], 'collision')

    def test_curve_tolerance_covers_continuous_motion(self):
        curved = part('moving')
        curved['motionTolerance'] = .02
        result = motion.check_project([curved, part('near', x=5, y=1.01)], [slider()])
        self.assertEqual(result['status'], 'unchecked')

    def test_uncertain_envelope_does_not_hide_later_core_collision(self):
        curved = part('curve')
        curved['motionTolerance'] = .02
        result = motion.check_project([curved, part('near', x=1.01), part('deep', x=.5)], [])
        self.assertEqual(result['status'], 'collision')
        self.assertTrue(any(error['partIds'] == ['curve', 'deep'] for error in result['errors']))

    def test_joint_checks_keep_other_joints_at_current_pose(self):
        first = slider(('moving',))
        second = dict(slider(('other',), high=2, axis=(0, 1, 0)), id='second')
        result = motion.check_project([part('moving'), part('other', x=5)], [first, second])
        self.assertEqual([r['status'] for r in result['results']], ['collision', 'clear'])

    def test_wrap_hole_preserved_and_remaining_material_collides(self):
        wrap = part('wrap', width=10, height=10,
                    holes=[[[2, 2], [8, 2], [8, 8], [2, 8]]])
        wrap['surface'] = {'type': 'wrap', 'samples': [
            {'s': 0, 'x': 0, 'y': 0, 'nx': 0, 'ny': 1},
            {'s': 10, 'x': 10, 'y': 0, 'nx': 0, 'ny': 1}], 'z': 0}
        inside = part('hole', x=3, y=.1, z=3, width=1, height=.5)
        self.assertEqual(motion.check_project([wrap, inside], [])['status'], 'clear')
        inside['frame']['origin'][0] = 1
        self.assertEqual(motion.check_project([wrap, inside], [])['status'], 'collision')

    def test_unknown_curve_does_not_hide_flat_collision(self):
        curved = part('wrap')
        curved['surface'] = {'type': 'wrap'}
        self.assertEqual(motion.check_project([curved, part('a'), part('b', x=.5)], [])['status'], 'collision')


if __name__ == '__main__':
    unittest.main()
