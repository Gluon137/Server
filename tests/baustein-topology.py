"""Independent voxel topology oracle; run with .baustein-venv/bin/python.

Expected topology comes from cancelling elementary cube faces and checking
edge incidence and vertex links, never from the production panel/seam code.
This suite deliberately stops before finger fabrication and packing.
"""

from collections import Counter, defaultdict
from decimal import Decimal
from itertools import permutations, product
import math
from pathlib import Path
import random
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "website/baustein-studio/backend"))
import geometry
from shapely.geometry import box

AXES = "xyz"
PERMUTATIONS = tuple(permutations(range(3)))


def components(nodes, adjacency):
    remaining = set(nodes)
    count = 0
    while remaining:
        count += 1
        stack = [remaining.pop()]
        while stack:
            for neighbour in adjacency.get(stack.pop(), ()):
                if neighbour in remaining:
                    remaining.remove(neighbour)
                    stack.append(neighbour)
    return count


def boundary_oracle(cells):
    """Cancel shared unit faces, then check each boundary vertex's link cycle."""
    faces = {}
    for cell in cells:
        for axis in range(3):
            uv = [index for index in range(3) if index != axis]
            for side in (0, 1):
                key = (axis, cell[axis] + side, cell[uv[0]], cell[uv[1]])
                if key in faces:
                    del faces[key]
                    continue
                vertices = []
                for du, dv in ((0, 0), (1, 0), (1, 1), (0, 1)):
                    vertex = list(cell)
                    vertex[axis] += side
                    vertex[uv[0]] += du
                    vertex[uv[1]] += dv
                    vertices.append(tuple(vertex))
                faces[key] = (tuple(cell), axis, 2 * side - 1, vertices)
    edges = defaultdict(list)
    links = defaultdict(lambda: defaultdict(set))
    face_adjacency = defaultdict(set)
    for key, (_, _, _, vertices) in faces.items():
        face_edges = [tuple(sorted((vertices[index], vertices[(index + 1) % 4])))
                      for index in range(4)]
        for edge in face_edges:
            edges[edge].append(key)
        for index, vertex in enumerate(vertices):
            incoming, outgoing = face_edges[index - 1], face_edges[index]
            links[vertex][incoming].add(outgoing)
            links[vertex][outgoing].add(incoming)
    bad_edges = {edge for edge, owners in edges.items() if len(owners) != 2}
    bad_vertices = {vertex for vertex, link in links.items()
                    if any(len(neighbours) != 2 for neighbours in link.values())
                    or components(link, link) != 1}
    for owners in edges.values():
        for owner in owners:
            face_adjacency[owner].update(set(owners) - {owner})
    return {
        "faces": faces, "edges": edges,
        "bad_edges": bad_edges, "bad_vertices": bad_vertices,
        "manifold": not bad_edges and not bad_vertices,
        "components": components(faces, face_adjacency),
        "euler": len(links) - len(edges) + len(faces),
    }


def transformed(cells, dimensions, permutation, reflection):
    size = tuple(dimensions[index] for index in permutation)
    output = []
    for cell in cells:
        point = [cell[index] for index in permutation]
        output.append(tuple(size[index] - 1 - point[index]
                            if reflection & (1 << index) else point[index]
                            for index in range(3)))
    return tuple(sorted(output)), size


def make_project(cells, dimensions, decimal=False):
    value = geometry.default_project()
    value["cells"] = [list(cell) for cell in cells]
    value["axes"] = {
        axis: [28.13 + 7.17 * index + 3.11 * axis_index if decimal else 100
               for index in range(dimensions[axis_index])]
        for axis_index, axis in enumerate(AXES)
    }
    return value


def coordinates(value):
    """Compute exact decimal grid sums independently of geometry._coordinates."""
    result = []
    for axis in AXES:
        total = Decimal(0)
        values = [0.0]
        for length in value["axes"][axis]:
            total += Decimal(str(length))
            values.append(float(total))
        result.append(values)
    return result


