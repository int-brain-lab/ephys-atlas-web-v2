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
