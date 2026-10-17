"""Independent geometry, assembly and SVG checks. Run: .baustein-venv/bin/python tests/bausteine.py"""

import copy
import importlib.util
import math
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

from shapely.geometry import LineString, Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "website/baustein-studio/backend"))
SPEC = importlib.util.spec_from_file_location("baustein_geometry", ROOT / "website/baustein-studio/backend/geometry.py")
geometry = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = geometry
SPEC.loader.exec_module(geometry)


def project():
    return {
        "version": 1,
        "axes": {"x": [100], "y": [100], "z": [100]},
        "cells": [[0, 0, 0]],
        "openFaces": [],
        "joint": {"thickness": 4, "finger": 2, "space": 2, "relative": True,
                  "surroundingspaces": 2, "play": 0, "burn": 0},
        "layout": {"width": 600, "height": 400, "margin": 5, "spacing": 5, "rotate": True},
    }


def l_project():
    value = project()
    value["axes"] = {"x": [100, 80], "y": [100, 70], "z": [100]}
    value["cells"] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    return value


def material(panel):
    return Polygon(panel["nominal"], panel.get("nominalHoles", []))


def uv_axis(panel):
    return ["xyz".index(axis) if isinstance(axis, str) else axis for axis in panel["uvAxes"]]


def normal_axis(panel):
    return "xyz".index(panel["axis"]) if isinstance(panel["axis"], str) else panel["axis"]


def overlap_volume(first, second, first_slab=None):
    """Integrate independent Shapely line sections of two orthogonal extrusions."""
    a, b = normal_axis(first), normal_axis(second)
    slab_a = first_slab if first_slab is not None else first["slab"]
    slab_b = second["slab"]
    if a == b:
        depth = max(0, min(slab_a[1], slab_b[1]) - max(slab_a[0], slab_b[0]))
        return depth * material(first).intersection(material(second)).area
    shared = ({0, 1, 2} - {a, b}).pop()
    polygons = [material(first), material(second)]
    positions = [uv_axis(first).index(shared), uv_axis(second).index(shared)]
    cuts = sorted({float(point[pos]) for panel, pos in zip([first, second], positions)
                   for loop in [panel["nominal"], *panel.get("nominalHoles", [])] for point in loop})
    total = 0
    for low, high in zip(cuts, cuts[1:]):
        midpoint = (low + high) / 2
        lengths = []
        for polygon, pos, slab in zip(polygons, positions, [slab_b, slab_a]):
            segment = ([(slab[0], midpoint), (slab[1], midpoint)] if pos == 1
                       else [(midpoint, slab[0]), (midpoint, slab[1])])
            lengths.append(polygon.intersection(LineString(segment)).length)
        total += (high - low) * lengths[0] * lengths[1]
    return total


