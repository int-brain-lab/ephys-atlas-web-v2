from __future__ import annotations

import platform

import numpy as np


def build_environment() -> dict[str, str]:
    """Return the runtime identity needed to distinguish canonical builds."""
    return {
        "operating_system": platform.system().lower(),
        "machine": platform.machine().lower(),
        "python": platform.python_version(),
        "numpy": np.__version__,
    }
