"""Conservative continuous collision checks on nominal, extruded part solids.

A clear interval has a separating-plane proof covering its entire duration.
Sampling can find collisions, but can never establish clearance.
"""
import math
import time
from itertools import combinations, product

import numpy as np
from scipy.spatial import ConvexHull, HalfspaceIntersection, QhullError
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, box

_EPS = 1e-7


class _Uncertain(ValueError):
    pass


def _directions(rows):
    rows = np.asarray(rows, dtype=float).reshape((-1, 3))
    lengths = np.linalg.norm(rows, axis=1)
    rows = rows[lengths > 1e-10] / lengths[lengths > 1e-10, None]
    if not len(rows):
        return rows
    signs = rows[np.arange(len(rows)), np.argmax(abs(rows), axis=1)]
    rows *= np.where(signs < 0, -1, 1)[:, None]
    _, indices = np.unique(np.round(rows, 12), axis=0, return_index=True)
    return rows[indices]


class _Solid:
    def __init__(self, vertices, normals=None, edges=None, approximate=False):
        self.approximate = approximate
        self.vertices = np.asarray(vertices, dtype=float)
        if normals is None:
            hull = ConvexHull(self.vertices)
            normals = hull.equations[:, :3]
            edges = [self.vertices[a] - self.vertices[b]
                     for face in hull.simplices for a, b in combinations(face, 2)]
            self.vertices = self.vertices[hull.vertices]
        self.normals = _directions(normals)
        self.edges = _directions(edges)
        self.low = self.vertices.min(axis=0)
        self.high = self.vertices.max(axis=0)

    def transformed(self, rotation, translation):
        return _Solid(self.vertices @ rotation.T + translation,
                      self.normals @ rotation.T, self.edges @ rotation.T, self.approximate)


def _wrap_solids(part, polygon, thickness):
    surface = part['surface']
    samples = surface.get('samples', [])
    if surface.get('type') != 'wrap' or len(samples) < 2:
        raise ValueError('Die gebogene Oberfläche benötigt mindestens zwei Stützstellen.')
    coordinates = np.array([[sample[key] for key in ('s', 'x', 'y', 'nx', 'ny')]
                            for sample in samples], dtype=float)
    z = float(surface.get('z', 0))
    if not np.isfinite(coordinates).all() or not math.isfinite(z) or np.any(np.diff(coordinates[:, 0]) <= 0):
        raise ValueError('Die Stützstellen der gebogenen Oberfläche sind ungültig.')
    if polygon.bounds[0] < coordinates[0, 0] - _EPS or polygon.bounds[2] > coordinates[-1, 0] + _EPS:
        raise ValueError('Die Kontur reicht über die gebogene Oberfläche hinaus.')
    solids = []
    for a, b in zip(coordinates, coordinates[1:]):
        clipped = polygon.intersection(box(a[0], polygon.bounds[1] - 1, b[0], polygon.bounds[3] + 1))
        polygons = [clipped] if clipped.geom_type == 'Polygon' else getattr(clipped, 'geoms', [])
        for shape in polygons:
            if shape.geom_type != 'Polygon' or shape.area <= 0:
                continue
            rectangle = box(*shape.bounds)
            rectangular = not shape.interiors and shape.equals(rectangle)
            cells = ([shape] if not shape.interiors and shape.equals(shape.convex_hull)
                     else constrained_delaunay_triangles(shape).geoms)
            for cell in cells:
                xy = np.asarray(cell.exterior.coords[:-1], dtype=float)
                fraction = (xy[:, 0] - a[0]) / (b[0] - a[0])
                mapped = a[1:] + fraction[:, None] * (b[1:] - a[1:])
                lower = np.column_stack((mapped[:, :2], z + xy[:, 1]))
                upper = lower + np.column_stack((mapped[:, 2:] * thickness, np.zeros(len(xy))))
                # A bilinear mapped triangle is contained in its six-vertex hull.
                # Rectangular bands are exact when their XY cross section is convex.
                exact = np.array_equal(a[3:], b[3:])
                if rectangular:
                    ends = [a[1:3], b[1:3], b[1:3] + b[3:] * thickness, a[1:3] + a[3:] * thickness]
                    section = Polygon(ends)
                    exact = section.is_valid and section.area > 0 and section.equals(section.convex_hull)
                solids.append(_Solid(np.concatenate((lower, upper)), approximate=not exact))
    if not solids:
        raise ValueError('Für die gebogene Oberfläche konnten keine Volumenkörper aufgebaut werden.')
    return solids