class GeometryTests(unittest.TestCase):
    def test_separated_towers_do_not_create_edges_in_empty_spans(self):
        value = project()
        value["axes"] = {"x": [100] * 5, "y": [100] * 3, "z": [100] * 2}
        value["cells"] = [[x, y, 0] for x in range(5) for y in range(3)] + [[0, 2, 1], [4, 2, 1]]
        result = self.build(value)
        self.assert_no_overlap(result)
        self.assert_assembly(result)
        self.assert_layout(result, value)

    def test_independent_overlap_checker_against_cuboids(self):
        first = {"axis": "x", "uvAxes": ["y", "z"], "slab": [0, 2],
                 "nominal": [[0, 0], [5, 0], [5, 7], [0, 7]], "nominalHoles": []}
        second = {"axis": "y", "uvAxes": ["x", "z"], "slab": [1, 3],
                  "nominal": [[0, 0], [4, 0], [4, 7], [0, 7]], "nominalHoles": []}
        self.assertAlmostEqual(overlap_volume(first, second), 28)
        self.assertEqual(overlap_volume(first, second, [4, 6]), 0)
        parallel = {**first, "slab": [1, 3]}
        self.assertAlmostEqual(overlap_volume(first, parallel), 35)

    def build(self, value=None):
        result = geometry.build_project(project() if value is None else value)
        self.assertTrue(result["valid"], result.get("errors"))
        return result

    def active(self, result):
        return [panel for panel in result["panels"] if not panel["omitted"]]

    def assert_no_overlap(self, result):
        panels = self.active(result)
        for index, first in enumerate(panels):
            for second in panels[index + 1:]:
                self.assertLess(overlap_volume(first, second), 1e-6,
                                f"Positive material intersection: {first['id']} / {second['id']}")

    def assert_assembly(self, result):
        if any("axis" not in step or step.get("steps") for step in result["assemblySteps"]):
            spec = importlib.util.spec_from_file_location("assembly_checks", Path(__file__).with_name("baustein-assembly.py"))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.validate_assembly_result(result)
            return
        panels = {panel["id"]: panel for panel in self.active(result)}
        self.assertEqual(set(result["assembly"]), set(panels))
        self.assertEqual(len(result["assembly"]), len(panels))
        steps = result["assemblySteps"]
        self.assertEqual([step["panelId"] for step in steps], result["assembly"])
        remaining = dict(panels)
        bounds = [[math.inf, -math.inf] for _ in range(3)]
        for panel in result["panels"]:
            ranges = {normal_axis(panel): panel["slab"]}
            polygon_bounds = material(panel).bounds
            for index, axis in enumerate(uv_axis(panel)):
                ranges[axis] = [polygon_bounds[index], polygon_bounds[index + 2]]
            for axis, (low, high) in ranges.items():
                bounds[axis][0] = min(bounds[axis][0], low)
                bounds[axis][1] = max(bounds[axis][1], high)
        for step in reversed(steps):
            moving = remaining.pop(step["panelId"])
            axis, sign, distance = normal_axis(moving), step["sign"], step["distance"]
            self.assertEqual(normal_axis({"axis": step["axis"]}), axis)
            self.assertIn(sign, [-1, 1])
            self.assertTrue(math.isfinite(distance) and distance > 0)
            slab = moving["slab"]
            if sign > 0:
                self.assertGreaterEqual(slab[0] + distance, bounds[axis][1] - 1e-6)
                swept = [slab[0], slab[1] + distance]
            else:
                self.assertLessEqual(slab[1] - distance, bounds[axis][0] + 1e-6)
                swept = [slab[0] - distance, slab[1]]
            for fixed in remaining.values():
                self.assertLess(overlap_volume(moving, fixed, swept), 1e-6,
                                f"Removal sweep blocked: {moving['id']} / {fixed['id']}")

    def test_default_cube_and_shell_volume(self):
        result = self.build(geometry.default_project())
        self.assertEqual(len(self.active(result)), 6)
        self.assertEqual(result["metrics"]["panelCount"], 6)
        self.assertEqual(result["metrics"]["cellCount"], 1)
        value = self.build()
        self.assertEqual(value["metrics"]["dimensions"], [100, 100, 100])
        volume = sum(material(panel).area * (panel["slab"][1] - panel["slab"][0]) for panel in self.active(value))
        self.assertAlmostEqual(volume, 100 ** 3 - 92 ** 3, places=5,
                               msg="Zero-play fingers must fill the complete cube shell, including corners")
        self.assert_no_overlap(value)
        self.assert_assembly(value)
        self.assertTrue(all(step["sign"] == next(panel["sign"] for panel in value["panels"]
                                                if panel["id"] == step["panelId"])
                            for step in value["assemblySteps"]), "Convex cube uses outward removals")

    def test_open_cube(self):
        value = project()
        value["openFaces"] = ["0,0,0:z:1"]
        result = self.build(value)
        self.assertEqual(len(self.active(result)), 5)
        self.assertEqual(result["metrics"]["panelCount"], 5)
        omitted = [panel for panel in result["panels"] if panel["omitted"]]
        self.assertEqual(len(omitted), 1)
        self.assertIn("0,0,0:z:1", omitted[0]["facets"])
        self.assert_no_overlap(result)
        self.assert_assembly(result)

    def test_neighbor_cells_merge(self):
        value = project()
        value["axes"]["x"] = [100, 80]
        value["cells"].append([1, 0, 0])
        result = self.build(value)
        self.assertEqual(len(self.active(result)), 6)
        self.assertEqual(result["metrics"]["dimensions"], [180, 100, 100])
        self.assertTrue(any(len(panel["facets"]) == 2 for panel in result["panels"]))
        self.assert_no_overlap(result)
        self.assert_assembly(result)

    def test_variable_axes_l_hull(self):
        result = self.build(l_project())
        self.assertEqual(len(self.active(result)), 8)
        self.assertEqual(result["metrics"]["dimensions"], [180, 170, 100])
        self.assertEqual(result["metrics"]["cellCount"], 3)
        self.assert_no_overlap(result)
        self.assert_assembly(result)

    def test_open_l_hull_preserves_assembly(self):
        value = l_project()
        value["openFaces"] = ["0,0,0:z:1"]
        result = self.build(value)
        self.assertEqual(len(self.active(result)), 7)
        omitted = [panel for panel in result["panels"] if panel["omitted"]]
        self.assertEqual(len(omitted), 1)
        self.assertEqual(len(omitted[0]["facets"]), 3)
        self.assert_no_overlap(result)
        self.assert_assembly(result)

    def test_finite_simple_closed_nominal_loops(self):
        for value in [project(), l_project()]:
            for panel in self.build(value)["panels"]:
                for key, holes_key in [("nominal", "nominalHoles"), ("outline", "holes")]:
                    polygon = Polygon(panel[key], panel.get(holes_key, []))
                    self.assertTrue(polygon.is_valid and polygon.area > 0, panel["id"])
                    for loop in [panel[key], *panel.get(holes_key, [])]:
                        self.assertGreaterEqual(len(loop), 4)
                        self.assertTrue(all(len(point) == 2 and all(math.isfinite(c) for c in point) for point in loop))
                        edges = list(zip(loop, loop[1:] + loop[:1]))
                        self.assertTrue(all(a != b for a, b in edges), "No zero-length closure edge")
                        if key == "nominal":
                            self.assertTrue(all(abs(a[0] - b[0]) < 1e-8 or abs(a[1] - b[1]) < 1e-8
                                                for a, b in edges), "Nominal finger boundaries are orthogonal")
                self.assertIn("Z", panel["cutPath"].upper())
                self.assertAlmostEqual(panel["slab"][1] - panel["slab"][0], panel["thickness"])

    def test_open_merged_face_persists_when_dimensions_change(self):
        value = project()
        value["axes"]["x"] = [100, 80]
        value["cells"].append([1, 0, 0])
        value["openFaces"] = ["0,0,0:z:1"]
        for widths in [[100, 80], [120, 65]]:
            value["axes"]["x"] = widths
            result = self.build(value)
            omitted = [panel for panel in result["panels"] if panel["omitted"]]
            self.assertEqual(len(omitted), 1)
            self.assertEqual(set(omitted[0]["facets"]), {"0,0,0:z:1", "1,0,0:z:1"})
            self.assertEqual(len(self.active(result)), 5)

    def test_burn_changes_cut_only(self):
        value = project()
        before = self.build(value)
        value["joint"]["burn"] = .15
        after = self.build(value)
        self.assertNotEqual([sheet["svg"] for sheet in before["sheets"]], [sheet["svg"] for sheet in after["sheets"]])
        for a, b in zip(before["panels"], after["panels"]):
            self.assertEqual(a["id"], b["id"])
            self.assertEqual(a["nominal"], b["nominal"])
            self.assertEqual(a["nominalHoles"], b["nominalHoles"])
            self.assertEqual(a["slab"], b["slab"])
        self.assert_assembly(after)

    def test_relative_mode_matches_absolute_dimensions(self):
        for thickness in [4, 8]:
            relative = project()
            relative["joint"]["thickness"] = thickness
            absolute = copy.deepcopy(relative)
            absolute["joint"].update(relative=False, finger=2 * thickness, space=2 * thickness)
            a, b = self.build(relative), self.build(absolute)
            for first, second in zip(a["panels"], b["panels"]):
                self.assertLess(material(first).symmetric_difference(material(second)).area, 1e-7)

    def test_relative_dimensions_scale_with_material(self):
        value = project()
        before = self.build(value)
        value["joint"]["thickness"] *= 2
        value["axes"] = {axis: [200] for axis in "xyz"}
        after = self.build(value)
        for first, second in zip(before["panels"], after["panels"]):
            scaled = Polygon([[2 * u, 2 * v] for u, v in first["nominal"]],
                             [[[2 * u, 2 * v] for u, v in loop] for loop in first["nominalHoles"]])
            self.assertLess(scaled.symmetric_difference(material(second)).area, 1e-7)

    def test_play_creates_complementary_clearance(self):
        value = project()
        before = self.build(value)
        value["joint"]["play"] = .2
        after = self.build(value)
        a = sum(material(panel).area * panel["thickness"] for panel in self.active(before))
        b = sum(material(panel).area * panel["thickness"] for panel in self.active(after))
        self.assertLess(b, a, "Positive play must create physical clearance at mating fingers")
        self.assertTrue(any(material(first).symmetric_difference(material(second)).area > .01
                            for first, second in zip(before["panels"], after["panels"])))
        self.assert_no_overlap(after)
        self.assert_assembly(after)

    def test_cube_edges_have_alternating_complementary_fingers(self):
        result = self.build()
        panels, thickness = self.active(result), 4
        for index, first in enumerate(panels):
            for second in panels[index + 1:]:
                a, b = normal_axis(first), normal_axis(second)
                if a == b:
                    continue
                shared = ({0, 1, 2} - {a, b}).pop()
                positions = [uv_axis(first).index(shared), uv_axis(second).index(shared)]
                cuts = sorted({thickness, 100 - thickness} | {
                    point[pos] for panel, pos in zip([first, second], positions)
                    for point in panel["nominal"] if thickness < point[pos] < 100 - thickness})
                owners = []
                for low, high in zip(cuts, cuts[1:]):
                    midpoint = (low + high) / 2
                    lengths = []
                    for panel, pos, slab in zip([first, second], positions, [second["slab"], first["slab"]]):
                        line = ([(slab[0], midpoint), (slab[1], midpoint)] if pos == 1
                                else [(midpoint, slab[0]), (midpoint, slab[1])])
                        lengths.append(material(panel).intersection(LineString(line)).length)
                    self.assertAlmostEqual(sum(lengths), thickness, places=6,
                                           msg=f"Mating fingers leave a gap: {first['id']} / {second['id']}")
                    self.assertTrue(any(abs(length) < 1e-7 for length in lengths), "Fingers must be complementary")
                    owner = 0 if lengths[0] > lengths[1] else 1
                    if not owners or owners[-1] != owner:
                        owners.append(owner)
                self.assertGreaterEqual(len(owners), 4, "Each cube edge must alternate fingers between its two panels")

    def assert_layout(self, result, value):
        placed = []
        margin, spacing = value["layout"]["margin"], value["layout"]["spacing"]
        by_id = {panel["id"]: panel for panel in self.active(result)}
        for index, sheet in enumerate(result["sheets"]):
            self.assertEqual(sheet["index"], index + 1)
            self.assertEqual(sheet["width"], value["layout"]["width"])
            self.assertEqual(sheet["height"], value["layout"]["height"])
            for placement in sheet["placements"]:
                placed.append(placement["panelId"])
                x, y, width, height = [placement[key] for key in ["x", "y", "width", "height"]]
                self.assertGreaterEqual(x, margin - 1e-7)
                self.assertGreaterEqual(y, margin - 1e-7)
                self.assertLessEqual(x + width, sheet["width"] - margin + 1e-7)
                self.assertLessEqual(y + height, sheet["height"] - margin + 1e-7)
                bounds = Polygon(by_id[placement["panelId"]]["outline"], by_id[placement["panelId"]]["holes"]).bounds
                expected = [bounds[2] - bounds[0], bounds[3] - bounds[1]]
                if placement["rotated"]:
                    expected.reverse()
                # Packing bounds round outward to 0.001 mm, never inside the cut.
                for packed, contour in zip([width, height], expected):
                    self.assertGreaterEqual(packed, contour - 1e-8)
                    self.assertLess(packed, contour + .001 + 1e-8)
            for i, a in enumerate(sheet["placements"]):
                for b in sheet["placements"][i + 1:]:
                    gaps = [b["x"] - a["x"] - a["width"], a["x"] - b["x"] - b["width"],
                            b["y"] - a["y"] - a["height"], a["y"] - b["y"] - b["height"]]
                    self.assertGreaterEqual(max(gaps), spacing - 1e-7)
            svg = ET.fromstring(sheet["svg"])
            self.assertEqual(svg.tag.rsplit("}", 1)[-1], "svg")
            self.assertEqual(svg.attrib["width"], f"{sheet['width']:g}mm")
            self.assertEqual(svg.attrib["height"], f"{sheet['height']:g}mm")
            self.assertEqual([float(v) for v in svg.attrib["viewBox"].split()], [0, 0, sheet["width"], sheet["height"]])
            tags = [element.tag.rsplit("}", 1)[-1] for element in svg.iter()]
            self.assertFalse(set(tags) & {"text", "rect", "circle", "polygon", "image", "foreignObject", "script"})
            self.assertGreaterEqual(tags.count("path"), len(sheet["placements"]))
            for element in svg.iter():
                if element.tag.rsplit("}", 1)[-1] == "path":
                    self.assertIn("Z", element.attrib["d"].upper())
        self.assertCountEqual(placed, by_id)
        self.assertEqual(result["metrics"]["sheetCount"], len(result["sheets"]))

    def test_multiple_sheets_bounds_spacing_and_path_only_svg(self):
        value = project()
        value["layout"].update(width=220, height=220, margin=7, spacing=6)
        result = self.build(value)
        self.assertGreater(len(result["sheets"]), 1)
        self.assert_layout(result, value)

    def test_rotation_and_oversized_rejection(self):
        value = project()
        value["axes"] = {"x": [140], "y": [80], "z": [60]}
        value["layout"].update(width=105, height=165)
        result = self.build(value)
        self.assertTrue(any(p["rotated"] for sheet in result["sheets"] for p in sheet["placements"]))
        self.assert_layout(result, value)
        value["layout"]["rotate"] = False
        self.assert_invalid(value)
        value["layout"].update(width=50, height=50, rotate=True)
        self.assert_invalid(value)

    def assert_invalid(self, value):
        result = geometry.build_project(value)
        self.assertFalse(result["valid"])
        self.assertTrue(result["errors"])
        self.assertTrue(all(error["code"] and error["message"] for error in result["errors"]))
        self.assertEqual(result["sheets"], [], "Invalid projects cannot provide fabrication sheets")

    def test_malformed_validation(self):
        cases = [None, [], {}, {**project(), "version": True}]
        for axis_value in [True, float("nan"), float("inf"), -1, 0, "100"]:
            value = project()
            value["axes"]["x"] = [axis_value]
            cases.append(value)
        for cells in [[[True, 0, 0]], [[.5, 0, 0]], [[0, 0]], [[1, 0, 0]], [[0, 0, 0], [0, 0, 0]]]:
            value = project()
            value["cells"] = cells
            cases.append(value)
        for key, invalid in [("thickness", True), ("finger", float("nan")), ("relative", 1), ("play", -1)]:
            value = project()
            value["joint"][key] = invalid
            cases.append(value)
        value = project()
        value["layout"]["rotate"] = "yes"
        cases.append(value)
        for value in cases:
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                geometry.validate_project(value)

    def test_size_limits(self):
        cases = []
        for widths in [[100] * 33, [3001]]:
            value = project()
            value["axes"]["x"] = widths
            cases.append(value)
        value = project()
        value["axes"] = {axis: [30] * 9 for axis in "xyz"}
        value["cells"] = [[x, y, z] for x in range(9) for y in range(9) for z in range(9)]
        cases.append(value)
        for value in cases:
            with self.subTest(axes=value["axes"]), self.assertRaises(ValueError):
                geometry.validate_project(value)

    def test_disconnected_point_and_edge_contacts(self):
        for other in [[2, 0, 0], [1, 1, 0], [1, 1, 1]]:
            value = project()
            value["axes"] = {axis: [100] * 3 for axis in "xyz"}
            value["cells"] = [[0, 0, 0], other]
            with self.subTest(other=other):
                self.assert_invalid(value)

    def test_tunnels_and_cavities(self):
        tunnel = project()
        tunnel["axes"] = {"x": [60] * 3, "y": [60] * 3, "z": [60]}
        tunnel["cells"] = [[x, y, 0] for x in range(3) for y in range(3) if (x, y) != (1, 1)]
        self.assert_invalid(tunnel)
        cavity = project()
        cavity["axes"] = {axis: [60] * 3 for axis in "xyz"}
        cavity["cells"] = [[x, y, z] for x in range(3) for y in range(3) for z in range(3) if (x, y, z) != (1, 1, 1)]
        self.assert_invalid(cavity)

    def test_short_edges_and_narrow_steps(self):
        short = project()
        short["axes"]["x"] = [3]
        self.assert_invalid(short)
        narrow = l_project()
        narrow["axes"]["x"] = [100, 2]
        self.assert_invalid(narrow)

    def test_actual_fingers_and_play_preserve_minimum_web(self):
        microscopic = project()
        microscopic["axes"] = {axis: [300] for axis in "xyz"}
        microscopic["joint"].update(finger=.001, space=25)
        self.assert_invalid(microscopic)
        self.assertIn("MINIMUM_WEB", {error["code"] for error in geometry.build_project(microscopic)["errors"]})
        minimum = project()
        minimum["joint"].update(finger=.25, space=.25)
        self.build(minimum)
        minimum["joint"]["play"] = .1
        self.assert_invalid(minimum)
        self.assertIn("MINIMUM_WEB", {error["code"] for error in geometry.build_project(minimum)["errors"]})

    def test_thin_central_web_is_rejected(self):
        value = project()
        value["axes"] = {axis: [8.1] for axis in "xyz"}
        self.assert_invalid(value)
        self.assertIn("THIN_CELL", {error["code"] for error in geometry.build_project(value)["errors"]})

    def test_occupied_dimensions_ignore_unused_intervals(self):
        for widths, expected in [([100, 80], 80), ([10, 100, 20], 100)]:
            value = project()
            value["axes"]["x"] = widths
            value["cells"] = [[1, 0, 0]]
            result = self.build(value)
            self.assertEqual(result["metrics"]["dimensions"], [expected, 100, 100])
            self.assertEqual(len(self.active(result)), 6)
            self.assert_no_overlap(result)
            self.assert_assembly(result)
        value = project()
        value["cells"] = []
        result = geometry.build_project(value)
        self.assertFalse(result["valid"])
        self.assertEqual(result["metrics"]["dimensions"], [0, 0, 0])
        self.assertEqual(result["metrics"]["cellCount"], 0)
        self.assertEqual(result["sheets"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
