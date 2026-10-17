"""Independent continuous translation and recursive assembly proof checks.

Run .baustein-venv/bin/python tests/baustein-assembly.py. Polygon sections and
time intervals below never call production geometry decomposition or collision.
"""

import copy
import importlib.util
import itertools
import math
from pathlib import Path
import unittest
from unittest.mock import patch

from shapely.geometry import LineString, Polygon

SPEC = importlib.util.spec_from_file_location("assembly_existing_checks", Path(__file__).with_name("bausteine.py"))
checks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checks)
geometry = checks.geometry
CONTACT = 1e-7


def material_boxes(panel):
    """Integrate horizontal polygon sections, including holes, independently."""
    polygon = Polygon(panel["nominal"], panel.get("nominalHoles", []))
    cuts = sorted({point[1] for loop in [panel["nominal"], *panel.get("nominalHoles", [])]
                   for point in loop})
    minimum, _, maximum, _ = polygon.bounds
    boxes = []
    for low, high in zip(cuts, cuts[1:]):
        section = polygon.intersection(LineString([(minimum - 1, (low + high) / 2),
                                                  (maximum + 1, (low + high) / 2)]))
        pieces = [section] if isinstance(section, LineString) else getattr(section, "geoms", [])
        for piece in pieces:
            if not isinstance(piece, LineString) or piece.length == 0:
                continue
            bounds = [None] * 3
            bounds[checks.normal_axis(panel)] = tuple(panel["slab"])
            first, second = checks.uv_axis(panel)
            bounds[first] = (piece.bounds[0], piece.bounds[2])
            bounds[second] = (low, high)
            boxes.append(tuple(bounds))
    return boxes


def collision_interval(first, second, translation, tolerance=CONTACT):
    """Return the exact open time interval of positive box overlap on [0, 1]."""
    entry, leave = 0.0, 1.0
    for moving, fixed, velocity in zip(first, second, translation):
        if min(moving[1] - moving[0], fixed[1] - fixed[0]) <= tolerance:
            return None
        low = fixed[0] - moving[1] + tolerance
        high = fixed[1] - moving[0] - tolerance
        if velocity == 0:
            if not low < 0 < high:
                return None
            continue
        first_time, second_time = sorted((low / velocity, high / velocity))
        entry, leave = max(entry, first_time), min(leave, second_time)
        if entry >= leave:
            return None
    return (entry, leave) if entry < leave else None


def clear_translation(moving, fixed, translation):
    return all(collision_interval(first, second, translation) is None
               for first in moving for second in fixed)


def panel_box(panel_id, ranges):
    return {"id": panel_id, "axis": "z", "uvAxes": ["x", "y"], "slab": list(ranges[2]),
            "nominal": [[ranges[0][0], ranges[1][0]], [ranges[0][1], ranges[1][0]],
                        [ranges[0][1], ranges[1][1]], [ranges[0][0], ranges[1][1]]],
            "nominalHoles": [], "omitted": False}


def validate_proof(panels, steps):
    """Check every operation and recursively prove each rigid group's assembly."""
    boxes = {panel["id"]: material_boxes(panel) for panel in panels}
    expected = set(boxes)
    for first, second in itertools.combinations(expected, 2):
        assert clear_translation(boxes[first], boxes[second], [0, 0, 0]), f"Internal collision: {first}/{second}"
    model_bounds = [(min(box[axis][0] for pieces in boxes.values() for box in pieces),
                     max(box[axis][1] for pieces in boxes.values() for box in pieces)) for axis in range(3)]
    assembled = set()
    for step in steps:
        members = step.get("panelIds", [step.get("panelId")])
        assert isinstance(members, list) and members and len(members) == len(set(members)), "Invalid group members"
        assert set(members) <= expected and not set(members) & assembled, "Repeated or unknown panel"
        if "translation" in step:
            translation = step["translation"]
        else:
            translation = [0, 0, 0]
            translation["xyz".index(step["axis"])] = step["sign"] * step["distance"]
        assert len(translation) == 3 and all(type(value) in (int, float) and math.isfinite(value)
                                             for value in translation), "Invalid translation"
        assert any(translation), "Zero translation"
        moving = [box for member in members for box in boxes[member]]
        separated = any(max(box[axis][1] for box in moving) + translation[axis] <= model_bounds[axis][0] + CONTACT
                        or min(box[axis][0] for box in moving) + translation[axis] >= model_bounds[axis][1] - CONTACT
                        for axis in range(3))
        assert separated, "Translation does not reach outside the assembly"
        obstacles = [box for member in assembled for box in boxes[member]]
        assert clear_translation(moving, obstacles, translation), f"Blocked continuous sweep: {members}"
        if len(members) > 1:
            assert step.get("steps"), "Preassembled group has no internal proof"
            validate_proof([panel for panel in panels if panel["id"] in members], step["steps"])
        else:
            assert not step.get("steps"), "Singleton has unexpected internal proof"
        assembled.update(members)
    assert assembled == expected, "Assembly proof omits panels"


