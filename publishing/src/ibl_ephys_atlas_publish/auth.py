from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
from typing import Any

PBKDF2_ROUNDS = 600_000


def _atomic_private_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, indent=2, sort_keys=True)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    finally:
        if tmp.exists():
            tmp.unlink()


def _hash_token(token: str, salt_hex: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", token.encode(), bytes.fromhex(salt_hex), PBKDF2_ROUNDS
    ).hex()


def issue_credential(path: str | Path, *, label: str, can_create_datasets: bool = False) -> tuple[str, str]:
    path = Path(path)
    data = {"credentials": []}
    if path.exists():
        data = json.loads(path.read_text())
    credential_id = secrets.token_hex(8)
    secret = secrets.token_urlsafe(32)
    token = f"iblpub_{credential_id}_{secret}"
    salt = secrets.token_hex(16)
    data["credentials"].append({
        "id": credential_id,
        "label": label,
        "salt": salt,
        "token_hash": _hash_token(token, salt),
        "can_create_datasets": bool(can_create_datasets),
        "revoked": False,
    })
    _atomic_private_json(path, data)
    return credential_id, token


def revoke_credential(path: str | Path, credential_id: str) -> None:
    path = Path(path)
    data = json.loads(path.read_text())
    for item in data.get("credentials", []):
        if item.get("id") == credential_id:
            item["revoked"] = True
            _atomic_private_json(path, data)
            return
    raise KeyError(credential_id)


class CredentialRegistry:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def authenticate(self, token: str) -> dict[str, Any] | None:
        if not token or not self.path.exists():
            return None
        try:
            credential_id = token.split("_", 2)[1]
        except (IndexError, AttributeError):
            return None
        data = json.loads(self.path.read_text())
        for item in data.get("credentials", []):
            if item.get("id") != credential_id or item.get("revoked"):
                continue
            actual = _hash_token(token, item["salt"])
            if hmac.compare_digest(actual, item["token_hash"]):
                return item
        return None
