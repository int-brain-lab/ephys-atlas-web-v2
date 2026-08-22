from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] / "web" / "src"
IMPORT_RE = re.compile(r"from\s+['\"](?P<path>\.\.?/[^'\"]+)['\"]")


def relative_imports(path: Path) -> list[str]:
    return [match.group("path") for match in IMPORT_RE.finditer(path.read_text())]


def assert_layer_does_not_import(layer: str, forbidden: tuple[str, ...]) -> None:
    violations: list[str] = []
    for path in sorted((ROOT / layer).rglob("*.ts")):
        for imported in relative_imports(path):
            target = (path.parent / imported).resolve()
            try:
                relative = target.relative_to(ROOT.resolve()).as_posix()
            except ValueError:
                continue
            if relative.startswith(forbidden):
                violations.append(f"{path.relative_to(ROOT)} -> {imported}")
    assert not violations, "layer dependency violations:\n" + "\n".join(violations)


def test_core_is_independent_of_outer_layers() -> None:
    assert_layer_does_not_import("core", ("application/", "data/", "rendering/", "ui/", "url/"))


def test_domain_does_not_depend_on_rendering_or_ui() -> None:
    assert_layer_does_not_import("domain", ("application/", "data/", "rendering/", "ui/"))


def test_application_does_not_depend_on_rendering_or_ui() -> None:
    assert_layer_does_not_import("application", ("rendering/", "ui/"))


def test_browser_runtime_has_no_pre_cutover_compatibility_contracts() -> None:
    forbidden = {
        "schema v0.1": re.compile(r"schema[- /]?v?0\.1", re.IGNORECASE),
        "anatomy-pack runtime": re.compile(r"anatomy-pack-v[123]"),
        "removed renderer facade": re.compile(r"\b(?:HybridSliceRenderer|SliceRenderer)\b"),
        "legacy region crosswalk": re.compile(r"\blegacyIndex\b"),
        "legacy slice calibration": re.compile(r"\b(?:legacyRegional|projectLegacy|LEGACY_VIEW)"),
    }
    violations: list[str] = []
    for path in sorted(ROOT.rglob("*.ts")):
        source = path.read_text()
        for label, pattern in forbidden.items():
            if pattern.search(source):
                violations.append(f"{path.relative_to(ROOT)}: {label}")
    assert not violations, "pre-cutover browser contracts returned:\n" + "\n".join(violations)


def test_application_composition_uses_only_the_projection_viewport_boundary() -> None:
    app = (ROOT / "app.ts").read_text()
    assert "ProjectionViewportFactory" in app
    assert "SvgSliceRenderer" not in app
    assert "CanvasVolumeSliceRenderer" not in app
    assert "ProjectionPackSource" not in app


def test_mesh_runtime_dependencies_stay_inside_rendering_3d() -> None:
    violations: list[str] = []
    for path in sorted(ROOT.rglob("*.ts")):
        source = path.read_text()
        if "from 'meshoptimizer'" in source or 'from "meshoptimizer"' in source:
            if not path.relative_to(ROOT).as_posix().startswith("rendering/3d/"):
                violations.append(path.relative_to(ROOT).as_posix())
    assert not violations, "mesh runtime dependency escaped rendering/3d:\n" + "\n".join(violations)
    app = (ROOT / "app.ts").read_text()
    assert "MeshPackSource" not in app
    assert "meshoptimizer" not in app


def test_three_runtime_stays_inside_rendering_3d() -> None:
    violations: list[str] = []
    for path in sorted(ROOT.rglob("*.ts")):
        source = path.read_text()
        if "from 'three'" in source or 'from "three"' in source:
            if not path.relative_to(ROOT).as_posix().startswith("rendering/3d/"):
                violations.append(path.relative_to(ROOT).as_posix())
    assert not violations, "Three runtime dependency escaped rendering/3d:\n" + "\n".join(violations)


def test_projection_viewports_consume_shared_regional_presentation() -> None:
    for name in ("retained-projection-viewport.ts", "static-projection-viewport.ts"):
        source = (ROOT / "rendering" / name).read_text()
        assert "regional-presentation.js" in source
        assert "bilateralAtlasRegionColorMap" not in source
        assert "bilateralFeatureColorMap" not in source