def validate_assembly_result(result):
    panels = [panel for panel in result["panels"] if not panel["omitted"]]
    validate_proof(panels, result["assemblySteps"])
    leaves = []
    flattened = []

    def collect(steps):
        for step in steps:
            if step.get("steps"):
                collect(step["steps"])
            else:
                leaves.extend(step.get("panelIds", [step.get("panelId")]))
            if "translation" in step:
                flattened.append((step.get("panelIds", [step.get("panelId")]), step["translation"]))

    collect(result["assemblySteps"])
    assert leaves == result["assembly"], "Assembly list differs from recursive leaf order"
    if "assemblyOperations" in result:
        assert flattened == [(operation["panelIds"], operation["translation"])
                             for operation in result["assemblyOperations"]], "Timeline differs from recursive proof"
        validate_staged_operations(panels, result["assemblyOperations"])
    return True


def validate_staged_operations(panels, operations):
    """Replay staged preassembly in global coordinates against every built part."""
    boxes = {panel["id"]: material_boxes(panel) for panel in panels}
    offsets = {panel_id: [0, 0, 0] for panel_id in boxes}
    for operation in operations:
        for panel_id in operation["panelIds"]:
            assert panel_id in offsets, "Unknown operation member"
            offsets[panel_id] = [offset + delta for offset, delta in zip(offsets[panel_id], operation["translation"])]
    built = set()

    def shifted(panel_id):
        return [tuple((low + shift, high + shift) for (low, high), shift in zip(box, offsets[panel_id]))
                for box in boxes[panel_id]]

    for operation in operations:
        members = set(operation["panelIds"])
        assert members and len(members) == len(operation["panelIds"]), "Invalid timeline members"
        assert operation["kind"] in ("panel", "preassembly", "group"), "Unknown operation kind"
        if operation["kind"] == "group":
            assert len(members) > 1 and members <= built, "Group moved before its members were constructed"
        else:
            assert len(members) == 1 and not members & built, "Panel built twice"
        moving = [box for panel_id in members for box in shifted(panel_id)]
        fixed = [box for panel_id in built - members for box in shifted(panel_id)]
        translation = [-value for value in operation["translation"]]
        assert clear_translation(moving, fixed, translation), f"Staged continuous collision: {operation}"
        for panel_id in members:
            offsets[panel_id] = [offset + delta for offset, delta in zip(offsets[panel_id], translation)]
        built.update(members)
    assert built == set(boxes), "Timeline omits panels"
    assert all(abs(value) <= CONTACT for offset in offsets.values() for value in offset), "Timeline ends outside final positions"


def tower_project(width=60):
    value = checks.project()
    value["axes"] = {"x": [width] * 3, "y": [width] * 3, "z": [width] * 2}
    value["cells"] = [[x, y, 0] for x in range(3) for y in range(3)]
    value["cells"] += [[x, y, 1] for x in (0, 2) for y in (0, 2)]
    value["layout"].update(width=1000, height=800)
    return value


