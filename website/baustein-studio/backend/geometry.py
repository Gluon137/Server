# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded fabrication of fused orthogonal cell shells.

Nominal material is kept separate from laser centrelines. Shared edge prisms
have one common upstream Boxes.py f/F schedule; trihedral cubes belong to the
highest axis (Z, then Y, then X). Export requires disjoint panel solids and a
collision-free rigid translations, including diagonals and proven subassemblies.
"""

from collections import defaultdict
from copy import deepcopy
import math
import re
from xml.etree import ElementTree as ET

from rectpack import newPacker
from shapely.geometry import LineString, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from boxes_adapter import FingerProfiles, compensated_contour, simplify_loop
from assembly import AssemblyLocked, SearchLimit, flatten_operations, plan_assembly

AXES = "xyz"
EPS = 1e-7
FACET = re.compile(r"^(0|[1-9]\d*),(0|[1-9]\d*),(0|[1-9]\d*):([xyz]):(-1|1)$")


def default_project():
    return {
        "version": 1, "axes": {"x": [100], "y": [100], "z": [100]},
        "cells": [[0, 0, 0]], "openFaces": [],
        "joint": {"thickness": 4, "finger": 2, "space": 2, "relative": True,
                  "surroundingspaces": 2, "play": 0, "burn": 0},
        "layout": {"width": 600, "height": 400, "margin": 5,
                   "spacing": 5, "rotate": True},
    }


def _keys(value, required, path):
    if type(value) is not dict or set(value) != set(required):
        raise ValueError(f"{path}: Erwartet werden die Felder {', '.join(required)}.")


def _number(value, path, minimum=0, maximum=10000, strict=False):
    if (type(value) not in (int, float) or value > maximum
            or (value <= minimum if strict else value < minimum) or not math.isfinite(value)):
        relation = ">" if strict else "≥"
        raise ValueError(f"{path}: Endliche Zahl {relation} {minimum} und ≤ {maximum} erwartet.")


def validate_project(project):
    """Reject malformed/unbounded JSON; geometry failures belong in the result."""
    _keys(project, ("version", "axes", "cells", "openFaces", "joint", "layout"), "Projekt")
    if type(project["version"]) is not int or project["version"] != 1:
        raise ValueError("Projektversion muss 1 sein.")
    _keys(project["axes"], AXES, "axes")
    for axis in AXES:
        lengths = project["axes"][axis]
        if type(lengths) is not list or not 1 <= len(lengths) <= 32:
            raise ValueError(f"axes.{axis}: 1 bis 32 Intervalllängen erwartet.")
        for index, length in enumerate(lengths):
            _number(length, f"axes.{axis}[{index}]", minimum=0, maximum=3000, strict=True)
        if sum(lengths) > 3000:
            raise ValueError(f"axes.{axis}: Gesamtlänge darf 3000 mm nicht überschreiten.")
    cells = project["cells"]
    if type(cells) is not list or len(cells) > 512:
        raise ValueError("cells: Höchstens 512 Zellen erlaubt.")
    seen = set()
    for cell in cells:
        if type(cell) is not list or len(cell) != 3:
            raise ValueError("Jede Zelle benötigt drei Rasterindizes.")
        if any(type(index) is not int or not 0 <= index < len(project["axes"][axis])
               for axis, index in zip(AXES, cell)):
            raise ValueError("Zellindizes müssen innerhalb des Rasters liegen.")
        if tuple(cell) in seen:
            raise ValueError("Doppelte Zellen sind nicht erlaubt.")
        seen.add(tuple(cell))
    opened = project["openFaces"]
    if (type(opened) is not list or len(opened) > 3072
            or any(type(face) is not str or not FACET.fullmatch(face) for face in opened)):
        raise ValueError("openFaces: Flächenschlüssel wie '0,0,0:z:1' erwartet.")
    _keys(project["joint"], ("thickness", "finger", "space", "relative", "surroundingspaces", "play", "burn"), "joint")
    joint = project["joint"]
    _number(joint["thickness"], "joint.thickness", minimum=0.5, maximum=100)
    for key in ("finger", "space"):
        _number(joint[key], f"joint.{key}", minimum=0, maximum=1000, strict=True)
    _number(joint["surroundingspaces"], "joint.surroundingspaces", minimum=0, maximum=100)
    for key in ("play", "burn"):
        _number(joint[key], f"joint.{key}", minimum=0, maximum=100)
    if type(joint["relative"]) is not bool:
        raise ValueError("joint.relative muss boolesch sein.")
    _keys(project["layout"], ("width", "height", "margin", "spacing", "rotate"), "layout")
    layout = project["layout"]
    for key in ("width", "height"):
        _number(layout[key], f"layout.{key}", minimum=0, maximum=10000, strict=True)
    for key in ("margin", "spacing"):
        _number(layout[key], f"layout.{key}", minimum=0, maximum=1000)
    if type(layout["rotate"]) is not bool:
        raise ValueError("layout.rotate muss boolesch sein.")
    return project


def _error(errors, code, message, panels=None):
    item = {"code": code, "message": message}
    if panels:
        item["panelIds"] = [p["id"] if isinstance(p, dict) else p for p in panels]
    errors.append(item)


def _coordinates(project):
    result = []
    for axis in AXES:
        values = [0.0]
        for length in project["axes"][axis]:
            values.append(round(values[-1] + length, 8))
        result.append(values)
    return result


def _connected(cells):
    if not cells:
        return False
    unseen = set(cells)
    stack = [unseen.pop()]
    while stack:
        cell = stack.pop()
        for axis in range(3):
            for sign in (-1, 1):
                other = list(cell)
                other[axis] += sign
                other = tuple(other)
                if other in unseen:
                    unseen.remove(other)
                    stack.append(other)
    return not unseen


def _panels(project, coordinates, errors):
    cells = {tuple(cell) for cell in project["cells"]}
    groups = defaultdict(list)
    thickness = project["joint"]["thickness"]
    for cell in sorted(cells):
        for axis in range(3):
            uv_axes = [index for index in range(3) if index != axis]
            u, v = uv_axes
            for sign in (-1, 1):
                neighbour = list(cell)
                neighbour[axis] += sign
                if tuple(neighbour) in cells:
                    continue
                plane = coordinates[axis][cell[axis] + (sign == 1)]
                key = f"{cell[0]},{cell[1]},{cell[2]}:{AXES[axis]}:{sign}"
                facet = box(coordinates[u][cell[u]], coordinates[v][cell[v]],
                            coordinates[u][cell[u] + 1], coordinates[v][cell[v] + 1])
                groups[(axis, sign, plane)].append((key, facet))
    panels = []
    exposed = set()
    opened = set(project["openFaces"])
    for (axis, sign, plane), facets in sorted(groups.items()):
        merged = unary_union([polygon for _, polygon in facets])
        pieces = [merged] if isinstance(merged, Polygon) else list(merged.geoms)
        for piece in sorted(pieces, key=lambda polygon: polygon.bounds):
            if not isinstance(piece, Polygon) or piece.is_empty or piece.area < EPS:
                _error(errors, "DEGENERATE_FACE", "Eine Außenfläche ist kleiner als die geometrische Fertigungsauflösung.")
                continue
            keys = sorted(key for key, facet in facets if piece.intersection(facet).area > EPS)
            exposed.update(keys)
            piece = orient(piece, sign=1)
            panel = {
                "id": f"panel-{len(panels) + 1:03d}",
                "label": f"{AXES[axis].upper()}{'+' if sign == 1 else '−'} · {plane:g} mm",
                "axis": AXES[axis], "sign": sign, "plane": plane,
                "uvAxes": [a for a in AXES if a != AXES[axis]], "facets": keys,
                "slab": [plane - thickness, plane] if sign == 1 else [plane, plane + thickness],
                "thickness": thickness, "omitted": bool(opened.intersection(keys)),
                "_axis": axis, "_base": piece, "_shape": piece,
            }
            panels.append(panel)
            if piece.interiors:
                _error(errors, "UNSUPPORTED_HOLE", "Eine Außenplatte hat ein Loch; Tunnel und Hohlräume sind nicht freigegeben.", [panel])
    if opened - exposed:
        _error(errors, "INVALID_OPEN_FACE", "Eine geöffnete Fläche liegt nicht auf der Außenhaut des aktuellen Körpers.")
    if len(panels) > 128:
        _error(errors, "TOO_MANY_PANELS", "Mehr als 128 Außenplatten überschreiten die geprüfte Fertigungsgrenze.")
    return panels


def _world(panel, point):
    result = [0.0, 0.0, 0.0]
    result[panel["_axis"]] = panel["plane"]
    for axis, value in zip(panel["uvAxes"], point):
        result[AXES.index(axis)] = round(value, 8)
    return tuple(result)


def _seams(panels, errors):
    lines = defaultdict(list)
    for panel in panels:
        loops = [panel["_base"].exterior, *panel["_base"].interiors]
        for loop in loops:
            points = simplify_loop(loop.coords)
            for first, second in zip(points, points[1:] + points[:1]):
                a, b = _world(panel, first), _world(panel, second)
                varying = [axis for axis in range(3) if abs(a[axis] - b[axis]) > EPS]
                if len(varying) != 1:
                    _error(errors, "NON_ORTHOGONAL", "Die Außenhaut enthält eine nicht rechtwinklige Kante.")
                    continue
                axis = varying[0]
                fixed = tuple((index, a[index]) for index in range(3) if index != axis)
                lo, hi = sorted((a[axis], b[axis]))
                lines[(axis, fixed)].append((lo, hi, panel))
    seams = []
    bad = False
    for (axis, fixed), edges in sorted(lines.items()):
        cuts = sorted({bound for lo, hi, _ in edges for bound in (lo, hi)})
        for lo, hi in zip(cuts, cuts[1:]):
            owners = [panel for start, end, panel in edges if start < (lo + hi) / 2 < end]
            # Disjoint collinear edges leave empty spans; those are not shell edges.
            if not owners:
                continue
            if len(owners) != 2 or owners[0]["_axis"] == owners[1]["_axis"]:
                bad = True
                continue
            owners.sort(key=lambda panel: panel["_axis"])
            signature = (axis, fixed, tuple(panel["id"] for panel in owners))
            if seams and seams[-1]["signature"] == signature and seams[-1]["hi"] == lo:
                seams[-1]["hi"] = hi
            else:
                seams.append({"axis": axis, "fixed": fixed, "lo": lo, "hi": hi,
                              "panels": owners, "signature": signature})
    if bad:
        _error(errors, "NON_MANIFOLD", "An jeder Außenkante müssen genau zwei rechtwinklige Platten zusammentreffen.")
    corners = defaultdict(dict)
    for seam in seams:
        for bound in (seam["lo"], seam["hi"]):
            vertex = [0.0, 0.0, 0.0]
            vertex[seam["axis"]] = bound
            for index, value in seam["fixed"]:
                vertex[index] = value
            for panel in seam["panels"]:
                corners[tuple(vertex)][panel["id"]] = panel
    for vertex, owners in corners.items():
        values = list(owners.values())
        if len(values) != 3 or len({panel["_axis"] for panel in values}) != 3:
            _error(errors, "UNSUPPORTED_CORNER", "Nur Ecken mit genau drei Platten und drei Achsrichtungen sind freigegeben.", values)
    # With simple disk-like faces, this also excludes hidden cavities/genus.
    if not bad and corners and len(corners) - len(seams) + len(panels) != 2:
        _error(errors, "UNSUPPORTED_TOPOLOGY", "Die Außenhaut ist keine einzelne geschlossene Hülle ohne Tunnel oder Hohlraum.")
    return seams, corners


def _rectangle(panel, world_ranges):
    uv = [AXES.index(axis) for axis in panel["uvAxes"]]
    u, v = uv
    return box(world_ranges[u][0], world_ranges[v][0], world_ranges[u][1], world_ranges[v][1])


def _joint_material(panels, seams, corners, joint, errors):
    thickness = joint["thickness"]
    effective = thickness if joint["relative"] else 1
    if (joint["finger"] + joint["space"]) * effective < 0.1:
        _error(errors, "JOINT_DENSITY", "Zinken und Zwischenraum müssen zusammen mindestens 0,1 mm breit sein.")
        return
    profiles = FingerProfiles(joint)
    minimum_web = max(0.5, thickness / 4)
    contour_budget = sum(len(simplify_loop(panel["_base"].exterior.coords)) for panel in panels)
    if joint["play"] >= min(joint["finger"], joint["space"]) * effective / 2:
        _error(errors, "EXCESSIVE_PLAY", "Das Spiel muss kleiner als die halbe Zinken- und Zwischenraumbreite sein.")
        return
    for seam in seams:
        first, second = seam["panels"]
        if first["omitted"] or second["omitted"]:
            continue
        axis = seam["axis"]
        lo, hi = seam["lo"], seam["hi"]
        length = hi - lo - 2 * thickness
        if length <= EPS:
            _error(errors, "SHORT_SEAM", "Eine Verbindung ist kürzer als zwei Materialstärken.", [first, second])
            continue
        ranges = [None, None, None]
        ranges[axis] = (lo, hi)
        ranges[first["_axis"]] = first["slab"]
        ranges[second["_axis"]] = second["slab"]
        try:
            positive, recesses = profiles.intervals(length)
        except ValueError as exception:
            _error(errors, "JOINT_DENSITY", str(exception), [first, second])
            continue
        if (any(end - start < minimum_web - EPS for start, end in positive)
                or any(following[0] - previous[1] < minimum_web - EPS
                       for previous, following in zip(recesses, recesses[1:]))):
            _error(errors, "MINIMUM_WEB", f"Zinken und verbleibende Zwischenstege müssen mindestens {minimum_web:g} mm breit sein (nach Spiel).", [first, second])
            continue
        contour_budget += 4 * (len(positive) + len(recesses))
        if contour_budget > 12000:
            _error(errors, "GEOMETRY_COMPLEXITY", "Die Zinken überschreiten 12000 Konturpunkte; größere Zinken wählen.")
            return
        # At re-entrant edges these strips extend both walls into their common
        # prism. Convex walls already contain the same strips.
        for panel in (first, second):
            panel["_shape"] = panel["_shape"].union(_rectangle(panel, ranges))
        # The endpoint reserve includes each pair's prism, not just their
        # triple intersection: a concave trihedron has three local quadrants.
        for start, end in ((lo, lo + thickness), (hi - thickness, hi)):
            ranges[axis] = (start, end)
            first["_shape"] = first["_shape"].difference(_rectangle(first, ranges))
        ranges[axis] = (lo + thickness, hi - thickness)
        first["_shape"] = first["_shape"].difference(_rectangle(first, ranges))
        for start, end in positive:
            ranges[axis] = (lo + thickness + start, lo + thickness + end)
            first["_shape"] = first["_shape"].union(_rectangle(first, ranges))
        for start, end in recesses:
            ranges[axis] = (lo + thickness + start, lo + thickness + end)
            second["_shape"] = second["_shape"].difference(_rectangle(second, ranges))
    for owners in corners.values():
        active = [panel for panel in owners.values() if not panel["omitted"]]
        if len(active) < 2:
            continue
        ranges = [None, None, None]
        for panel in owners.values():
            ranges[panel["_axis"]] = panel["slab"]
        if any(pair is None for pair in ranges):
            continue
        winner = max(active, key=lambda panel: panel["_axis"])
        for panel in active:
            rectangle = _rectangle(panel, ranges)
            if panel is winner:
                panel["_shape"] = panel["_shape"].union(rectangle)
            else:
                panel["_shape"] = panel["_shape"].difference(rectangle)
    for panel in panels:
        shape = panel["_shape"]
        if panel["omitted"]:
            continue
        if not isinstance(shape, Polygon) or not shape.is_valid or shape.area < EPS or shape.interiors:
            _error(errors, "FRAGMENTED_PANEL", "Die Zinken würden eine Platte teilen oder ein geschlossenes Loch erzeugen.", [panel])


def _cuboids(panel):
    """Exact rectangle decomposition by horizontal scan bands."""
    shape = panel["_shape"]
    if not isinstance(shape, Polygon):
        return []
    cuts = sorted({round(y, 8) for _, y in shape.exterior.coords})
    rectangles = []
    previous = {}
    minx, _, maxx, _ = shape.bounds
    for low, high in zip(cuts, cuts[1:]):
        if high - low < EPS:
            continue
        section = shape.intersection(LineString([(minx - 1, (low + high) / 2), (maxx + 1, (low + high) / 2)]))
        pieces = [section] if isinstance(section, LineString) else list(section.geoms)
        current = {}
        for piece in pieces:
            if not isinstance(piece, LineString) or piece.length < EPS:
                continue
            left, _, right, _ = piece.bounds
            key = (round(left, 8), round(right, 8))
            if key in previous and abs(rectangles[previous[key]][3] - low) < EPS:
                position = previous[key]
                rectangles[position][3] = high
            else:
                position = len(rectangles)
                rectangles.append([left, low, right, high])
            current[key] = position
        previous = current
    boxes = []
    uv = [AXES.index(axis) for axis in panel["uvAxes"]]
    for left, low, right, high in rectangles:
        bounds = [None, None, None]
        bounds[panel["_axis"]] = tuple(panel["slab"])
        bounds[uv[0]] = (left, right)
        bounds[uv[1]] = (low, high)
        boxes.append(tuple(bounds))
    return boxes


def _positive_intersection(first, second, axes=(0, 1, 2)):
    return all(min(first[axis][1], second[axis][1]) - max(first[axis][0], second[axis][0]) > EPS for axis in axes)


def _assembly(panels, dimensions, errors, seams=()):
    active = [panel for panel in panels if not panel["omitted"]]
    cuboids = {panel["id"]: _cuboids(panel) for panel in active}
    if sum(len(value) for value in cuboids.values()) > 6000:
        _error(errors, "GEOMETRY_COMPLEXITY", "Die Materialzerlegung überschreitet 6000 Quader; größere Zinken wählen.")
        return [], []
    for index, first in enumerate(active):
        for second in active[index + 1:]:
            if any(_positive_intersection(a, b) for a in cuboids[first["id"]] for b in cuboids[second["id"]]):
                _error(errors, "MATERIAL_COLLISION", "Zwei nominale Platten überschneiden sich mit positivem Volumen.", [first, second])
    if errors:
        return [], []
    contacts = [tuple(panel["id"] for panel in seam["panels"]) for seam in seams]
    try:
        return plan_assembly(active, cuboids, dimensions, contacts)
    except SearchLimit as exception:
        _error(errors, "ASSEMBLY_SEARCH_LIMIT", str(exception))
    except AssemblyLocked as exception:
        _error(errors, "ASSEMBLY_LOCKED", "Für 26 gerade Bewegungsrichtungen und vormontierte Baugruppen bis zu drei Platten konnte keine kollisionsfreie Montage nachgewiesen werden.", exception.panel_ids)
    return [], []


def _loops(shape):
    if not isinstance(shape, Polygon):
        pieces = [piece for piece in getattr(shape, "geoms", []) if isinstance(piece, Polygon)]
        shape = max(pieces, key=lambda piece: piece.area) if pieces else Polygon()
    if shape.is_empty:
        return [], []
    shape = orient(shape, sign=1)
    return simplify_loop(shape.exterior.coords), [simplify_loop(loop.coords) for loop in shape.interiors]


def _path(outline, holes):
    result = []
    for loop in [outline, *holes]:
        if loop:
            result.append(f"M {loop[0][0]:.8f} {loop[0][1]:.8f}")
            result.extend(f"L {point[0]:.8f} {point[1]:.8f}" for point in loop[1:])
            result.append("Z")
    return " ".join(result)


def _public_panels(panels, joint, errors):
    result = []
    vertices = 0
    for panel in panels:
        nominal, nominal_holes = _loops(panel["_shape"])
        outline, holes = nominal, nominal_holes
        cut_path = _path(outline, holes)
        if nominal and not panel["omitted"] and not errors:
            try:
                outline, cut_path = compensated_contour(nominal, joint["thickness"], joint["burn"])
                compensated_holes = [compensated_contour(loop, joint["thickness"], joint["burn"]) for loop in nominal_holes]
                holes = [points for points, _ in compensated_holes]
                cut_path += "".join(" " + path for _, path in compensated_holes)
                compensated = Polygon(outline, holes)
                if not compensated.is_valid or compensated.area < EPS:
                    raise ValueError("Die Brennkorrektur erzeugt eine ungültige oder kreuzende Schnittkontur.")
            except ValueError as exception:
                _error(errors, "BURN_INVALID", str(exception), [panel])
        vertices += len(nominal) + sum(len(loop) for loop in nominal_holes)
        output = {key: value for key, value in panel.items() if not key.startswith("_")}
        output.update(outline=outline, holes=holes, nominal=nominal, nominalHoles=nominal_holes,
                      cutPath="" if panel["omitted"] else cut_path)
        result.append(output)
    if vertices > 12000:
        _error(errors, "GEOMETRY_COMPLEXITY", "Mehr als 12000 Konturpunkte überschreiten die Fertigungsgrenze; größere Zinken wählen.")
    return result


def _pack(panels, layout, errors):
    scale = 1000
    margin, spacing = layout["margin"], layout["spacing"]
    width, height = layout["width"] - 2 * margin, layout["height"] - 2 * margin
    if width <= 0 or height <= 0:
        _error(errors, "LAYOUT_TOO_SMALL", "Der Plattenrand lässt keine nutzbare Schnittfläche übrig.")
        return []
    packer = newPacker(rotation=layout["rotate"])
    active = [panel for panel in panels if not panel["omitted"]]
    rectangles = {}
    for panel in active:
        points = panel["outline"]
        min_u, max_u = min(p[0] for p in points), max(p[0] for p in points)
        min_v, max_v = min(p[1] for p in points), max(p[1] for p in points)
        w, h = math.ceil((max_u - min_u) * scale), math.ceil((max_v - min_v) * scale)
        rectangles[panel["id"]] = (w, h, min_u, min_v)
        gap = math.ceil(spacing * scale)
        packer.add_rect(w + gap, h + gap, rid=panel["id"])
    # A trailing packing gap does not consume the machine's physical sheet.
    packer.add_bin(math.floor((width + spacing) * scale), math.floor((height + spacing) * scale), count=len(active))
    packer.pack()
    packed = packer.rect_list()
    if len(packed) != len(active):
        _error(errors, "PANEL_TOO_LARGE", "Mindestens eine Schnittkontur passt nicht auf die eingestellte Materialplatte.")
        return []
    lookup = {panel["id"]: panel for panel in panels}
    grouped = defaultdict(list)
    for sheet, x, y, packed_w, packed_h, panel_id in packed:
        w, h, min_u, min_v = rectangles[panel_id]
        gap = math.ceil(spacing * scale)
        rotated = packed_w != w + gap or packed_h != h + gap
        actual_w, actual_h = (h, w) if rotated else (w, h)
        grouped[sheet].append({"panelId": panel_id, "x": x / scale + margin,
                               "y": y / scale + margin, "width": actual_w / scale,
                               "height": actual_h / scale, "rotated": rotated})
    sheets = []
    for index in sorted(grouped):
        svg = ET.Element("svg", xmlns="http://www.w3.org/2000/svg",
                         width=f"{layout['width']:g}mm", height=f"{layout['height']:g}mm",
                         viewBox=f"0 0 {layout['width']:g} {layout['height']:g}")
        for placement in grouped[index]:
            panel = lookup[placement["panelId"]]
            _, _, min_u, min_v = rectangles[panel["id"]]
            x, y = placement["x"], placement["y"]
            if placement["rotated"]:
                # (u,v) -> (height-v,u), followed by machine placement.
                transform = f"translate({x + placement['width']:.8f} {y:.8f}) rotate(90) translate({-min_u:.8f} {-min_v:.8f})"
            else:
                transform = f"translate({x - min_u:.8f} {y - min_v:.8f})"
            ET.SubElement(svg, "path", id=panel["id"], d=panel["cutPath"], transform=transform,
                          fill="none", stroke="black", **{"stroke-width": "0.01"})
        sheets.append({"index": index + 1, "width": layout["width"], "height": layout["height"],
                       "svg": ET.tostring(svg, encoding="unicode"), "placements": grouped[index]})
    return sheets


def build_project(project):
    validate_project(project)
    project = deepcopy(project)
    errors = []
    coordinates = _coordinates(project)
    raster_dimensions = [values[-1] for values in coordinates]
    occupied = project["cells"]
    dimensions = [round(max(coordinates[index][cell[index] + 1] for cell in occupied)
                        - min(coordinates[index][cell[index]] for cell in occupied), 8)
                  for index in range(3)] if occupied else [0, 0, 0]
    if not project["cells"]:
        _error(errors, "EMPTY_GEOMETRY", "Mindestens eine belegte Zelle ist erforderlich.")
    elif not _connected({tuple(cell) for cell in project["cells"]}):
        _error(errors, "DISCONNECTED", "Alle belegten Zellen müssen über ganze Flächen verbunden sein.")
    thickness = project["joint"]["thickness"]
    minimum_web = max(0.5, thickness / 4)
    if any(project["axes"][axis][cell[index]] < 2 * thickness + minimum_web - EPS
           for cell in occupied for index, axis in enumerate(AXES)):
        _error(errors, "THIN_CELL", f"Belegte Rasterintervalle benötigen zwei Materialstärken plus mindestens {minimum_web:g} mm verbleibenden Steg.")
    panels = _panels(project, coordinates, errors)
    seams, corners = _seams(panels, errors) if panels else ([], {})
    if panels and all(panel["omitted"] for panel in panels):
        _error(errors, "NO_PANELS", "Mindestens eine Außenplatte muss erhalten bleiben.")
    if not errors:
        _joint_material(panels, seams, corners, project["joint"], errors)
    public = _public_panels(panels, project["joint"], errors)
    assembly, steps = _assembly(panels, raster_dimensions, errors, seams) if not errors else ([], [])
    sheets = _pack(public, project["layout"], errors) if not errors else []
    if errors:
        sheets = []
        assembly, steps = [], []
    return {"valid": not errors, "errors": errors, "panels": public, "assembly": assembly,
            "assemblySteps": steps, "assemblyOperations": flatten_operations(steps), "sheets": sheets,
            "metrics": {"dimensions": dimensions, "cellCount": len(project["cells"]),
                        "panelCount": sum(not panel["omitted"] for panel in panels), "sheetCount": len(sheets)}}
