from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024


def file_info(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return {"size": path.stat().st_size, "sha256": digest.hexdigest()}


def directory_artifacts(root: Path) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        artifacts.append({"path": path.relative_to(root).as_posix(), **file_info(path)})
    return artifacts


class PublishingClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(
        self,
        method: str,
        path: str,
        *,
        data: Any = None,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        request_headers = {
            "Authorization": f"Bearer {self.token}",
            **(headers or {}),
        }
        if data is not None:
            body = json.dumps(data).encode()
            request_headers["Content-Type"] = "application/json"
        request = Request(
            self.base_url + path,
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with urlopen(request) as response:
                return json.loads(response.read() or b"{}")
        except HTTPError as error:
            detail = error.read().decode()
            raise RuntimeError(f"{error.code}: {detail}") from error

    def create_dataset(self, dataset_id: str, metadata: dict[str, Any] | None = None) -> Any:
        return self._request(
            "POST",
            "/api/datasets",
            data={"dataset_id": dataset_id, "metadata": metadata or {}},
        )

    def list_datasets(self) -> Any:
        return self._request("GET", "/api/datasets")

    def create_upload(
        self,
        dataset_id: str,
        release_id: str,
        artifacts: list[dict[str, Any]],
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        return self._request(
            "POST",
            f"/api/datasets/{quote(dataset_id)}/uploads",
            data={
                "release_id": release_id,
                "artifacts": artifacts,
                "metadata": metadata or {},
            },
        )

    def upload_status(self, upload_id: str) -> Any:
        return self._request("GET", f"/api/uploads/{upload_id}")

    def upload_file(
        self,
        upload_id: str,
        artifact_path: str,
        local_path: str | Path,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> int:
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        status = self.upload_status(upload_id)
        target = next(artifact for artifact in status["artifacts"] if artifact["path"] == artifact_path)
        offset = target["offset"]
        with Path(local_path).open("rb") as handle:
            handle.seek(offset)
            while chunk := handle.read(chunk_size):
                result = self._request(
                    "PUT",
                    f"/api/uploads/{upload_id}/files/{quote(artifact_path, safe='/')}",
                    body=chunk,
                    headers={
                        "Content-Type": "application/octet-stream",
                        "Upload-Offset": str(offset),
                    },
                )
                offset = result["offset"]
        return offset

    def publish_upload(self, upload_id: str, aliases: Iterable[str] | None = None) -> Any:
        return self._request(
            "POST",
            f"/api/uploads/{upload_id}/publish",
            data={"aliases": list(aliases or [])},
        )

    def publish_directory(
        self,
        dataset_id: str,
        release_id: str,
        root: str | Path,
        aliases: Iterable[str] | None = None,
        metadata: dict[str, Any] | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> Any:
        root_path = Path(root)
        artifacts = directory_artifacts(root_path)
        upload = self.create_upload(dataset_id, release_id, artifacts, metadata)
        for artifact in artifacts:
            self.upload_file(upload["upload_id"], artifact["path"], root_path / artifact["path"], chunk_size)
        return self.publish_upload(upload["upload_id"], aliases)

    def resume_directory(
        self,
        upload_id: str,
        root: str | Path,
        aliases: Iterable[str] | None = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> Any:
        root_path = Path(root)
        status = self.upload_status(upload_id)
        local = directory_artifacts(root_path)
        declared = [
            {key: artifact[key] for key in ("path", "size", "sha256")}
            for artifact in status["artifacts"]
        ]
        if local != declared:
            raise ValueError("local directory does not match upload manifest")
        for artifact in local:
            self.upload_file(upload_id, artifact["path"], root_path / artifact["path"], chunk_size)
        return self.publish_upload(upload_id, aliases)

    def set_alias(self, dataset_id: str, alias: str, release_id: str) -> Any:
        return self._request(
            "PUT",
            f"/api/datasets/{quote(dataset_id)}/aliases/{quote(alias)}",
            data={"release_id": release_id},
        )

    def archive_dataset(self, dataset_id: str) -> Any:
        return self._request("POST", f"/api/datasets/{quote(dataset_id)}/archive", data={})