def plus_project():
    value = checks.project()
    value["axes"] = {"x": [60] * 5, "y": [60] * 5, "z": [60]}
    value["cells"] = [[x, y, 0] for x in range(5) for y in range(5) if x == 2 or y == 2]
    value["layout"].update(width=1000, height=800)
    return value


class IndependentOracleTests(unittest.TestCase):
    def test_horizontal_sections_preserve_holes_and_volume(self):
        panel = panel_box("holed", [(0, 4), (0, 4), (0, 2)])
        panel["nominalHoles"] = [[[1, 1], [1, 3], [3, 3], [3, 1]]]
        pieces = material_boxes(panel)
        volume = sum(math.prod(high - low for low, high in box) for box in pieces)
        self.assertEqual(volume, 24)
        self.assertTrue(clear_translation(pieces, [((1, 3), (1, 3), (0, 2))], [0, 0, 0]))

    def test_diagonal_midpath_collision_with_clear_endpoints(self):
        moving = ((0, 1), (0, 1), (0, 1))
        obstacle = ((4, 5), (4, 5), (0, 1))
        self.assertTrue(clear_translation([moving], [obstacle], [0, 0, 0]))
        endpoint = tuple((low + shift, high + shift) for (low, high), shift in zip(moving, [8, 8, 0]))
        self.assertTrue(clear_translation([endpoint], [obstacle], [0, 0, 0]))
        self.assertFalse(clear_translation([moving], [obstacle], [8, 8, 0]))

    def test_tangent_motion_and_negative_zero_components(self):
        moving = ((0, 1), (0, 1), (0, 1))
        tangent = ((4, 5), (6, 7), (0, 1))
        self.assertTrue(clear_translation([moving], [tangent], [8, 8, 0]))
        obstacle = ((-5, -4), (-5, -4), (0, 1))
        self.assertFalse(clear_translation([moving], [obstacle], [-8, -8, 0]))
        self.assertTrue(clear_translation([moving], [((4, 5), (4, 5), (1, 2))], [8, 8, 0]))

    def test_thin_feature_between_sample_times(self):
        moving = ((0, .000002), (0, 1), (0, 1))
        obstacle = ((4.123456, 4.123458), (0, 1), (0, 1))
        interval = collision_interval(moving, obstacle, [10, 0, 0])
        self.assertIsNotNone(interval)
        self.assertLess(interval[1] - interval[0], .000001)

    def test_group_internal_collision_and_missing_proof_are_rejected(self):
        first = panel_box("first", [(0, 1), (0, 1), (0, 1)])
        second = panel_box("second", [(2, 3), (0, 1), (0, 1)])
        group = {"panelIds": ["first", "second"], "translation": [10, 0, 0]}
        with self.assertRaisesRegex(AssertionError, "no internal proof"):
            validate_proof([first, second], [group])
        overlapping = panel_box("second", [(.5, 1.5), (0, 1), (0, 1)])
        with self.assertRaisesRegex(AssertionError, "Internal collision"):
            validate_proof([first, overlapping], [group])

    def test_recursive_group_proof_must_construct_all_members(self):
        panels = [panel_box("first", [(0, 1), (0, 1), (0, 1)]),
                  panel_box("second", [(2, 3), (0, 1), (0, 1)]),
                  panel_box("third", [(4, 5), (0, 1), (0, 1)])]
        children = [{"panelIds": ["first"], "translation": [-10, 0, 0]},
                    {"panelIds": ["second"], "translation": [0, 10, 0]}]
        group = {"panelIds": ["first", "second"], "translation": [0, 10, 0],
                 "steps": children}
        plan = [group, {"panelIds": ["third"], "translation": [10, 0, 0]}]
        validate_proof(panels, plan)
        incomplete = copy.deepcopy(plan)
        incomplete[0]["steps"].pop()
        with self.assertRaisesRegex(AssertionError, "omits panels"):
            validate_proof(panels, incomplete)
        blocked = copy.deepcopy(plan)
        blocked[0]["steps"][1]["translation"] = [-10, 0, 0]
        with self.assertRaisesRegex(AssertionError, "Blocked continuous sweep"):
            validate_proof(panels, blocked)

    def test_interval_oracle_against_independent_linear_program(self):
        try:
            from scipy.optimize import linprog
        except ImportError:
            self.skipTest("Optional independent SciPy linear program is unavailable")
        moving = ((0, 1), (0, 1), (0, 1))
        obstacles = [((4, 5), (4, 5), (0, 1)), ((4, 5), (6, 7), (0, 1)),
                     ((-5, -4), (-5, -4), (0, 1)), ((4, 5), (4, 5), (1, 2))]
        for direction in itertools.product((-8, 0, 8), repeat=3):
            for obstacle in obstacles:
                inequalities, bounds = [], []
                for first, second, velocity in zip(moving, obstacle, direction):
                    inequalities.extend([[velocity, 1], [-velocity, 1], [0, 1], [0, 1]])
                    bounds.extend([second[1] - first[0], first[1] - second[0],
                                   first[1] - first[0], second[1] - second[0]])
                solution = linprog([0, -1], A_ub=inequalities, b_ub=bounds,
                                   bounds=[(0, 1), (None, None)], method="highs")
                self.assertTrue(solution.success)
                collision = solution.x[1] > CONTACT
                self.assertEqual(collision_interval(moving, obstacle, direction) is not None, collision,
                                 (direction, obstacle, solution.x))

    def test_staged_preassembly_replays_children_before_group_insertion(self):
        panels = [panel_box("first", [(0, 1), (0, 1), (0, 1)]),
                  panel_box("second", [(2, 3), (0, 1), (0, 1)]),
                  panel_box("third", [(4, 5), (0, 1), (0, 1)])]
        operations = [{"panelIds": ["third"], "translation": [0, -10, 0], "kind": "panel"},
                      {"panelIds": ["first"], "translation": [-10, 0, 0], "kind": "preassembly"},
                      {"panelIds": ["second"], "translation": [0, 10, 0], "kind": "preassembly"},
                      {"panelIds": ["first", "second"], "translation": [0, 10, 0], "kind": "group"}]
        validate_staged_operations(panels, operations)
        blocked = copy.deepcopy(operations)
        blocked[2]["translation"] = [-10, 0, 0]
        with self.assertRaisesRegex(AssertionError, "Staged continuous collision"):
            validate_staged_operations(panels, blocked)


