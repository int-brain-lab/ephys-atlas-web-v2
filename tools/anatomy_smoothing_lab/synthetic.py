"""Deterministic labelled planes used by the offline lab and its tests."""

from __future__ import annotations

import numpy as np


def synthetic_planes() -> dict[str, np.ndarray]:
    shared_edges = np.asarray(
        [[-1, -1, 1, 1], [-1, -1, 1, 1], [-2, -2, 2, 2], [-2, -2, 2, 2]],
        dtype=np.int16,
    )
    t_junction = np.asarray(
        [[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, 2, 2], [3, 3, 2, 2]],
        dtype=np.int16,
    )
    checkerboard = np.asarray(
        [[1, 2, 1, 2], [2, 1, 2, 1], [1, 2, 1, 2], [2, 1, 2, 1]],
        dtype=np.int16,
    )
    hole = np.ones((7, 7), dtype=np.int16)
    hole[2:5, 2:5] = 0
    islands = np.zeros((7, 7), dtype=np.int16)
    islands[1:3, 1:3] = 1
    islands[4:6, 4:6] = 1
    cavity = np.ones((9, 9), dtype=np.int16)
    cavity[2:7, 2:7] = 0
    cavity[4, 4] = 2
    edge_contact = np.zeros((6, 7), dtype=np.int16)
    edge_contact[:3, :4] = 1
    edge_contact[3:, 3:] = 2
    return {
        "bilateral_shared_edges": shared_edges,
        "t_junction": t_junction,
        "checkerboard": checkerboard,
        "hole": hole,
        "disconnected_islands": islands,
        "background_cavity": cavity,
        "plane_edge_contact": edge_contact,
    }
