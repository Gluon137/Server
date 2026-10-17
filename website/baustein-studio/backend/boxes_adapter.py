# SPDX-License-Identifier: GPL-3.0-or-later
"""Use Boxes.py for the finger schedule and compensated laser centreline.

The studio arranges several orthogonal walls around concave solids; upstream
polygonWall only supports plain edges. We capture upstream f/F edges, then use
those same intervals on both meeting walls. No finger count formula is copied.
"""

import math

from boxes import Boxes
from boxes.drawing import Context, Surface
from boxes.edges import FingerJointEdge, FingerJointEdgeCounterPart, FingerJointSettings


def _drawing(thickness, burn=0):
    generator = Boxes()
    generator.thickness = thickness
    generator.burn = burn
    generator.tabs = 0
    generator.bedBoltSettings = (3, 5.5, 2, 20, 15)
    generator.surface = Surface()
    generator.ctx = Context(generator.surface)
    generator.ctx.set_line_width(max(2 * burn, 0.05))
    return generator


class FingerProfiles:
    def __init__(self, joint):
        self.thickness = joint["thickness"]
        factor = self.thickness if joint["relative"] else 1
        # Play is a physical clearance in mm, independent of relative widths.
        self.settings = FingerJointSettings(
            self.thickness, relative=False,
            finger=joint["finger"] * factor,
            space=joint["space"] * factor,
            surroundingspaces=joint["surroundingspaces"], play=joint["play"],
        )

    def intervals(self, length):
        """Return (positive protrusions, matching negative recesses)."""
        result = []
        for edge_type in (FingerJointEdge, FingerJointEdgeCounterPart):
            generator = _drawing(self.thickness)
            edge = edge_type(generator, self.settings)
            count, _ = edge.calcFingers(length, None)
            if count > 256:
                raise ValueError("Eine Kante würde mehr als 256 Zinken erhalten.")
            edge(length)
            generator.ctx.stroke()
            path = generator.surface.parts[0].pathes[0].path
            depth = -self.thickness if edge.positive else self.thickness
            intervals = []
            for first, second in zip(path, path[1:]):
                if (first[0] in ("M", "L") and second[0] == "L"
                        and abs(first[2] - depth) < 1e-7
                        and abs(second[2] - depth) < 1e-7):
                    lo, hi = sorted((first[1], second[1]))
                    if hi - lo > 1e-7:
                        intervals.append((max(0, lo), min(length, hi)))
            if not intervals:
                raise ValueError("Die Kante ist zu kurz für einen belastbaren Zinken.")
            result.append(intervals)
        return tuple(result)


def compensated_contour(coordinates, thickness, burn):
    """Trace a closed orthogonal loop through Boxes.edge/corner burn handling."""
    points = [tuple(p) for p in coordinates]
    if points[0] == points[-1]:
        points.pop()
    if not burn:
        loop = [[round(x, 8), round(y, 8)] for x, y in points]
        path = "M " + " L ".join(f"{x:.8f} {y:.8f}" for x, y in loop) + " Z"
        return loop, path
    generator = _drawing(thickness, burn)
    first, second = points[:2]
    dx, dy = second[0] - first[0], second[1] - first[1]
    distance = math.hypot(dx, dy)
    heading = math.atan2(dy, dx)
    # Start halfway along an edge so every corner has a preceding/following
    # line in upstream faster_edges, including the polygon's closing corner.
    generator.ctx.translate((first[0] + second[0]) / 2 + burn * dy / distance,
                            (first[1] + second[1]) / 2 - burn * dx / distance)
    generator.ctx.rotate(heading)
    generator.edge(distance / 2)
    current_heading = heading
    for index in range(1, len(points) + 1):
        here, following = points[index % len(points)], points[(index + 1) % len(points)]
        dx, dy = following[0] - here[0], following[1] - here[1]
        next_heading = math.atan2(dy, dx)
        turn = (next_heading - current_heading + math.pi) % (2 * math.pi) - math.pi
        generator.corner(math.degrees(turn))
        generator.edge(math.hypot(dx, dy) / (2 if index == len(points) else 1))
        current_heading = next_heading
    generator.ctx.stroke()
    path = generator.surface.parts[0].pathes[0]
    path.faster_edges("corner")
    result = []
    svg = []
    previous = None
    for command in path.path:
        if command[0] not in ("M", "L", "C"):
            raise ValueError("Boxes.py erzeugte eine unerwartete Kontur.")
        point = [round(command[1], 8), round(command[2], 8)]
        if command[0] == "C":
            controls = [previous, command[3:5], command[5:7], command[1:3]]
            svg.append(f"C {command[3]:.8f} {command[4]:.8f} {command[5]:.8f} {command[6]:.8f} {point[0]:.8f} {point[1]:.8f}")
            # Preview points sample the actual upstream cubic; the exported
            # cutting path retains that cubic without approximation.
            for index in range(1, 9):
                t = index / 8
                weights = ((1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3)
                result.append([round(sum(weight * control[axis] for weight, control in zip(weights, controls)), 8)
                               for axis in (0, 1)])
        elif not result or point != result[-1]:
            result.append(point)
            svg.append(f"{command[0]} {point[0]:.8f} {point[1]:.8f}")
        previous = point
    if result[-1] == result[0]:
        result.pop()
    # Remove collinear midpoint and any duplicate vertices introduced by arcs.
    return simplify_loop(result), " ".join(svg) + " Z"


def compensated_loop(coordinates, thickness, burn):
    return compensated_contour(coordinates, thickness, burn)[0]


def simplify_loop(points):
    points = [list(p) for p in points]
    if points and points[0] == points[-1]:
        points.pop()
    changed = True
    while changed and len(points) > 3:
        changed = False
        keep = []
        for index, point in enumerate(points):
            previous, following = points[index - 1], points[(index + 1) % len(points)]
            cross = ((point[0] - previous[0]) * (following[1] - point[1])
                     - (point[1] - previous[1]) * (following[0] - point[0]))
            if abs(cross) < 1e-8:
                changed = True
            else:
                keep.append(point)
        points = keep
    return points