def _parts_solids(part):
    polygon = Polygon(part['nominal'], part.get('nominalHoles', []))
    if not polygon.is_valid or polygon.is_empty or polygon.area <= _EPS:
        raise ValueError('Die Nennkontur ist ungültig.')
    thickness = float(part['thickness'])
    if not math.isfinite(thickness) or thickness <= 0:
        raise ValueError('Die Materialstärke ist ungültig.')
    if part.get('surface'):
        return _wrap_solids(part, polygon, thickness)
    frame = part['frame']
    origin, u, v, normal = [np.asarray(frame[key], dtype=float)
                            for key in ('origin', 'u', 'v', 'normal')]
    if any(row.shape != (3,) or not np.isfinite(row).all() for row in (origin, u, v, normal)):
        raise ValueError('Das Koordinatensystem ist ungültig.')
    if abs(np.linalg.det(np.stack((u, v, normal)))) <= _EPS:
        raise ValueError('Das Koordinatensystem ist entartet.')
    polygons = ([polygon] if not polygon.interiors and
                abs(polygon.convex_hull.area - polygon.area) <= _EPS
                else list(constrained_delaunay_triangles(polygon).geoms))
    solids = []
    for triangle in polygons:
        xy = np.asarray(triangle.exterior.coords[:-1], dtype=float)
        lower = origin + xy[:, 0, None] * u + xy[:, 1, None] * v
        upper = lower + normal * thickness
        edges = np.roll(lower, -1, axis=0) - lower
        normals = np.concatenate(([np.cross(u, v)], np.cross(edges, normal)))
        solids.append(_Solid(np.concatenate((lower, upper)), normals,
                             np.concatenate((edges, [normal]))))
    return solids


def _curve_envelopes(solids, tolerance):
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError('Die Toleranz der Kurvenannäherung ist ungültig.')
    if tolerance == 0:
        return solids
    offsets = np.array(list(product((-tolerance, tolerance), repeat=3)))
    bounded = []
    for solid in solids:
        if not solid.approximate:
            # The inset supplies material known to lie inside the physical curve.
            hull = ConvexHull(solid.vertices)
            halfspaces = hull.equations.copy()
            halfspaces[:, 3] += tolerance
            center = solid.vertices.mean(axis=0)
            if np.all(halfspaces[:, :3] @ center + halfspaces[:, 3] < -1e-10):
                try:
                    inset = HalfspaceIntersection(halfspaces, center).intersections
                    bounded.append(_Solid(inset))
                except QhullError:
                    pass  # Without a certified core, envelope overlap stays unchecked.
        # A cube encloses every point within the scalar curve-error bound.
        expanded = (solid.vertices[:, None, :] + offsets).reshape((-1, 3))
        bounded.append(_Solid(expanded, approximate=True))
    return bounded


def _pose(joint, value):
    axis = np.asarray(joint['axis'], dtype=float)
    if axis.shape != (3,) or not np.isfinite(axis).all() or np.linalg.norm(axis) < _EPS:
        raise ValueError('Die Bewegungsachse ist ungültig.')
    axis /= np.linalg.norm(axis)
    if joint['type'] == 'slider':
        return np.eye(3), axis * value
    if joint['type'] != 'revolute':
        raise ValueError('Diese Gelenkart wird nicht unterstützt.')
    pivot = np.asarray(joint.get('pivot', [0, 0, 0]), dtype=float)
    if pivot.shape != (3,) or not np.isfinite(pivot).all():
        raise ValueError('Der Drehpunkt ist ungültig.')
    angle = math.radians(value)
    cross = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]],
                      [-axis[1], axis[0], 0]])
    rotation = np.eye(3) + math.sin(angle) * cross + (1 - math.cos(angle)) * (cross @ cross)
    return rotation, pivot - rotation @ pivot


def _axes(first, second):
    cross = np.cross(first.edges[:, None, :], second.edges[None, :, :]).reshape((-1, 3))
    return _directions(np.concatenate((first.normals, second.normals, cross)))


def _separation(first, second):
    # The three world axes often prove clearance without constructing SAT axes.
    gap = max(float(np.max(first.low - second.high)), float(np.max(second.low - first.high)))
    if gap >= -_EPS:
        return gap, np.eye(3)
    small, large = sorted((first.normals, second.normals), key=len)
    for axes in (small, large):
        a, b = first.vertices @ axes.T, second.vertices @ axes.T
        gaps = np.maximum(a.min(axis=0) - b.max(axis=0), b.min(axis=0) - a.max(axis=0))
        if gaps.max() >= -_EPS:
            return float(gaps.max()), axes
    axes = _axes(first, second)
    a, b = first.vertices @ axes.T, second.vertices @ axes.T
    gaps = np.maximum(a.min(axis=0) - b.max(axis=0), b.min(axis=0) - a.max(axis=0))
    return float(gaps.max()), axes