def constructions():
    small = tuple(product(range(2), repeat=3))
    for mask in range(1, 256):
        yield f"2x2x2-mask-{mask}", tuple(cell for index, cell in enumerate(small)
                                        if mask & (1 << index)), (2, 2, 2), 6
    rng = random.Random(20261014)
    seen = set()
    while len(seen) < 300:
        cells = {tuple(rng.randrange(3) for _ in range(3))}
        target = rng.randrange(2, 28)
        while len(cells) < target:
            frontier = set()
            for cell in cells:
                for axis in range(3):
                    for step in (-1, 1):
                        other = list(cell)
                        other[axis] += step
                        if all(0 <= index < 3 for index in other):
                            frontier.add(tuple(other))
            cells.add(rng.choice(sorted(frontier - cells)))
        frozen = tuple(sorted(cells))
        if frozen not in seen:
            seen.add(frozen)
            yield f"3x3x3-grown-{len(seen)}", frozen, (3, 3, 3), 2
    # Exhaust every 3x3 arrangement of towers on an unbroken base plate.
    for mask in range(512):
        cells = tuple((x, y, z) for x in range(3) for y in range(3)
                      for z in range(1 + bool(mask & (1 << (3 * x + y)))))
        yield f"3x3-heightfield-{mask}", cells, (3, 3, 2), 1
    for index in range(48):
        heights = [[rng.randrange(1, 5) for _ in range(4)] for _ in range(5)]
        cells = tuple((x, y, z) for x in range(5) for y in range(4)
                      for z in range(heights[x][y]))
        yield f"5x4-heightfield-{index}", cells, (5, 4, 4), 2
    yield "closed-cavity", tuple(cell for cell in product(range(3), repeat=3)
                                  if cell != (1, 1, 1)), (3, 3, 3), 6
    yield "through-tunnel", tuple((x, y, z) for x in range(3) for y in range(3)
                                  for z in range(2) if (x, y) != (1, 1)), (3, 3, 2), 6
    yield "disconnected-shells", ((0, 0, 0), (2, 0, 0)), (3, 1, 1), 6
    yield "5x4-diagonal-staircase", tuple((x, y, z) for x in range(5) for y in range(4)
                                         for z in range(x + y + 1)), (5, 4, 8), 6
    yield "5x4-multiple-separated-towers", tuple((x, y, z) for x in range(5) for y in range(4)
                                                for z in range(3 if (x, y) in
                                                {(0, 0), (0, 3), (2, 1), (4, 0), (4, 3)} else 1)), (5, 4, 3), 6
    towers = tuple((x, y, 0) for x in range(5) for y in range(3)) + ((0, 2, 1), (4, 2, 1))
    yield "5x3-separated-towers-regression", towers, (5, 3, 2), 48


