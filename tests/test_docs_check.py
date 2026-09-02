from __future__ import annotations

from pathlib import Path

from tools.docs_check import check_repository


def _write(root: Path, path: str, text: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def _repository(tmp_path: Path) -> Path:
    _write(tmp_path, "README.md", "# Test repository\n")
    _write(
        tmp_path,
        "docs/DECISIONS.md",
        """# Decision log

| ID | Short title | Effective status | Date recorded | Effective scope or supersession |
| --- | --- | --- | --- | --- |
| D001 | First | accepted | — | current |
| D002 | Second | superseded | — | D001 |

## D001 — First

Accepted.

## D002 — Second

Superseded by D001.
""",
    )
    _write(
        tmp_path,
        "docs/OPEN_QUESTIONS.md",
        "# Open questions\n\nStatus: active blocker registry.\n\n## Q2 — Open\n\nStatus: **BLOCKER**.\n",
    )
    _write(
        tmp_path,
        "docs/RESOLVED_QUESTIONS.md",
        "# Resolved\n\n| ID | Resolution | Authority |\n| --- | --- | --- |\n| Q1 | Done | D001 |\n",
    )
    _write(
        tmp_path,
        "docs/IMPLEMENTATION_PLAN.md",
        "# Plan\n\nStatus: active execution registry.\n\n## Work\n\nStatus: active.\n",
    )
    for directory in ("data", "rendering"):
        _write(
            tmp_path,
            f"docs/{directory}/README.md",
            f"""# {directory.title()} index

Status: active documentation map.

## Document roles

| Document | Role | Status |
| --- | --- | --- |
| [`AUTHORITY.md`](AUTHORITY.md) | contract | accepted |
""",
        )
        _write(
            tmp_path,
            f"docs/{directory}/AUTHORITY.md",
            "# Authority\n\nStatus: accepted contract.\n",
        )
    return tmp_path


def _messages(root: Path) -> list[str]:
    return [str(item) for item in check_repository(root)]


def test_valid_minimal_repository_passes(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    _write(
        root,
        "docs/guide.md",
        "# Repeated heading\n\n# Repeated heading\n\n[second](#repeated-heading-1)\n"
        "[relative authority](data/AUTHORITY.md)\n",
    )
    assert _messages(root) == []


def test_reports_broken_markdown_link_anchor_and_repository_path(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    _write(
        root,
        "docs/guide.md",
        "# Guide\n\n[missing](missing.md)\n[anchor](#absent)\n`tools/missing.py`\n",
    )
    messages = _messages(root)
    assert any("local Markdown target does not exist: docs/missing.md" in item for item in messages)
    assert any("Markdown anchor does not exist: docs/guide.md#absent" in item for item in messages)
    assert any("repository path does not exist: tools/missing.py" in item for item in messages)
    assert all(not item.startswith("docs/guide.md:") or ": docs/guide.md:" not in item for item in messages)


def test_reports_duplicate_and_undefined_identifiers(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    _write(root, "docs/duplicate.md", "# Duplicate\n\n## D001 — Again\n\nSee Q99.\n")
    messages = _messages(root)
    assert any("duplicate identifier definition: D001" in item for item in messages)
    assert any("reference to undefined identifier: Q99" in item for item in messages)


def test_reports_invalid_supersession_target(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    decisions = (root / "docs/DECISIONS.md").read_text(encoding="utf-8")
    (root / "docs/DECISIONS.md").write_text(decisions.replace("| D002 | Second | superseded | — | D001 |", "| D002 | Second | superseded | — | D999 |"), encoding="utf-8")
    assert any("reference to undefined identifier: D999" in item for item in _messages(root))


def test_reports_resolved_open_question_and_completed_active_milestone(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    _write(root, "docs/OPEN_QUESTIONS.md", "# Open\n\n## Q2 — Done\n\nStatus: **RESOLVED**.\n")
    _write(root, "docs/IMPLEMENTATION_PLAN.md", "# Plan\n\n## Old work\n\nStatus: **complete**.\n")
    messages = _messages(root)
    assert any("resolved item remains in open-question registry" in item for item in messages)
    assert any("completed or historical milestone remains in active plan" in item for item in messages)


def test_partially_resolved_question_remains_open(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    _write(
        root,
        "docs/OPEN_QUESTIONS.md",
        "# Open\n\n## Q2 — Partial\n\nStatus: **DECISION; partially resolved by D001**.\n",
    )
    assert not any(
        "resolved item remains in open-question registry" in item
        for item in _messages(root)
    )


def test_reports_missing_or_conflicting_indexed_status(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    _write(root, "docs/data/AUTHORITY.md", "# Authority\n")
    _write(root, "docs/rendering/AUTHORITY.md", "# Authority\n\nStatus: active but superseded.\n")
    messages = _messages(root)
    assert any("indexed document has no Status header" in item for item in messages)
    assert any("status 'active' does not match index status 'accepted'" in item for item in messages)
    assert any("active document is also labelled retired or superseded" in item for item in messages)


def test_launch_traceability_requires_every_canonical_row(tmp_path: Path) -> None:
    root = _repository(tmp_path)
    counts = (8, 13, 14, 9, 4, 6, 4, 5, 4, 8, 9, 6, 6)
    identifiers = [
        f"LS{section:02d}-{criterion:02d}"
        for section, count in enumerate(counts, 1)
        for criterion in range(1, count + 1)
    ] + [f"DLR-{criterion:02d}" for criterion in range(1, 7)]
    _write(
        root,
        "docs/LAUNCH_SPEC.md",
        "# Launch\n\n" + "\n".join(
            f'- <a id="{identifier.lower()}"></a> **`{identifier}`** — Criterion.'
            for identifier in identifiers
        ),
    )
    rows = [
        f"| [{identifier}](LAUNCH_SPEC.md#{identifier.lower()}) | Criterion | Evidence | satisfied | Retain coverage. |"
        for identifier in identifiers
    ]
    _write(
        root,
        "docs/LAUNCH_READINESS_AUDIT.md",
        "# Audit\n\n" + "\n".join(rows),
    )
    assert _messages(root) == []

    (root / "docs/LAUNCH_READINESS_AUDIT.md").write_text(
        "# Audit\n\n" + "\n".join(rows[:-1]),
        encoding="utf-8",
    )
    assert any(
        "launch audit must contain exactly one ordered row for every launch criterion ID" in item
        for item in _messages(root)
    )