def _clip(solid, axis, boundary, keep_lower):
    values = solid.vertices[:, axis] - boundary
    inside = values <= _EPS if keep_lower else values >= -_EPS
    if inside.all():
        return solid
    if not inside.any():
        return None
    vertices = list(solid.vertices[inside])
    # Every polytope edge is among these pairs; extra chord intersections remain inside.
    for a, b in combinations(range(len(solid.vertices)), 2):
        if inside[a] == inside[b] or abs(values[a] - values[b]) < 1e-12:
            continue
        ratio = values[a] / (values[a] - values[b])
        vertices.append(solid.vertices[a] + ratio * (solid.vertices[b] - solid.vertices[a]))
    vertices = np.unique(np.round(vertices, 10), axis=0)
    if len(vertices) < 4 or np.linalg.matrix_rank(vertices - vertices.mean(axis=0), tol=1e-10) < 3:
        return None
    try:
        return _Solid(vertices, approximate=solid.approximate)
    except QhullError as exc:
        raise _Uncertain('Der lokale Kontaktbereich konnte nicht sicher begrenzt werden.') from exc


def _outside_box(solid, low, high):
    remaining, outside = solid, []
    for axis in range(3):
        if remaining is None:
            break
        piece = _clip(remaining, axis, low[axis], True)
        if piece is not None:
            outside.append(piece)
        remaining = _clip(remaining, axis, low[axis], False)
        if remaining is None:
            break
        piece = _clip(remaining, axis, high[axis], False)
        if piece is not None:
            outside.append(piece)
        remaining = _clip(remaining, axis, high[axis], True)
    return outside


def _contact_obstacles(solids, regions):
    for low, high in regions:
        solids = [piece for solid in solids for piece in _outside_box(solid, low, high)]
    return solids


def _bounds(solids):
    return np.min([solid.low for solid in solids], axis=0), np.max([solid.high for solid in solids], axis=0)


def _apart(first_low, first_high, second_low, second_high):
    return np.any(first_low >= second_high - _EPS) or np.any(second_low >= first_high - _EPS)


def _candidates(low, high, obstacles, obstacle_low, obstacle_high):
    if not obstacles:
        return []
    mask = np.all(low < obstacle_high - _EPS, axis=1) & np.all(obstacle_low < high - _EPS, axis=1)
    return [obstacles[index] for index in np.flatnonzero(mask)]


def _swept_projection(solid, joint, low, high, axes):
    """Exact extrema of every vertex trajectory on fixed candidate SAT axes."""
    axis = np.asarray(joint['axis'], dtype=float)
    axis /= np.linalg.norm(axis)
    if joint['type'] == 'slider':
        base = solid.vertices @ axes.T
        travel = axis @ axes.T
        return (base.min(axis=0) + np.minimum(low * travel, high * travel),
                base.max(axis=0) + np.maximum(low * travel, high * travel))
    pivot = np.asarray(joint.get('pivot', [0, 0, 0]), dtype=float)
    relative = solid.vertices - pivot
    parallel = np.outer(relative @ axis, axis)
    cosine = (relative - parallel) @ axes.T
    sine = np.cross(axis, relative) @ axes.T
    constant = (pivot + parallel) @ axes.T
    low, high = math.radians(low), math.radians(high)
    start = constant + cosine * math.cos(low) + sine * math.sin(low)
    end = constant + cosine * math.cos(high) + sine * math.sin(high)
    minima, maxima = np.minimum(start, end), np.maximum(start, end)
    amplitude = np.hypot(cosine, sine)
    if high - low >= 2 * math.pi:
        minima, maxima = constant - amplitude, constant + amplitude
    else:
        phase = np.arctan2(sine, cosine)
        peak = phase + np.ceil((low - phase) / (2 * math.pi)) * (2 * math.pi)
        trough_phase = phase + math.pi
        trough = trough_phase + np.ceil((low - trough_phase) / (2 * math.pi)) * (2 * math.pi)
        maxima = np.where(peak <= high + 1e-14, constant + amplitude, maxima)
        minima = np.where(trough <= high + 1e-14, constant - amplitude, minima)
    return minima.min(axis=0), maxima.max(axis=0)


class _Budget:
    def __init__(self, seconds, work):
        self.deadline = time.monotonic() + seconds
        self.work = work

    def take(self):
        self.work -= 1
        return self.work >= 0 and time.monotonic() <= self.deadline


