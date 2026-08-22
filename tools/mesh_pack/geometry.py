"""Dependency-free triangle clipping and mesh evidence primitives."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from math import hypot
from typing import Iterable

Point = tuple[float, float, float]
Triangle = tuple[int, int, int]


@dataclass(frozen=True)
class HalfMesh:
    positions: tuple[Point, ...]
    triangles: tuple[Triangle, ...]
    surface_triangle_count: int
    cap_triangle_count: int


@dataclass(frozen=True)
class SplitMesh:
    left: HalfMesh
    right: HalfMesh
    intersection_loop_count: int
    open_intersection_component_count: int


def _point_key(point: Point, epsilon: float) -> tuple[int, int, int]:
    scale = 1 / epsilon
    return tuple(round(value * scale) for value in point)  # type: ignore[return-value]


def _intersection(left: Point, right: Point) -> Point:
    fraction = -left[0] / (right[0] - left[0])
    return (0.0, left[1] + (right[1] - left[1]) * fraction, left[2] + (right[2] - left[2]) * fraction)


def _clip_polygon(points: list[Point], side: int, epsilon: float) -> list[Point]:
    result: list[Point] = []
    for index, current in enumerate(points):
        previous = points[index - 1]
        current_inside = side * current[0] >= -epsilon
        previous_inside = side * previous[0] >= -epsilon
        if current_inside != previous_inside:
            result.append(_intersection(previous, current))
        if current_inside:
            result.append((0.0, current[1], current[2]) if abs(current[0]) <= epsilon else current)
    deduplicated: list[Point] = []
    for point in result:
        if not deduplicated or _point_key(point, epsilon) != _point_key(deduplicated[-1], epsilon):
            deduplicated.append(point)
    if len(deduplicated) > 1 and _point_key(deduplicated[0], epsilon) == _point_key(deduplicated[-1], epsilon):
        deduplicated.pop()
    return deduplicated


def _plane_points(points: list[Point], epsilon: float) -> list[Point]:
    result: dict[tuple[int, int, int], Point] = {}
    for index, left in enumerate(points):
        right = points[(index + 1) % len(points)]
        if abs(left[0]) <= epsilon:
            point = (0.0, left[1], left[2])
            result[_point_key(point, epsilon)] = point
        if left[0] < -epsilon < right[0] or right[0] < -epsilon < left[0]:
            point = _intersection(left, right)
            result[_point_key(point, epsilon)] = point
        elif left[0] < epsilon < right[0] or right[0] < epsilon < left[0]:
            point = _intersection(left, right)
            result[_point_key(point, epsilon)] = point
    return list(result.values())


def _cross_length(a: Point, b: Point, c: Point) -> float:
    ab = tuple(b[axis] - a[axis] for axis in range(3))
    ac = tuple(c[axis] - a[axis] for axis in range(3))
    cross = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    return hypot(*cross)


class _Builder:
    def __init__(self, epsilon: float) -> None:
        self.epsilon = epsilon
        self.positions: list[Point] = []
        self.triangles: list[Triangle] = []
        self.by_key: dict[tuple[int, int, int], int] = {}
        self.surface_count = 0
        self.cap_count = 0

    def vertex(self, point: Point) -> int:
        key = _point_key(point, self.epsilon)
        if key not in self.by_key:
            self.by_key[key] = len(self.positions)
            self.positions.append(point)
        return self.by_key[key]

    def triangle(self, points: Iterable[Point], *, cap: bool = False) -> None:
        indices = tuple(self.vertex(point) for point in points)
        if len(indices) != 3 or _cross_length(*(self.positions[index] for index in indices)) <= 1e-12:
            return
        self.triangles.append(indices)  # type: ignore[arg-type]
        if cap:
            self.cap_count += 1
        else:
            self.surface_count += 1

    def finish(self) -> HalfMesh:
        return HalfMesh(tuple(self.positions), tuple(self.triangles), self.surface_count, self.cap_count)


def _trace_loops(points: dict[tuple[int, int, int], Point], segments: set[tuple[tuple[int, int, int], tuple[int, int, int]]]) -> tuple[list[list[Point]], int]:
    adjacency: dict[tuple[int, int, int], set[tuple[int, int, int]]] = defaultdict(set)
    for left, right in segments:
        adjacency[left].add(right)
        adjacency[right].add(left)
    unseen = set(adjacency)
    loops: list[list[Point]] = []
    open_count = 0
    while unseen:
        start = min(unseen)
        pending = [start]
        component: set[tuple[int, int, int]] = set()
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            pending.extend(adjacency[current] - component)
        unseen -= component
        if any(len(adjacency[key]) != 2 for key in component):
            open_count += 1
            continue
        ordered = [min(component)]
        previous = None
        current = ordered[0]
        while True:
            candidates = sorted(adjacency[current])
            following = candidates[0] if candidates[0] != previous else candidates[1]
            if following == ordered[0]:
                break
            ordered.append(following)
            previous, current = current, following
            if len(ordered) > len(component):
                raise ValueError("medial intersection loop is inconsistent")
        loops.append([points[key] for key in ordered])
    return loops, open_count


def _polygon_area(loop: list[Point]) -> float:
    return sum(left[1] * right[2] - right[1] * left[2] for left, right in zip(loop, loop[1:] + loop[:1])) / 2


def _cap(builder: _Builder, loop: list[Point], expected_normal_x: int) -> None:
    # Intersection loops generated by the canonical clipping fixture and the
    # donor source are simple. A deterministic fan is sufficient for convex
    # loops; reject non-convex loops instead of inventing topology.
    orientation = 1 if _polygon_area(loop) > 0 else -1
    signed_turns = []
    for previous, current, following in zip(loop[-1:] + loop[:-1], loop, loop[1:] + loop[:1]):
        signed_turns.append((current[1] - previous[1]) * (following[2] - current[2]) - (current[2] - previous[2]) * (following[1] - current[1]))
    if any(turn * orientation < -1e-12 for turn in signed_turns):
        raise ValueError("non-convex medial cap requires an explicit triangulation policy")
    for index in range(1, len(loop) - 1):
        face = [loop[0], loop[index], loop[index + 1]]
        normal_x = (face[1][1] - face[0][1]) * (face[2][2] - face[0][2]) - (face[1][2] - face[0][2]) * (face[2][1] - face[0][1])
        if (normal_x > 0) != (expected_normal_x > 0):
            face[1], face[2] = face[2], face[1]
        builder.triangle(face, cap=True)


def split_and_cap_hemispheres(positions: Iterable[Iterable[float]], triangles: Iterable[Iterable[int]], epsilon_um: float = 1e-6, *, require_closed: bool = True) -> SplitMesh:
    points = [tuple(map(float, point)) for point in positions]
    faces = [tuple(map(int, face)) for face in triangles]
    if any(len(point) != 3 for point in points) or any(len(face) != 3 for face in faces):
        raise ValueError("triangle mesh buffers are malformed")
    builders = {-1: _Builder(epsilon_um), 1: _Builder(epsilon_um)}
    plane_points: dict[tuple[int, int, int], Point] = {}
    segments: set[tuple[tuple[int, int, int], tuple[int, int, int]]] = set()
    for face in faces:
        if any(index < 0 or index >= len(points) for index in face):
            raise ValueError("triangle index is out of bounds")
        triangle = [points[index] for index in face]
        for side, builder in builders.items():
            polygon = _clip_polygon(triangle, side, epsilon_um)
            for index in range(1, len(polygon) - 1):
                builder.triangle((polygon[0], polygon[index], polygon[index + 1]))
        intersection = _plane_points(triangle, epsilon_um)
        if len(intersection) > 2:
            raise ValueError("non-simple medial triangle intersection")
        if len(intersection) == 2:
            keys = [_point_key(point, epsilon_um) for point in intersection]
            for key, point in zip(keys, intersection):
                plane_points[key] = point
            segments.add(tuple(sorted(keys)))  # type: ignore[arg-type]
    loops, open_count = _trace_loops(plane_points, segments)
    if open_count and require_closed:
        raise ValueError(f"medial intersection contains {open_count} open or branching component(s)")
    for loop in loops:
        _cap(builders[-1], loop, 1)
        _cap(builders[1], loop, -1)
    return SplitMesh(builders[-1].finish(), builders[1].finish(), len(loops), open_count)


def bounds(positions: Iterable[Point]) -> dict[str, list[float]]:
    points = list(positions)
    return {
        "minimum_um": [min(point[axis] for point in points) for axis in range(3)],
        "maximum_um": [max(point[axis] for point in points) for axis in range(3)],
    }


def centroid(positions: Iterable[Point]) -> list[float]:
    points = list(positions)
    return [sum(point[axis] for point in points) / len(points) for axis in range(3)]


def component_count(triangles: Iterable[Triangle]) -> int:
    faces = list(triangles)
    by_vertex: dict[int, list[int]] = defaultdict(list)
    for face_index, face in enumerate(faces):
        for vertex in face:
            by_vertex[vertex].append(face_index)
    unseen = set(range(len(faces)))
    components = 0
    while unseen:
        components += 1
        pending = [unseen.pop()]
        while pending:
            face_index = pending.pop()
            neighbours = {other for vertex in faces[face_index] for other in by_vertex[vertex]}
            found = neighbours & unseen
            unseen -= found
            pending.extend(found)
    return components


def vertex_normals(positions: tuple[Point, ...], triangles: tuple[Triangle, ...]) -> list[float]:
    normals = [[0.0, 0.0, 0.0] for _ in positions]
    for face in triangles:
        a, b, c = (positions[index] for index in face)
        ab = tuple(b[axis] - a[axis] for axis in range(3))
        ac = tuple(c[axis] - a[axis] for axis in range(3))
        normal = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
        for index in face:
            for axis in range(3):
                normals[index][axis] += normal[axis]
    result: list[float] = []
    for normal in normals:
        length = hypot(*normal) or 1
        result.extend(value / length for value in normal)
    return result
