"""Complex full-build regressions; run .baustein-venv/bin/python tests/baustein-complex.py.

Uses real Boxes.py and the independent Shapely overlap/signed-sweep oracle.
Fixtures are bounded and deterministic; no random seed or reference snapshots.
"""

import copy
import importlib.util
import math
from pathlib import Path
import unittest

from shapely.geometry import Polygon

SPEC = importlib.util.spec_from_file_location("baustein_independent_checks", Path(__file__).with_name("bausteine.py"))
checks = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checks)
geometry = checks.geometry


def fixture(name):
    value = checks.project()
    if name in ("corner_towers", "four_corner_towers"):
        dimensions = (5, 4, 3)
        cells = [(x, y, 0) for x in range(5) for y in range(4)]
        towers = [(0, 0, 3), (4, 0, 2), (0, 3, 2)]
        if name == "four_corner_towers":
            towers.append((4, 3, 3))
        for x, y, height in towers:
            cells.extend((x, y, z) for z in range(1, height))
    elif name == "u_extrusion":
        dimensions = (5, 4, 2)
        cells = [(x, y, z) for x in range(5) for y in range(4) for z in range(2)
                 if x in (0, 4) or y == 0]
    elif name == "c_footprint":
        dimensions = (5, 4, 1)
        cells = [(x, y, 0) for x in range(5) for y in range(4) if x == 0 or y in (0, 3)]
    elif name == "staircase":
        dimensions = (4, 2, 4)
        cells = [(x, y, z) for x in range(4) for y in range(2) for z in range(4 - x)]
    elif name == "terraces":
        dimensions = (4, 4, 3)
        cells = [(x, y, z) for z in range(3) for x in range(4 - z) for y in range(4 - z)]
    elif name == "plus_hull":
        dimensions = (5, 5, 1)
        cells = [(x, y, 0) for x in range(5) for y in range(5) if x == 2 or y == 2]
    elif name == "t_hull":
        dimensions = (5, 4, 2)
        cells = [(x, y, z) for x in range(5) for y in range(4) for z in range(2)
                 if x == 2 or y == 3]
    else:
        raise ValueError(name)
    value["axes"] = {axis: [60] * length for axis, length in zip("xyz", dimensions)}
    value["cells"] = [list(cell) for cell in cells]
    value["layout"].update(width=1000, height=800)
    return value


FAMILIES = ("corner_towers", "u_extrusion", "c_footprint", "staircase", "terraces", "t_hull")


def transformed(value, permutation=(0, 1, 2), reflect=()):
    result = copy.deepcopy(value)
    result["axes"] = {axis: list(value["axes"]["xyz"[source]]) for axis, source in zip("xyz", permutation)}
    result["cells"] = [[cell[source] for source in permutation] for cell in value["cells"]]
    for axis in reflect:
        result["axes"]["xyz"[axis]].reverse()
        for cell in result["cells"]:
            cell[axis] = len(result["axes"]["xyz"[axis]]) - 1 - cell[axis]
    return result


def independently_blocked_panels(result):
    """Monotone removal oracle: removing an eligible panel cannot block another."""
    remaining = {panel["id"]: panel for panel in result["panels"] if not panel["omitted"]}
    bounds = [[math.inf, -math.inf] for _ in range(3)]
    for panel in remaining.values():
        polygon_bounds = checks.material(panel).bounds
        ranges = {checks.normal_axis(panel): panel["slab"]}
        for index, axis in enumerate(checks.uv_axis(panel)):
            ranges[axis] = [polygon_bounds[index], polygon_bounds[index + 2]]
        for axis, (low, high) in ranges.items():
            bounds[axis][0] = min(bounds[axis][0], low)
            bounds[axis][1] = max(bounds[axis][1], high)
    while remaining:
        eligible = []
        for panel in remaining.values():
            axis = checks.normal_axis(panel)
            for sign in (-1, 1):
                swept = ([bounds[axis][0] - panel["thickness"], panel["slab"][1]] if sign < 0
                         else [panel["slab"][0], bounds[axis][1] + panel["thickness"]])
                if all(checks.overlap_volume(panel, other, swept) < 1e-6
                       for other in remaining.values() if panel is not other):
                    eligible.append(panel["id"])
                    break
        if not eligible:
            return set(remaining)
        for panel_id in eligible:
            remaining.pop(panel_id)
    return set()