def _interval(first, obstacle, joint, low, high, budget, max_depth):
    stack = [(low, high, 0)]
    while stack:
        if not budget.take():
            return 'unchecked', None
        left, right, depth = stack.pop()
        midpoint = (left + right) / 2
        current = first.transformed(*_pose(joint, midpoint))
        gap, axes = _separation(current, obstacle)
        if gap < -_EPS:
            return ('unchecked', None) if current.approximate or obstacle.approximate else ('collision', midpoint)
        if left == right:
            continue
        if joint['type'] == 'slider':
            bound = (right - left) / 2
        else:
            pivot = np.asarray(joint.get('pivot', [0, 0, 0]), dtype=float)
            axis = np.asarray(joint['axis'], dtype=float)
            axis /= np.linalg.norm(axis)
            radius = np.linalg.norm(np.cross(first.vertices - pivot, axis), axis=1).max()
            bound = radius * math.radians((right - left) / 2)
        if gap > bound + _EPS:
            continue
        swept_low, swept_high = _swept_projection(first, joint, left, right, axes)
        fixed = obstacle.vertices @ axes.T
        if np.any(swept_low >= fixed.max(axis=0) - _EPS) or np.any(swept_high <= fixed.min(axis=0) + _EPS):
            continue
        if depth >= max_depth or midpoint == left or midpoint == right:
            return 'unchecked', None
        stack.extend(((midpoint, right, depth + 1), (left, midpoint, depth + 1)))
    return 'clear', None