class BoundaryTopologyTests(unittest.TestCase):
    def assert_extraction(self, value, oracle, panels, seams, corners, errors):
        grid = coordinates(value)
        self.assertIsInstance(panels, list)
        self.assertIsInstance(seams, list)
        self.assertIsInstance(corners, dict)
        expected = {f"{cell[0]},{cell[1]},{cell[2]}:{AXES[axis]}:{sign}"
                    for cell, axis, sign, _ in oracle["faces"].values()}
        actual = Counter(facet for panel in panels for facet in panel["facets"])
        self.assertEqual(set(actual), expected)
        self.assertTrue(all(count == 1 for count in actual.values()))
        self.assertEqual(len({panel["id"] for panel in panels}), len(panels))
        by_id = {panel["id"]: panel for panel in panels}
        for panel in panels:
            self.assertTrue({"id", "axis", "sign", "plane", "uvAxes", "facets", "slab",
                             "thickness", "omitted", "_axis", "_base", "_shape"} <= panel.keys())
            axis = AXES.index(panel["axis"])
            self.assertEqual(panel["_axis"], axis)
            self.assertIn(panel["sign"], (-1, 1))
            self.assertEqual(panel["uvAxes"], [name for name in AXES if name != panel["axis"]])
            shape = panel["_base"]
            self.assertTrue(shape.is_valid and shape.area > 0)
            uv = [index for index in range(3) if index != axis]
            expected_area = 0
            for facet in panel["facets"]:
                cell_text, name, sign_text = facet.split(":")
                cell = tuple(map(int, cell_text.split(",")))
                self.assertEqual(name, panel["axis"])
                self.assertEqual(int(sign_text), panel["sign"])
                self.assertAlmostEqual(panel["plane"], grid[axis][cell[axis] + (panel["sign"] == 1)], places=7)
                lengths = [grid[a][cell[a] + 1] - grid[a][cell[a]] for a in uv]
                expected_area += math.prod(lengths)
                # Corners alone cannot prove coverage when a polygon has a hole:
                # each elementary square must be entirely contained as well.
                square = box(grid[uv[0]][cell[uv[0]]], grid[uv[1]][cell[uv[1]]],
                             grid[uv[0]][cell[uv[0]] + 1], grid[uv[1]][cell[uv[1]] + 1])
                self.assertLess(square.difference(shape).area, 1e-5)
            self.assertAlmostEqual(shape.area, expected_area, places=5)
            for loop in [shape.exterior, *shape.interiors]:
                for first, second in zip(loop.coords, list(loop.coords)[1:]):
                    self.assertTrue(all(math.isfinite(coordinate) for coordinate in first))
                    self.assertEqual(sum(abs(a - b) > 1e-7 for a, b in zip(first, second)), 1)
        for error in errors:
            self.assertTrue({"code", "message"} <= error.keys())
            self.assertIsInstance(error["message"], str)
            self.assertTrue(set(error.get("panelIds", [])) <= by_id.keys())
        for seam in seams:
            self.assertTrue({"axis", "fixed", "lo", "hi", "panels", "signature"} <= seam.keys())
            self.assertIn(seam["axis"], range(3))
            self.assertGreater(seam["hi"], seam["lo"])
            self.assertTrue(math.isfinite(seam["lo"]) and math.isfinite(seam["hi"]))
            self.assertEqual(len(seam["panels"]), 2)
            self.assertEqual(len({p["_axis"] for p in seam["panels"]}), 2)
            self.assertTrue(all(p["id"] in by_id for p in seam["panels"]))
        for vertex, owners in corners.items():
            self.assertEqual(len(vertex), 3)
            self.assertTrue(all(math.isfinite(value) for value in vertex))
            self.assertIsInstance(owners, dict)
            self.assertTrue(set(owners) <= by_id.keys())
            self.assertTrue(all(panel is by_id[panel_id] for panel_id, panel in owners.items()))
        for seam in seams:
            for bound in (seam["lo"], seam["hi"]):
                vertex = dict(seam["fixed"])
                vertex[seam["axis"]] = bound
                self.assertEqual(set(vertex), {0, 1, 2})
                self.assertIn(tuple(vertex[axis] for axis in range(3)), corners)
        if oracle["manifold"]:
            # Compare every elementary sharp edge to actual seam coverage.
            # Flat unit-face subdivision edges are intentionally excluded.
            seam_lines = defaultdict(list)
            for seam in seams:
                key = (seam["axis"], tuple((axis, round(value, 7)) for axis, value in seam["fixed"]))
                seam_lines[key].append(seam)
            expected_lengths = Counter()
            for (first, second), face_keys in oracle["edges"].items():
                faces = [oracle["faces"][key] for key in face_keys]
                if faces[0][1] == faces[1][1]:
                    continue
                axis = next(index for index in range(3) if first[index] != second[index])
                fixed = tuple((index, round(grid[index][first[index]], 7))
                              for index in range(3) if index != axis)
                low, high = grid[axis][first[axis]], grid[axis][second[axis]]
                expected_lengths[axis] += high - low
                owners = [seam for seam in seam_lines[(axis, fixed)]
                          if seam["lo"] < (low + high) / 2 < seam["hi"]]
                self.assertEqual(len(owners), 1)
                self.assertEqual({(p["_axis"], p["sign"]) for p in owners[0]["panels"]},
                                 {(face[1], face[2]) for face in faces})
            for axis in range(3):
                self.assertAlmostEqual(sum(seam["hi"] - seam["lo"] for seam in seams if seam["axis"] == axis),
                                       expected_lengths[axis], places=6)

    def test_oracle_known_topologies(self):
        fixtures = [
            (((0, 0, 0),), True, 1, 2),
            (((0, 0, 0), (1, 0, 0)), True, 1, 2),
            (((0, 0, 0), (1, 1, 0)), False, 1, None),
            (((0, 0, 0), (1, 1, 1)), False, 2, None),
            (((0, 0, 0), (2, 0, 0)), True, 2, 4),
            (tuple(cell for cell in product(range(3), repeat=3) if cell != (1, 1, 1)), True, 2, 4),
            (tuple((x, y, 0) for x in range(3) for y in range(3) if (x, y) != (1, 1)), True, 1, 0),
        ]
        for cells, manifold, count, euler in fixtures:
            with self.subTest(cells=cells):
                result = boundary_oracle(cells)
                self.assertEqual(result["manifold"], manifold)
                self.assertEqual(result["components"], count)
                if euler is not None:
                    self.assertEqual(result["euler"], euler)
        point = boundary_oracle(((0, 0, 0), (1, 1, 1)))
        self.assertFalse(point["bad_edges"])
        self.assertEqual(point["bad_vertices"], {(1, 1, 1)})

    def test_all_constructions_and_variants(self):
        counts = Counter()
        for number, (name, cells, dimensions, variants) in enumerate(constructions()):
            counts["constructions"] += 1
            for variant in range(variants):
                permutation = PERMUTATIONS[variant % 6]
                reflection = variant // 6 if variants == 48 else (number + variant) % 8
                changed, size = transformed(cells, dimensions, permutation, reflection)
                value = make_project(changed, size, decimal=bool((number + variant) % 2))
                oracle = boundary_oracle(changed)
                counts["variants"] += 1
                counts["manifold_variants"] += oracle["manifold"]
                counts["edge_nonmanifold_variants"] += bool(oracle["bad_edges"])
                counts["point_nonmanifold_variants"] += bool(oracle["bad_vertices"] and not oracle["bad_edges"])
                with self.subTest(name=name, permutation=permutation, reflection=reflection,
                                  axes=value["axes"], cells=value["cells"]):
                    geometry.validate_project(value)
                    errors = []
                    panels = geometry._panels(value, geometry._coordinates(value), errors)
                    seams, corners = geometry._seams(panels, errors)
                    codes = {error["code"] for error in errors}
                    if oracle["manifold"]:
                        self.assertNotIn("NON_MANIFOLD", codes)
                    if oracle["bad_edges"]:
                        self.assertIn("NON_MANIFOLD", codes)
                    if oracle["bad_vertices"]:
                        self.assertTrue(codes & {"NON_MANIFOLD", "UNSUPPORTED_CORNER", "UNSUPPORTED_TOPOLOGY"})
                    self.assert_extraction(value, oracle, panels, seams, corners, errors)
        self.assertEqual(counts["constructions"], 1121)
        self.assertEqual(counts["variants"], 2816)
        self.assertGreater(counts["edge_nonmanifold_variants"], 0)
        self.assertGreater(counts["point_nonmanifold_variants"], 0)
        print("Topology oracle:", ", ".join(f"{key}={value}" for key, value in counts.items()))


if __name__ == "__main__":
    unittest.main()