class ProductionTranslationTests(unittest.TestCase):
    def test_continuous_collision_cases(self):
        import assembly
        cases = [(((0, 1), (0, 1), (0, 1)), ((4, 5), (4, 5), (0, 1)), (8, 8, 0), True),
                 (((0, 1), (0, 1), (0, 1)), ((4, 5), (6, 7), (0, 1)), (8, 8, 0), False),
                 (((0, 1), (0, 1), (0, 1)), ((-5, -4), (-5, -4), (0, 1)), (-8, -8, 0), True),
                 (((0, 1), (0, 1), (0, 1)), ((4, 5), (4, 5), (1, 2)), (8, 8, 0), False),
                 (((0, .000002), (0, 1), (0, 1)), ((4.123456, 4.123458), (0, 1), (0, 1)), (10, 0, 0), True),
                 (((0, 1), (0, 1), (0, 1)), ((.5, 1.5), (0, 1), (0, 1)), (0, 0, 0), True)]
        for moving, fixed, translation, blocked in cases:
            with self.subTest(translation=translation, fixed=fixed):
                self.assertEqual(collision_interval(moving, fixed, translation) is not None, blocked)
                self.assertEqual(assembly.boxes_collide_along_translation(moving, fixed, translation), blocked)
                self.assertEqual(assembly.sweep_clear([moving], [fixed], translation), not blocked)

    def test_group_sweep_checks_every_member(self):
        import assembly
        harmless = ((0, 1), (20, 21), (0, 1))
        blocked = ((0, 1), (0, 1), (0, 1))
        obstacle = ((4, 5), (4, 5), (0, 1))
        self.assertFalse(assembly.sweep_clear([harmless, blocked], [obstacle], [8, 8, 0]))
        self.assertTrue(assembly.sweep_clear([harmless], [obstacle], [8, 8, 0]))

    def test_sub_epsilon_constant_width_is_contact_during_translation(self):
        import assembly
        for axis in range(3):
            for width in (0, CONTACT / 2, CONTACT):
                for thin_moving in (True, False):
                    moving = [(0, 1)] * 3
                    fixed = [(4, 5)] * 3
                    if thin_moving:
                        moving[axis] = (0, width)
                    else:
                        moving[axis] = (-4, -3)
                        fixed[axis] = (0, width)
                    translation = [8, 8, 8]
                    with self.subTest(axis=axis, width=width, thin_moving=thin_moving):
                        self.assertIsNone(collision_interval(moving, fixed, translation))
                        self.assertFalse(assembly.boxes_collide_along_translation(moving, fixed, translation))
                        self.assertTrue(assembly.sweep_clear([moving], [fixed], translation))