class ComplexGeometryTests(unittest.TestCase):
    # Reuse only the assertions, so the original suite's test cases are not rerun.
    active = checks.GeometryTests.active
    assert_no_overlap = checks.GeometryTests.assert_no_overlap
    assert_assembly = checks.GeometryTests.assert_assembly
    assert_layout = checks.GeometryTests.assert_layout

    def assert_supported(self, value):
        result = geometry.build_project(value)
        self.assertTrue(result["valid"], result["errors"])
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["metrics"]["cellCount"], len(value["cells"]))
        self.assert_no_overlap(result)
        self.assert_assembly(result)
        self.assert_layout(result, value)
        for panel in result["panels"]:
            for outer, holes in [("nominal", "nominalHoles"), ("outline", "holes")]:
                loops = [panel[outer], *panel[holes]]
                polygon = Polygon(panel[outer], panel[holes])
                self.assertTrue(polygon.is_valid and polygon.area > 0, panel["id"])
                for loop in loops:
                    self.assertGreaterEqual(len(loop), 4)
                    self.assertTrue(all(len(point) == 2 and all(math.isfinite(n) for n in point) for point in loop))
                    edges = list(zip(loop, loop[1:] + loop[:1]))
                    self.assertTrue(all(a != b for a, b in edges), panel["id"])
                    if outer == "nominal":
                        self.assertTrue(all(abs(a[0] - b[0]) < 1e-8 or abs(a[1] - b[1]) < 1e-8
                                            for a, b in edges), panel["id"])
            if not panel["omitted"]:
                self.assertIn("Z", panel["cutPath"].upper())
        return result

    def test_supported_complex_families(self):
        for name in FAMILIES:
            with self.subTest(family=name):
                self.assert_supported(fixture(name))

    def test_axis_permutations_and_reflections(self):
        for name in ("corner_towers", "u_extrusion", "staircase", "c_footprint"):
            value = fixture(name)
            for permutation, reflection in [((1, 2, 0), ()), ((2, 0, 1), (0,)), ((0, 1, 2), (0, 1, 2))]:
                with self.subTest(family=name, permutation=permutation, reflection=reflection):
                    changed = transformed(value, permutation, reflection)
                    result = self.assert_supported(changed)
                    self.assertEqual(result["metrics"]["dimensions"],
                                     [sum(value["axes"]["xyz"[axis]]) for axis in permutation])

    def test_decimal_unequal_raster_and_six_mm_material(self):
        for name in ("corner_towers", "c_footprint", "terraces", "t_hull"):
            value = fixture(name)
            value["joint"]["thickness"] = 6
            value["axes"] = {axis: [48.25 + index * 7.125 + offset * .375 for index in range(len(widths))]
                             for offset, (axis, widths) in enumerate(value["axes"].items())}
            with self.subTest(family=name):
                self.assert_supported(value)

    def test_openings_on_complex_merged_panels(self):
        for name, opening in [("u_extrusion", "0,0,1:z:1"), ("staircase", "0,0,0:z:-1"),
                              ("corner_towers", "0,0,0:z:-1")]:
            value = fixture(name)
            value["openFaces"] = [opening]
            with self.subTest(family=name, opening=opening):
                result = self.assert_supported(value)
                omitted = [panel for panel in result["panels"] if panel["omitted"]]
                self.assertEqual(len(omitted), 1)
                self.assertIn(opening, omitted[0]["facets"])
                self.assertGreater(len(omitted[0]["facets"]), 1)
                self.assertNotIn(omitted[0]["id"], result["assembly"])

    def test_play_and_burn_on_concave_hulls(self):
        value = fixture("c_footprint")
        before = self.assert_supported(value)
        value["joint"]["burn"] = .12
        burn = self.assert_supported(value)
        self.assertEqual([(p["nominal"], p["nominalHoles"], p["slab"]) for p in before["panels"]],
                         [(p["nominal"], p["nominalHoles"], p["slab"]) for p in burn["panels"]])
        self.assertNotEqual([sheet["svg"] for sheet in before["sheets"]], [sheet["svg"] for sheet in burn["sheets"]])
        value["joint"]["play"] = .15
        play = self.assert_supported(value)
        volume = lambda result: sum(checks.material(p).area * p["thickness"] for p in self.active(result))
        self.assertLess(volume(play), volume(before))

    def test_cell_insertion_order_cannot_change_geometry(self):
        for name in ("corner_towers", "terraces"):
            value = fixture(name)
            before = self.assert_supported(value)
            value["cells"].reverse()
            with self.subTest(family=name):
                after = self.assert_supported(value)
                self.assertEqual(before, after)

    def test_diagonal_motion_resolves_previously_normal_locked_hulls(self):
        for name in ("plus_hull", "four_corner_towers"):
            for permutation, reflection in [((0, 1, 2), ()), ((1, 2, 0), ()), ((2, 0, 1), (0, 2))]:
                with self.subTest(family=name, permutation=permutation, reflection=reflection):
                    value = transformed(fixture(name), permutation, reflection)
                    result = self.assert_supported(value)
                    blocked = independently_blocked_panels(result)
                    self.assertTrue(blocked, "The previous normal-only restriction still explains the old failure")
                    by_id = {p["id"]: p for p in result["panels"]}
                    self.assertTrue(any(len(op["panelIds"]) > 1
                                        or any(v and axis != checks.normal_axis(by_id[op["panelIds"][0]])
                                               for axis, v in enumerate(op["translation"]))
                                        for op in result["assemblyOperations"]))

    def assert_rejected(self, value, expected_code, ordinary_manifold=False):
        result = geometry.build_project(value)
        self.assertFalse(result["valid"])
        codes = {error["code"] for error in result["errors"]}
        self.assertIn(expected_code, codes)
        if ordinary_manifold:
            self.assertNotIn("NON_MANIFOLD", codes)
        self.assertEqual(result["sheets"], [])
        self.assertEqual(result["assembly"], [])
        self.assertEqual(result["assemblySteps"], [])
        return result

    def test_nontrihedral_manifold_reports_correct_corner_error(self):
        value = checks.project()
        value["axes"] = {axis: [60] * 2 for axis in "xyz"}
        value["cells"] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
        for permutation, reflection in [((0, 1, 2), ()), ((2, 0, 1), (0, 2))]:
            with self.subTest(permutation=permutation, reflection=reflection):
                self.assert_rejected(transformed(value, permutation, reflection), "UNSUPPORTED_CORNER", True)

    def test_holes_cavities_and_contacts_have_precise_diagnostics(self):
        tunnel = checks.project()
        tunnel["axes"] = {"x": [60] * 3, "y": [60] * 3, "z": [60]}
        tunnel["cells"] = [[x, y, 0] for x in range(3) for y in range(3) if (x, y) != (1, 1)]
        self.assert_rejected(tunnel, "UNSUPPORTED_HOLE", True)
        cavity = checks.project()
        cavity["axes"] = {axis: [60] * 3 for axis in "xyz"}
        cavity["cells"] = [[x, y, z] for x in range(3) for y in range(3) for z in range(3)
                           if (x, y, z) != (1, 1, 1)]
        self.assert_rejected(cavity, "UNSUPPORTED_TOPOLOGY", True)
        for cell in ([2, 0, 0], [1, 1, 0], [1, 1, 1]):
            contact = checks.project()
            contact["axes"] = {axis: [60] * 3 for axis in "xyz"}
            contact["cells"] = [[0, 0, 0], cell]
            with self.subTest(contact=cell):
                self.assert_rejected(contact, "DISCONNECTED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
