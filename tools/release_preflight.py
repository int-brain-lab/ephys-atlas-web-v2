"""Fail-closed checks for artifacts entering the Linux publication workflow."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import platform
from pathlib import Path
import subprocess

from ephys_atlas_builder.build_environment import build_environment
from ephys_atlas_builder.validate import validate_release


class PreflightError(RuntimeError):
    pass


@dataclass(frozen=True)
class RepositoryState:
    branch: str
    commit: str
    clean: bool


def repository_state(root: Path) -> RepositoryState:
    def git(*arguments: str) -> str:
        return subprocess.run(
            ("git", *arguments), cwd=root, check=True, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout.strip()

    return RepositoryState(
        branch=git("branch", "--show-current"),
        commit=git("rev-parse", "HEAD"),
        clean=not bool(git("status", "--porcelain", "--untracked-files=no")),
    )


def check_release(
    release_dir: Path,
    *,
    repo: RepositoryState,
    host_os: str,
) -> None:
    """Validate one release and enforce the canonical-build boundary."""
    validate_release(release_dir)
    manifest = json.loads((release_dir / "manifest.json").read_text())
    errors: list[str] = []
    release = manifest["release"]
    release_id = release["release_id"]
    builder = manifest["provenance"]["builder"]
    environment = builder.get("environment")
    current_environment = {**build_environment(), "operating_system": host_os.lower()}

    if host_os.lower() != "linux":
        errors.append("production release preflight must run on Linux")
    if repo.branch != "main":
        errors.append(f"production release preflight requires main, found {repo.branch!r}")
    if not repo.clean:
        errors.append("production release preflight requires a clean tracked worktree")
    if release_dir.name != release_id:
        errors.append("release directory name must equal manifest release_id")
    if not release.get("immutable"):
        errors.append("release must be immutable")
    if any(marker in release_id.lower() for marker in ("candidate", "local-preview", "local-rebuild")):
        errors.append("candidate and local release identifiers cannot be published")
    if builder.get("commit") != repo.commit:
        errors.append("builder commit must equal the checked-out production commit")
    if not isinstance(environment, dict):
        errors.append("builder environment is required for production")
    elif environment != current_environment:
        errors.append("release provenance must match the current Linux build environment")
    for source in manifest["provenance"]["sources"]:
        if source.get("release") in {"latest", "current"}:
            errors.append("provenance sources must resolve mutable aliases to immutable IDs")
            break
    if errors:
        raise PreflightError("; ".join(errors))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path, nargs="+")
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    arguments = parser.parse_args(argv)
    repo = repository_state(arguments.repo.resolve())
    try:
        for path in arguments.release:
            check_release(path.resolve(), repo=repo, host_os=platform.system())
            print(f"production-ready release: {path}")
    except (RuntimeError, OSError, ValueError) as exc:
        parser.exit(1, f"production preflight failed: {exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