def check_project(parts, joints, **optional_limits):
    """Check the resting/current assembly and each joint with all others fixed.

    Optional limits: max_seconds (default 8), max_work (30000), max_depth (22),
    max_prisms (6000). Exhaustion always returns unchecked, never clear.
    Contact AABBs are explicit fixed world regions: {partIds, min, max}.
    """
    budget = _Budget(float(optional_limits.get('max_seconds', optional_limits.get('time_budget', 8))),
                     int(optional_limits.get('max_work', optional_limits.get('work_budget', 30000))))
    max_depth = int(optional_limits.get('max_depth', 22))
    max_prisms = int(optional_limits.get('max_prisms', 6000))
    errors, results, base, current, unknown = [], [], {}, {}, []
    uncertain_contact = False
    part_ids = [part['id'] for part in parts]
    joint_for = {}
    contacts = {}
    for joint in joints:
        try:
            for key in ('min', 'max', 'value'):
                if not math.isfinite(float(joint.get(key, 0))):
                    raise ValueError('Die Gelenkstellung muss endlich sein.')
            _pose(joint, float(joint.get('value', 0)))
            for part_id in joint.get('partIds', []):
                if part_id in joint_for:
                    raise ValueError('Ein Teil gehört zu mehreren beweglichen Baugruppen.')
                joint_for[part_id] = joint
            for region in joint.get('contacts', []):
                ids = region.get('partIds', [])
                low, high = np.asarray(region['min'], dtype=float), np.asarray(region['max'], dtype=float)
                if len(ids) != 2 or low.shape != (3,) or high.shape != (3,) or not np.isfinite([low, high]).all() or np.any(low >= high):
                    raise ValueError('Der lokale Kontaktbereich ist ungültig.')
                contacts.setdefault(frozenset(ids), []).append((low, high))
        except (ValueError, TypeError, KeyError) as exc:
            unknown.append(str(exc))
    prism_count = 0
    for part in parts:
        part_id = part['id']
        if not budget.take() or prism_count >= max_prisms:
            unknown.append('Das Rechenbudget für die Bewegungskörper ist aufgebraucht.')
            continue
        try:
            base[part_id] = _parts_solids(part)
            base[part_id] = _curve_envelopes(base[part_id], float(part.get('motionTolerance', 0)))
            prism_count += len(base[part_id])
            if prism_count > max_prisms:
                raise _Uncertain('Die Höchstzahl der Bewegungskörper ist überschritten.')
            joint = joint_for.get(part_id)
            pose = _pose(joint, float(joint.get('value', 0))) if joint else (np.eye(3), np.zeros(3))
            current[part_id] = [solid.transformed(*pose) for solid in base[part_id]]
        except (ValueError, TypeError, KeyError, QhullError) as exc:
            base.pop(part_id, None)
            unknown.append('Der Bewegungskörper konnte nicht aufgebaut werden: ' + str(part_id) + ': ' + str(exc))
    # Check internal group overlaps as well as all other pairs at their current state.
    for first_id, second_id in combinations(part_ids, 2):
        if first_id not in current or second_id not in current:
            continue
        if not budget.take():
            unknown.append('Das Rechenbudget für die aktuelle Montage ist aufgebraucht.')
            break
        if _apart(*_bounds(current[first_id]), *_bounds(current[second_id])):
            continue
        try:
            obstacles = _contact_obstacles(current[second_id], contacts.get(frozenset((first_id, second_id)), []))
        except _Uncertain as exc:
            unknown.append(str(exc))
            continue
        obstacle_low = np.array([solid.low for solid in obstacles])
        obstacle_high = np.array([solid.high for solid in obstacles])
        collision = False
        for first in current[first_id]:
            for obstacle in _candidates(first.low, first.high, obstacles, obstacle_low, obstacle_high):
                if first.approximate or obstacle.approximate:
                    if not uncertain_contact:
                        unknown.append('Konservative Kurvenhüllen liegen nahe beieinander; der genaue Abstand bleibt ungeprüft.')
                        uncertain_contact = True
                    continue
                if not budget.take():
                    unknown.append('Das Rechenbudget für die aktuelle Montage ist aufgebraucht.')
                    break
                if _separation(first, obstacle)[0] < -_EPS:
                    errors.append({'code': 'motion-collision', 'message': 'Teile überlappen in der aktuellen Montagestellung.',
                                   'partIds': [first_id, second_id]})
                    collision = True
                    break
            if collision:
                break
    current_errors = list(errors)
    for joint in joints:
        joint_id = joint.get('id', '')
        moving = set(joint.get('partIds', []))
        status, hit, hit_value = 'clear', None, None
        if unknown or any(part_id not in base for part_id in moving):
            status = 'unchecked'
        for error in current_errors:
            if moving.intersection(error['partIds']):
                status, hit, hit_value = 'collision', error['partIds'], float(joint.get('value', 0))
                break
        try:
            low, high = sorted((float(joint.get('min', 0)), float(joint.get('max', 0))))
            _pose(joint, low)
            for moving_id in (() if hit else moving):
                if moving_id not in base:
                    continue
                sweep = [_swept_projection(solid, joint, low, high, np.eye(3)) for solid in base[moving_id]]
                sweep_low = np.min([bounds[0] for bounds in sweep], axis=0)
                sweep_high = np.max([bounds[1] for bounds in sweep], axis=0)
                for fixed_id in part_ids:
                    if fixed_id in moving or fixed_id not in current:
                        continue
                    if _apart(sweep_low, sweep_high, *_bounds(current[fixed_id])):
                        continue
                    if not budget.take():
                        status = 'unchecked'
                        break
                    obstacles = _contact_obstacles(current[fixed_id], contacts.get(frozenset((moving_id, fixed_id)), []))
                    obstacle_low = np.array([solid.low for solid in obstacles])
                    obstacle_high = np.array([solid.high for solid in obstacles])
                    for first, (first_low, first_high) in zip(base[moving_id], sweep):
                        for obstacle in _candidates(first_low, first_high, obstacles, obstacle_low, obstacle_high):
                            if first.approximate or obstacle.approximate:
                                status = 'unchecked'
                                continue
                            pair_status, value = _interval(first, obstacle, joint, low, high, budget, max_depth)
                            if pair_status == 'collision':
                                status, hit, hit_value = 'collision', [moving_id, fixed_id], value
                                break
                            if pair_status == 'unchecked':
                                status = 'unchecked'
                        if hit:
                            break
                    if hit:
                        break
                if hit:
                    break
        except (ValueError, TypeError, KeyError) as exc:
            status = 'unchecked'
            unknown.append(str(exc))
        message = {'clear': 'Das gesamte Bewegungsintervall ist geometrisch kollisionsfrei nachgewiesen.',
                   'collision': 'Die Bewegung schneidet ein anderes Teil.',
                   'unchecked': 'Die Bewegung konnte innerhalb der Geometrie- oder Rechengrenzen nicht sicher geprüft werden.'}[status]
        result = {'jointId': joint_id, 'status': status, 'message': message}
        if hit:
            result.update(partIds=hit, value=hit_value)
            errors.append({'code': 'motion-collision', 'message': message, 'partIds': hit, 'jointId': joint_id})
        results.append(result)
    if errors:
        status = 'collision'
    elif unknown or any(result['status'] == 'unchecked' for result in results):
        status = 'unchecked'
    else:
        status = 'clear'
    response = {'status': status, 'results': results, 'errors': errors}
    if unknown:
        response['messages'] = list(dict.fromkeys(unknown))
    return response
