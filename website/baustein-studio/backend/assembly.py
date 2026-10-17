# SPDX-License-Identifier: GPL-3.0-or-later
"""Continuous translation proofs for individual panels and small subassemblies."""

from copy import deepcopy
from itertools import product
import time

EPS = 1e-7
DIRECTIONS = tuple(vector for vector in product((-1, 0, 1), repeat=3) if any(vector))
MAX_GROUP_SIZE = 3
MAX_GROUP_CANDIDATES = 1024
MAX_PAIR_CHECKS = 2_000_000
SEARCH_SECONDS = 10


class SearchLimit(ValueError):
    pass


class AssemblyLocked(ValueError):
    def __init__(self, panel_ids):
        self.panel_ids = list(panel_ids)


def boxes_collide_along_translation(first, second, translation, epsilon=EPS):
    """Intersect strict overlap intervals over the whole motion, t in [0, 1]."""
    enter, leave = 0.0, 1.0
    for axis, speed in enumerate(translation):
        a, b = first[axis], second[axis]
        if min(a[1] - a[0], b[1] - b[0]) <= epsilon:
            return False
        if speed == 0:
            if min(a[1], b[1]) - max(a[0], b[0]) <= epsilon:
                return False
            continue
        times = ((b[0] + epsilon - a[1]) / speed,
                 (b[1] - epsilon - a[0]) / speed)
        enter = max(enter, min(times))
        leave = min(leave, max(times))
        if enter >= leave:
            return False
    return enter < leave


def _bounds(boxes):
    return tuple((min(box[axis][0] for box in boxes), max(box[axis][1] for box in boxes))
                 for axis in range(3))


def sweep_clear(moving_boxes, obstacles, translation):
    return not any(boxes_collide_along_translation(first, second, translation)
                   for first in moving_boxes for second in obstacles)


def flatten_operations(steps):
    """Internal preassembly operations precede the rigid group insertion."""
    result = []
    counter = 0

    def visit(operations, parent=None):
        nonlocal counter
        for operation in operations:
            group = operation.get("steps", [])
            group_id = parent
            if group:
                counter += 1
                group_id = f"group-{counter:03d}"
                visit(group, group_id)
            entry = {"panelIds": list(operation["panelIds"]),
                     "translation": list(operation["translation"]),
                     "kind": "group" if group else "preassembly" if parent else "panel"}
            if group_id:
                entry["groupId"] = group_id
            if group and parent:
                entry["parentGroupId"] = parent
            result.append(entry)

    visit(steps)
    return result


def plan_assembly(panels, cuboids, dimensions, contacts):
    """Greedy extraction with exact sweeps and recursively proven groups ≤3."""
    by_id = {panel["id"]: panel for panel in panels}
    ids = tuple(by_id)
    bounds = {panel_id: _bounds(cuboids[panel_id]) for panel_id in ids}
    neighbours = {panel_id: set() for panel_id in ids}
    for first, second in contacts:
        if first in neighbours and second in neighbours:
            neighbours[first].add(second)
            neighbours[second].add(first)
    deadline = time.monotonic() + SEARCH_SECONDS
    pair_checks = 0
    group_candidates = 0
    internal_cache = {}

    def check_budget():
        if time.monotonic() > deadline or pair_checks > MAX_PAIR_CHECKS:
            raise SearchLimit("Die Montageprüfung hat ihr Suchbudget erreicht. Größere Zinken oder einen einfacheren Aufbau verwenden.")

    def clearance(members, fixed_ids, translation):
        nonlocal pair_checks
        moving = [box for panel_id in members for box in cuboids[panel_id]]
        moving_bounds = _bounds(moving)
        for fixed_id in fixed_ids:
            # A conservative broad-phase avoids most rectangle pairs.
            if not boxes_collide_along_translation(moving_bounds, bounds[fixed_id], translation):
                continue
            for first in moving:
                for second in cuboids[fixed_id]:
                    pair_checks += 1
                    if pair_checks % 1024 == 0:
                        check_budget()
                    if boxes_collide_along_translation(first, second, translation):
                        return False
        return True

    def distance(members, children):
        # Keep the entire preassembly subtree outside the installed model,
        # including negative child motions, rather than only its final shape.
        envelope = sum(max(abs(value) for value in entry["translation"])
                       for entry in flatten_operations(children))
        return round(max(dimensions) + 4 * max(by_id[p]["thickness"] for p in members)
                     + 20 + envelope, 8)

    def operation(members, direction, children):
        amount = distance(members, children)
        item = {"panelIds": list(members), "translation": [value * amount for value in direction],
                "steps": deepcopy(children)}
        if len(members) == 1:
            panel = by_id[members[0]]
            item["panelId"] = panel["id"]
            if sum(abs(value) for value in direction) == 1 and direction[panel["_axis"]]:
                item.update(axis=panel["axis"], sign=direction[panel["_axis"]], distance=amount)
        return item

    def connected_groups(remaining):
        members = set(remaining)
        pairs = sorted({tuple(sorted((first, second))) for first in remaining
                        for second in neighbours[first] & members})
        for pair in pairs:
            if len(pair) < len(remaining):
                yield pair
        if len(remaining) > MAX_GROUP_SIZE:
            seen = set()
            for first, second in pairs:
                for third in sorted((neighbours[first] | neighbours[second]) & members - {first, second}):
                    group = tuple(sorted((first, second, third)))
                    if group not in seen:
                        seen.add(group)
                        yield group

    def solve(members):
        nonlocal group_candidates
        remaining = list(members)
        removal = []
        while remaining:
            check_budget()
            selected = None
            # Preserve the existing normal-first ordering for simple models.
            for outward in (True, False):
                for panel_id in remaining:
                    panel = by_id[panel_id]
                    direction = [0, 0, 0]
                    direction[panel["_axis"]] = panel["sign"] * (1 if outward else -1)
                    candidate = operation((panel_id,), direction, [])
                    if clearance((panel_id,), [p for p in remaining if p != panel_id], candidate["translation"]):
                        selected = candidate
                        break
                if selected:
                    break
            if not selected:
                for panel_id in remaining:
                    for direction in DIRECTIONS:
                        candidate = operation((panel_id,), direction, [])
                        if clearance((panel_id,), [p for p in remaining if p != panel_id], candidate["translation"]):
                            selected = candidate
                            break
                    if selected:
                        break
            if not selected:
                for group in connected_groups(remaining):
                    group_candidates += 1
                    if group_candidates > MAX_GROUP_CANDIDATES:
                        raise SearchLimit("Die Montageprüfung hat 1024 Baugruppen untersucht. Den Aufbau vereinfachen oder eine Fläche öffnen.")
                    if group not in internal_cache:
                        try:
                            internal_cache[group] = solve(group)
                        except AssemblyLocked:
                            internal_cache[group] = None
                    children = internal_cache[group]
                    if children is None:
                        continue
                    fixed = [p for p in remaining if p not in group]
                    for direction in DIRECTIONS:
                        candidate = operation(group, direction, children)
                        if clearance(group, fixed, candidate["translation"]):
                            selected = candidate
                            break
                    if selected:
                        break
            if not selected:
                raise AssemblyLocked(remaining)
            removal.append(selected)
            remaining = [p for p in remaining if p not in selected["panelIds"]]
        return list(reversed(removal))

    steps = solve(ids)
    individual_order = []
    for entry in flatten_operations(steps):
        for panel_id in entry["panelIds"]:
            if panel_id not in individual_order:
                individual_order.append(panel_id)
    return individual_order, steps
