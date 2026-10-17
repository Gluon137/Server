# SPDX-License-Identifier: GPL-3.0-or-later
"""Small semantic Boxes.py adapter; nominal polygons never include kerf."""
import importlib.util
import math
from pathlib import Path
from boxes.edges import FlexEdge, FlexSettings

_spec = importlib.util.spec_from_file_location('_box_shared_profiles', Path(__file__).parents[2] / 'baustein-studio/backend/boxes_adapter.py')
_shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_shared)
FingerProfiles = _shared.FingerProfiles
_drawing = _shared._drawing


def path_commands(generator):
    generator.ctx.stroke()
    result = []
    for part in generator.surface.parts:
        for path in part.pathes:
            path.faster_edges('corner')
            commands = []
            for cmd in path.path:
                if cmd[0] in ('M', 'L'):
                    commands.append(f'{cmd[0]} {cmd[1]:.8f} {cmd[2]:.8f}')
                elif cmd[0] == 'C':
                    commands.append(f'C {cmd[3]:.8f} {cmd[4]:.8f} {cmd[5]:.8f} {cmd[6]:.8f} {cmd[1]:.8f} {cmd[2]:.8f}')
                else:
                    raise ValueError('Unerwarteter Boxes.py-Pfadbefehl.')
            if commands:
                result.append(' '.join(commands))
    return result


def contour_path(points, thickness, burn=0, hole=False):
    # The upstream corner algorithm handles non-orthogonal and concave angles.
    # Reverse holes so positive burn moves into waste on either contour type.
    points = [list(p) for p in points]
    area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points, points[1:]+points[:1]))
    if (area > 0) == hole:
        points.reverse()
    if abs(burn) < 1e-12:
        return 'M ' + ' L '.join(f'{p[0]:.8f} {p[1]:.8f}' for p in points) + ' Z'
    return _shared.compensated_contour(points, thickness, burn)[1]


def circle_path(cx, cy, radius, thickness, burn=0, hole=False):
    gen = _drawing(thickness, burn)
    if hole:
        gen.hole(cx, cy, r=radius)
    else:
        gen.circle(cx, cy, radius)
    return ' '.join(p+' Z' for p in path_commands(gen))


def flex_lines(length, height, thickness, pitch, stretch, x=0, y=0):
    if length / pitch * max(1, height / (5 * thickness)) > 18000:
        raise ValueError('Flexmuster überschreitet das Schnittbudget.')
    gen = _drawing(thickness, 0)
    settings = FlexSettings(thickness, relative=False, distance=pitch,
                            connection=thickness, width=max(5*thickness, 3), stretch=stretch)
    FlexEdge(gen, settings)(length, height)
    gen.ctx.stroke()
    lines = []
    for part in gen.surface.parts:
        for path in part.pathes:
            start = None
            for cmd in path.path:
                if cmd[0] == 'M':
                    start = [cmd[1]+x, cmd[2]+y]
                elif cmd[0] == 'L' and start is not None:
                    end = [cmd[1]+x, cmd[2]+y]
                    # FlexEdge also draws the boundary: only true slit segments.
                    if abs(end[0]-start[0]) < 1e-7 and abs(end[1]-start[1]) > 1e-6:
                        lines.append([start, end])
                    start = end
    return lines