class AssemblyProofTests(unittest.TestCase):
    def assert_supported(self, value):
        result = geometry.build_project(value)
        self.assertTrue(result["valid"], result["errors"])
        panels = [panel for panel in result["panels"] if not panel["omitted"]]
        validate_assembly_result(result)
        self.assertEqual(set(result["assembly"]), {panel["id"] for panel in panels})
        self.assertEqual(len(result["assembly"]), len(panels))
        self.assertTrue(result["sheets"])
        return result

    def test_original_cube_proof_remains_continuously_valid(self):
        self.assert_supported(checks.project())

    def test_four_corner_towers_and_plus_are_manufacturable(self):
        for name, value in [("13-cell four corner towers 60 mm", tower_project()),
                            ("13-cell four corner towers 100 mm", tower_project(100)),
                            ("5x5 plus", plus_project())]:
            with self.subTest(fixture=name):
                result = self.assert_supported(value)
                if name.endswith("100 mm"):
                    self.assertEqual(result["metrics"]["dimensions"], [300, 300, 200])
                    self.assertEqual(result["metrics"]["cellCount"], 13)

    def test_search_timeout_keeps_all_manufacturing_outputs_blocked(self):
        import assembly
        with patch.object(assembly, "SEARCH_SECONDS", 0):
            result = geometry.build_project(tower_project(100))
        self.assertFalse(result["valid"])
        self.assertEqual({error["code"] for error in result["errors"]}, {"ASSEMBLY_SEARCH_LIMIT"})
        for key in ("sheets", "assembly", "assemblySteps", "assemblyOperations"):
            self.assertEqual(result[key], [], key)

    def test_natural_fixture_contains_proven_preassembled_group(self):
        value = checks.project()
        heights = [2, 3, 1, 1, 1, 1, 3, 2, 3]
        value["axes"] = {axis: [60] * 3 for axis in "xyz"}
        value["cells"] = [[x, y, z] for x in range(3) for y in range(3)
                          for z in range(heights[x * 3 + y])]
        value["layout"].update(width=1000, height=800)
        result = self.assert_supported(value)
        groups = [step for step in result["assemblySteps"] if len(step.get("panelIds", [])) > 1]
        self.assertEqual(result["metrics"]["panelCount"], 17)
        self.assertTrue(groups, "Natural fixture must exercise a real proven preassembly")
        self.assertTrue(all(step.get("steps") for step in groups))

    def test_critical_fixtures_axis_permutation_and_reflection(self):
        for source in [tower_project(), plus_project()]:
            for permutation, reflect in [((1, 2, 0), False), ((2, 0, 1), True)]:
                value = copy.deepcopy(source)
                value["axes"] = {axis: list(source["axes"]["xyz"[old]]) for axis, old in zip("xyz", permutation)}
                value["cells"] = [[cell[old] for old in permutation] for cell in source["cells"]]
                if reflect:
                    value["cells"] = [[len(value["axes"][axis]) - 1 - index for axis, index in zip("xyz", cell)]
                                      for cell in value["cells"]]
                with self.subTest(permutation=permutation, reflect=reflect, count=len(value["cells"])):
                    self.assert_supported(value)


if __name__ == "__main__":
    unittest.main(verbosity=2)
