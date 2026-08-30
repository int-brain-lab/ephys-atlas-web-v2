"""Repository documentation integrity checks.

The checker intentionally uses only the standard library.  It validates the
small amount of repository-specific structure that makes the documentation an
authority system, in addition to ordinary local Markdown links.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import html
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlsplit


INDEX_PATHS = (Path("docs/data/README.md"), Path("docs/rendering/README.md"))
ALLOWED_DOCUMENT_STATUSES = (
    "frozen evidence",
    "superseded",
    "accepted",
    "blocked",
    "retired",
    "runbook",
    "active",
)
LOCAL_PATH_RE = re.compile(
    r"(?<![\w/:.-])"
    r"(?P<path>"
    r"(?:AGENTS|README)\.md|Justfile|"
    r"(?:docs|schema|fixtures|web|builder|publishing|tools|benchmarks|LICENSES)/"
    r"[A-Za-z0-9_@+.,/=-]+(?:\.[A-Za-z0-9]+|/)"
    r")"
    r"(?=$|[\s`'\"),;:#])"
)
INLINE_LINK_RE = re.compile(
    r"!?\[[^\]\n]*\]\(\s*(?P<destination><[^>\n]+>|[^\s)]+)"
    r"(?:\s+(?:\"[^\"\n]*\"|'[^'\n]*'|\([^()\n]*\)))?\s*\)"
)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
ID_HEADING_RE = re.compile(r"^#{1,6}\s+([QD]\d+)\b")
ID_REFERENCE_RE = re.compile(r"\b([QD]\d+)\b")
STATUS_RE = re.compile(r"^Status:\s*(.+?)\s*$", re.IGNORECASE)
LAUNCH_SECTION_COUNTS = (7, 13, 14, 9, 4, 6, 4, 5, 4, 8, 9, 6, 6)
EXPECTED_LAUNCH_IDS = tuple(
    f"LS{section:02d}-{criterion:02d}"
    for section, count in enumerate(LAUNCH_SECTION_COUNTS, 1)
    for criterion in range(1, count + 1)
) + tuple(f"DLR-{criterion:02d}" for criterion in range(1, 7))
LAUNCH_SPEC_ID_RE = re.compile(
    r'<a id="(?P<anchor>(?:ls\d{2}-\d{2}|dlr-\d{2}))"></a> '
    r'\*\*`(?P<identifier>(?:LS\d{2}-\d{2}|DLR-\d{2}))`\*\*'
)
LAUNCH_AUDIT_ROW_RE = re.compile(
    r"^\| \[(?P<identifier>(?:LS\d{2}-\d{2}|DLR-\d{2}))\]"
    r"\(LAUNCH_SPEC\.md#(?P<anchor>(?:ls\d{2}-\d{2}|dlr-\d{2}))\) \|"
)


@dataclass(frozen=True, order=True)
class Diagnostic:
    path: str
    line: int
    message: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.message}"


@dataclass(frozen=True)
class SourceLine:
    number: int
    text: str
    in_fence: bool


def _git_inventory(root: Path) -> set[str] | None:
    if not (root / ".git").exists():
        return None
    result = subprocess.run(
        [
            "git",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return {item for item in result.stdout.decode().split("\0") if item}


def _inventory(root: Path) -> set[str]:
    tracked = _git_inventory(root)
    if tracked is not None:
        return tracked
    excluded = {".git", ".venv", "node_modules", "artifacts", "__pycache__"}
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and not excluded.intersection(path.relative_to(root).parts)
    }


def _source_lines(text: str) -> list[SourceLine]:
    result: list[SourceLine] = []
    fence: str | None = None
    for number, line in enumerate(text.splitlines(), 1):
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        was_in_fence = fence is not None
        if marker:
            run = marker.group(1)
            if fence is None:
                fence = run[0]
            elif run[0] == fence:
                fence = None
            result.append(SourceLine(number, line, True))
            continue
        result.append(SourceLine(number, line, was_in_fence))
    return result


def _markdown_files(root: Path, inventory: set[str]) -> list[Path]:
    return [root / name for name in sorted(inventory) if name.endswith(".md")]


def _exists_in_clean_checkout(path: str, inventory: set[str]) -> bool:
    normalized = path.rstrip("/")
    return normalized in inventory or any(
        item.startswith(f"{normalized}/") for item in inventory
    )


def _github_slug(text: str) -> str:
    text = html.unescape(re.sub(r"<[^>]*>", "", text))
    text = re.sub(r"[`*_~]", "", text).strip().lower()
    kept: list[str] = []
    for character in text:
        category = unicodedata.category(character)
        if character.isspace():
            kept.append("-")
        elif character in "-_":
            kept.append(character)
        elif not category.startswith(("P", "S", "C")):
            kept.append(character)
    return "".join(kept)


def _anchors(text: str) -> set[str]:
    anchors: set[str] = set()
    counts: dict[str, int] = {}
    in_fence = False
    fence: str | None = None
    for line in text.splitlines():
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            run = marker.group(1)
            if not in_fence:
                in_fence, fence = True, run[0]
            elif run[0] == fence:
                in_fence, fence = False, None
            continue
        if in_fence:
            continue
        explicit = re.finditer(r"<a\s+(?:[^>]*?\s)?(?:id|name)=[\"']([^\"']+)[\"']", line, re.I)
        anchors.update(match.group(1) for match in explicit)
        heading = HEADING_RE.match(line)
        if not heading:
            continue
        base = _github_slug(heading.group(2))
        suffix = counts.get(base, 0)
        counts[base] = suffix + 1
        anchors.add(base if suffix == 0 else f"{base}-{suffix}")
    return anchors


def _resolve_link(source: str, destination: str) -> tuple[str | None, str | None]:
    destination = destination.strip("<>")
    parsed = urlsplit(destination)
    if parsed.scheme or destination.startswith("//"):
        return None, None
    fragment = unquote(parsed.fragment) if parsed.fragment else None
    raw_path = unquote(parsed.path)
    if not raw_path:
        return source, fragment
    if raw_path.startswith("/"):
        target = raw_path.lstrip("/")
    else:
        target = (Path(source).parent / raw_path).as_posix()
    parts: list[str] = []
    for part in Path(target).parts:
        if part == ".":
            continue
        if part == "..":
            if not parts:
                return "../", fragment
            parts.pop()
        else:
            parts.append(part)
    return "/".join(parts), fragment


def _check_links_and_paths(
    root: Path, markdown: list[Path], inventory: set[str]
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    anchor_cache: dict[str, set[str]] = {}
    for file_path in markdown:
        source = file_path.relative_to(root).as_posix()
        text = file_path.read_text(encoding="utf-8")
        for line in _source_lines(text):
            if line.in_fence:
                continue
            inline_links = list(INLINE_LINK_RE.finditer(line.text))
            for match in inline_links:
                destination = match.group("destination")
                target, fragment = _resolve_link(source, destination)
                if target is None:
                    continue
                if not _exists_in_clean_checkout(target, inventory):
                    diagnostics.append(
                        Diagnostic(source, line.number, f"local Markdown target does not exist: {target}")
                    )
                    continue
                if fragment and target.endswith(".md"):
                    if target not in anchor_cache:
                        anchor_cache[target] = _anchors(
                            (root / target).read_text(encoding="utf-8")
                        )
                    if fragment not in anchor_cache[target]:
                        diagnostics.append(
                            Diagnostic(
                                source,
                                line.number,
                                f"Markdown anchor does not exist: {target}#{fragment}",
                            )
                        )
            for match in LOCAL_PATH_RE.finditer(line.text):
                if any(
                    link.start("destination") <= match.start()
                    and match.end() <= link.end("destination")
                    for link in inline_links
                ):
                    continue
                target = match.group("path").rstrip(".,")
                if not _exists_in_clean_checkout(target, inventory):
                    diagnostics.append(
                        Diagnostic(source, line.number, f"repository path does not exist: {target}")
                    )
    return diagnostics


def _normalized_status(value: str) -> str | None:
    plain = value.replace("**", "").strip().lower()
    for status in ALLOWED_DOCUMENT_STATUSES:
        if plain == status or plain.startswith(f"{status} ") or plain.startswith(
            f"{status};"
        ):
            return status
    return None


def _status_header(text: str) -> tuple[int, str, str | None] | None:
    for number, line in enumerate(text.splitlines()[:10], 1):
        match = STATUS_RE.match(line)
        if match:
            value = match.group(1)
            return number, value, _normalized_status(value)
    return None


def _index_rows(index_path: Path) -> list[tuple[int, str, str, str]]:
    rows: list[tuple[int, str, str, str]] = []
    in_roles = False
    for number, line in enumerate(index_path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip() == "## Document roles":
            in_roles = True
            continue
        if in_roles and line.startswith("## "):
            break
        if not in_roles or not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 3 or cells[0] in {"Document", "---"} or set(cells[0]) == {"-"}:
            continue
        link = re.search(r"\[[^]]+\]\(([^)]+\.md)\)", cells[0])
        if link:
            rows.append((number, link.group(1), cells[1], cells[2].lower()))
    return rows


def _check_indexed_statuses(root: Path) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    for relative_index in INDEX_PATHS:
        index = root / relative_index
        if not index.exists():
            diagnostics.append(Diagnostic(relative_index.as_posix(), 1, "required document index is missing"))
            continue
        seen: set[str] = set()
        for line, linked_path, role, indexed_status in _index_rows(index):
            target = (relative_index.parent / linked_path).as_posix()
            if target in seen:
                diagnostics.append(Diagnostic(relative_index.as_posix(), line, f"duplicate indexed document: {target}"))
                continue
            seen.add(target)
            if not role:
                diagnostics.append(Diagnostic(relative_index.as_posix(), line, f"indexed document has no role: {target}"))
            if indexed_status not in ALLOWED_DOCUMENT_STATUSES:
                diagnostics.append(Diagnostic(relative_index.as_posix(), line, f"invalid indexed status {indexed_status!r}: {target}"))
            target_path = root / target
            if not target_path.exists():
                continue  # The ordinary link check reports this with source context.
            header = _status_header(target_path.read_text(encoding="utf-8"))
            if header is None:
                diagnostics.append(Diagnostic(target, 1, "indexed document has no Status header in its first 10 lines"))
                continue
            header_line, value, normalized = header
            if normalized is None:
                diagnostics.append(Diagnostic(target, header_line, f"unrecognized document status: {value}"))
            elif normalized != indexed_status:
                diagnostics.append(
                    Diagnostic(
                        target,
                        header_line,
                        f"status {normalized!r} does not match index status {indexed_status!r}",
                    )
                )
    return diagnostics


def _check_identifiers(root: Path, markdown: list[Path]) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    definitions: dict[str, list[tuple[str, int]]] = {}
    references: list[tuple[str, int, str]] = []
    for file_path in markdown:
        relative = file_path.relative_to(root).as_posix()
        for line in _source_lines(file_path.read_text(encoding="utf-8")):
            if line.in_fence:
                continue
            heading = ID_HEADING_RE.match(line.text)
            if heading:
                definitions.setdefault(heading.group(1), []).append((relative, line.number))
            references.extend((relative, line.number, match.group(1)) for match in ID_REFERENCE_RE.finditer(line.text))

    resolved = root / "docs/RESOLVED_QUESTIONS.md"
    if resolved.exists():
        for number, line in enumerate(resolved.read_text(encoding="utf-8").splitlines(), 1):
            match = re.match(r"^\|\s*(Q\d+)\s*\|", line)
            if match:
                definitions.setdefault(match.group(1), []).append(("docs/RESOLVED_QUESTIONS.md", number))

    decisions = root / "docs/DECISIONS.md"
    decision_rows: dict[str, tuple[int, str]] = {}
    if decisions.exists():
        for number, line in enumerate(decisions.read_text(encoding="utf-8").splitlines(), 1):
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) == 5 and re.fullmatch(r"D\d+", cells[0]):
                if cells[0] in decision_rows:
                    diagnostics.append(Diagnostic("docs/DECISIONS.md", number, f"duplicate decision-index ID: {cells[0]}"))
                decision_rows[cells[0]] = (number, cells[4])
                if cells[2].lower() in {"superseded", "partially superseded"}:
                    targets = {item for item in ID_REFERENCE_RE.findall(cells[4]) if item.startswith("D")}
                    targets.discard(cells[0])
                    if not targets:
                        diagnostics.append(Diagnostic("docs/DECISIONS.md", number, f"{cells[2]} decision has no supersession target: {cells[0]}"))

    for identifier, locations in definitions.items():
        if len(locations) > 1:
            for path, line in locations[1:]:
                diagnostics.append(Diagnostic(path, line, f"duplicate identifier definition: {identifier}"))

    known = set(definitions)
    for path, line, identifier in references:
        if identifier not in known:
            diagnostics.append(Diagnostic(path, line, f"reference to undefined identifier: {identifier}"))

    decision_definitions = {item for item in known if item.startswith("D")}
    for identifier, (line, _) in decision_rows.items():
        if identifier not in decision_definitions:
            diagnostics.append(Diagnostic("docs/DECISIONS.md", line, f"decision index has no decision body: {identifier}"))
    for identifier in sorted(decision_definitions - set(decision_rows)):
        path, line = definitions[identifier][0]
        diagnostics.append(Diagnostic(path, line, f"decision body is missing from effective-status index: {identifier}"))
    return diagnostics


def _check_registry_statuses(root: Path) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    open_questions = root / "docs/OPEN_QUESTIONS.md"
    if open_questions.exists():
        for number, line in enumerate(open_questions.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"^Status:\s*(?:\*\*)?RESOLVED\b", line, re.I):
                diagnostics.append(Diagnostic("docs/OPEN_QUESTIONS.md", number, "resolved item remains in open-question registry"))

    active_plan = root / "docs/IMPLEMENTATION_PLAN.md"
    if active_plan.exists():
        for number, line in enumerate(active_plan.read_text(encoding="utf-8").splitlines(), 1):
            match = STATUS_RE.match(line)
            if not match:
                continue
            value = match.group(1).replace("**", "").strip()
            if re.match(r"^(?:complete|completed|implemented|resolved|retired|superseded)\b", value, re.I):
                diagnostics.append(Diagnostic("docs/IMPLEMENTATION_PLAN.md", number, "completed or historical milestone remains in active plan"))

    for file_path in list(root.glob("docs/**/*.md")) + [root / "README.md", root / "AGENTS.md"]:
        if not file_path.exists():
            continue
        header = _status_header(file_path.read_text(encoding="utf-8"))
        if header is None:
            continue
        line, value, normalized = header
        lower = value.lower()
        if normalized == "active" and re.search(r"\b(?:retired|superseded)\b", lower):
            diagnostics.append(Diagnostic(file_path.relative_to(root).as_posix(), line, "active document is also labelled retired or superseded"))
        if normalized in {"retired", "superseded"} and re.search(r"\bactive\b", lower):
            diagnostics.append(Diagnostic(file_path.relative_to(root).as_posix(), line, "retired or superseded document is also labelled active"))
    return diagnostics


def _check_launch_traceability(root: Path) -> list[Diagnostic]:
    """Keep the active launch specification and evidence ledger in lockstep."""
    diagnostics: list[Diagnostic] = []
    spec_path = root / "docs/LAUNCH_SPEC.md"
    audit_path = root / "docs/LAUNCH_READINESS_AUDIT.md"
    if not spec_path.exists() and not audit_path.exists():
        return diagnostics
    if not spec_path.exists():
        return [Diagnostic("docs/LAUNCH_SPEC.md", 1, "launch specification is missing")]
    if not audit_path.exists():
        return [Diagnostic("docs/LAUNCH_READINESS_AUDIT.md", 1, "launch traceability audit is missing")]

    spec_ids: list[str] = []
    for number, line in enumerate(spec_path.read_text(encoding="utf-8").splitlines(), 1):
        match = LAUNCH_SPEC_ID_RE.search(line)
        if not match:
            continue
        identifier = match.group("identifier")
        if match.group("anchor") != identifier.lower():
            diagnostics.append(Diagnostic("docs/LAUNCH_SPEC.md", number, f"launch criterion anchor does not match ID: {identifier}"))
        spec_ids.append(identifier)

    audit_ids: list[str] = []
    allowed_dispositions = re.compile(
        r"^(?:satisfied|independent gap|blocked Q\d+(?:/Q\d+)*|waived D\d+)$"
    )
    for number, line in enumerate(audit_path.read_text(encoding="utf-8").splitlines(), 1):
        match = LAUNCH_AUDIT_ROW_RE.match(line)
        if not match:
            continue
        identifier = match.group("identifier")
        if match.group("anchor") != identifier.lower():
            diagnostics.append(Diagnostic("docs/LAUNCH_READINESS_AUDIT.md", number, f"launch audit anchor does not match ID: {identifier}"))
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 5 or not cells[1] or not cells[2] or not cells[4]:
            diagnostics.append(Diagnostic("docs/LAUNCH_READINESS_AUDIT.md", number, f"launch audit row must contain criterion, evidence, disposition, and next action: {identifier}"))
        elif not allowed_dispositions.fullmatch(cells[3]):
            diagnostics.append(Diagnostic("docs/LAUNCH_READINESS_AUDIT.md", number, f"invalid launch audit disposition for {identifier}: {cells[3]}"))
        audit_ids.append(identifier)

    if tuple(spec_ids) != EXPECTED_LAUNCH_IDS:
        diagnostics.append(Diagnostic("docs/LAUNCH_SPEC.md", 1, "launch criterion IDs must be the canonical 95 acceptance and 6 readiness IDs in order"))
    if tuple(audit_ids) != EXPECTED_LAUNCH_IDS:
        diagnostics.append(Diagnostic("docs/LAUNCH_READINESS_AUDIT.md", 1, "launch audit must contain exactly one ordered row for every launch criterion ID"))
    return diagnostics


def check_repository(root: Path) -> list[Diagnostic]:
    root = root.resolve()
    inventory = _inventory(root)
    markdown = _markdown_files(root, inventory)
    diagnostics = []
    diagnostics.extend(_check_links_and_paths(root, markdown, inventory))
    diagnostics.extend(_check_indexed_statuses(root))
    diagnostics.extend(_check_identifiers(root, markdown))
    diagnostics.extend(_check_registry_statuses(root))
    diagnostics.extend(_check_launch_traceability(root))
    return sorted(set(diagnostics))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    diagnostics = check_repository(args.root)
    if diagnostics:
        for diagnostic in diagnostics:
            print(diagnostic)
        print(f"documentation check failed with {len(diagnostics)} error(s)", file=sys.stderr)
        return 1
    print("documentation check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
