from __future__ import annotations

import json
from typing import Any
from urllib.parse import unquote

from .auth import CredentialRegistry
from .core import Forbidden, OffsetConflict, PublicationStore, PublishingError
from .locks import MutationLock

# A representative 100,000-artifact volume inventory serializes to roughly
# 17 MiB. Keep enough headroom for release metadata and longer feature names
# while retaining a bounded request body.
DEFAULT_MAX_JSON_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_CHUNK_BYTES = 16 * 1024 * 1024

_STATUS_TEXT = {
    200: "OK",
    201: "Created",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
}


class PayloadTooLarge(PublishingError):
    status = 413


def _json(start_response, status: int, value: Any):
    body = json.dumps(value, sort_keys=True).encode()
    start_response(
        f"{status} {_STATUS_TEXT.get(status, 'Error')}",
        [("Content-Type", "application/json"), ("Content-Length", str(len(body)))],
    )
    return [body]


class PublishingApplication:
    def __init__(
        self,
        store: PublicationStore,
        credentials: CredentialRegistry,
        *,
        max_json_bytes: int = DEFAULT_MAX_JSON_BYTES,
        max_chunk_bytes: int = DEFAULT_MAX_CHUNK_BYTES,
    ):
        if max_json_bytes <= 0 or max_chunk_bytes <= 0:
            raise ValueError("request size limits must be positive")
        self.store = store
        self.credentials = credentials
        self.max_json_bytes = max_json_bytes
        self.max_chunk_bytes = max_chunk_bytes
        self.mutation_lock = MutationLock(store.state / ".mutation.lock")

    def __call__(self, env, start_response):
        try:
            method = env["REQUEST_METHOD"]
            path = self._path(env)
            body = self._read_body(env, method, path)
            data = self._json_body(env, body)

            if method == "GET":
                return self._handle_get(path, env, start_response)

            with self.mutation_lock.hold():
                return self._handle_mutation(method, path, env, data, body, start_response)
        except PublishingError as error:
            payload: dict[str, Any] = {"error": str(error)}
            if isinstance(error, OffsetConflict):
                payload["expected_offset"] = error.expected_offset
            return _json(start_response, error.status, payload)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            return _json(start_response, 400, {"error": str(error)})

    @staticmethod
    def _path(env) -> list[str]:
        return [unquote(part) for part in env.get("PATH_INFO", "").split("/") if part]

    def _read_body(self, env, method: str, path: list[str]) -> bytes:
        raw_length = env.get("CONTENT_LENGTH") or "0"
        try:
            length = int(raw_length)
        except (TypeError, ValueError) as error:
            raise ValueError("invalid Content-Length") from error
        if length < 0:
            raise ValueError("invalid Content-Length")

        is_chunk = method == "PUT" and len(path) >= 5 and path[:2] == ["api", "uploads"] and path[3] == "files"
        limit = self.max_chunk_bytes if is_chunk else self.max_json_bytes
        if length > limit:
            raise PayloadTooLarge(f"request body exceeds {limit} bytes")

        body = env["wsgi.input"].read(length)
        if len(body) != length:
            raise ValueError("request body is shorter than Content-Length")
        return body

    @staticmethod
    def _json_body(env, body: bytes) -> Any:
        if not body or not env.get("CONTENT_TYPE", "").startswith("application/json"):
            return None
        return json.loads(body)

    def _handle_get(self, path: list[str], env, start_response):
        if path == ["api", "datasets"]:
            return _json(start_response, 200, self.store.list_datasets())
        if len(path) == 3 and path[:2] == ["api", "datasets"]:
            return _json(start_response, 200, self.store.get_dataset(path[2]))
        if len(path) == 3 and path[:2] == ["api", "uploads"]:
            _, state = self._require_upload(env, path[2])
            return _json(start_response, 200, state)
        return _json(start_response, 404, {"error": "not found"})

    def _handle_mutation(self, method: str, path: list[str], env, data, body: bytes, start_response):
        if method == "POST" and path == ["api", "datasets"]:
            return self._create_dataset(env, data, start_response)
        if len(path) >= 3 and path[:2] == ["api", "datasets"]:
            dataset_id = path[2]
            if method == "POST" and path[3:] == ["uploads"]:
                return self._create_upload(env, dataset_id, data, start_response)
            if method == "POST" and path[3:] == ["archive"]:
                return self._archive_dataset(env, dataset_id, start_response)
            if method == "PUT" and len(path) == 5 and path[3] == "aliases":
                return self._set_alias(env, dataset_id, path[4], data, start_response)
        if len(path) >= 3 and path[:2] == ["api", "uploads"]:
            upload_id = path[2]
            if method == "PUT" and len(path) >= 5 and path[3] == "files":
                return self._append_artifact(env, upload_id, path[4:], body, start_response)
            if method == "POST" and path[3:] == ["publish"]:
                return self._publish_upload(env, upload_id, data, start_response)
        return _json(start_response, 404, {"error": "not found"})

    def _create_dataset(self, env, data, start_response):
        credential = self._require(env, create=True)
        value = self.store.create_dataset(data["dataset_id"], data.get("metadata", {}), credential["id"])
        return _json(start_response, 201, value)

    def _create_upload(self, env, dataset_id: str, data, start_response):
        credential = self._require(env, dataset_id)
        value = self.store.create_upload(
            dataset_id,
            data["release_id"],
            data["artifacts"],
            data.get("metadata", {}),
            credential["id"],
        )
        return _json(start_response, 201, value)

    def _archive_dataset(self, env, dataset_id: str, start_response):
        credential = self._require(env, dataset_id)
        return _json(start_response, 200, self.store.archive_dataset(dataset_id, credential["id"]))

    def _set_alias(self, env, dataset_id: str, alias: str, data, start_response):
        credential = self._require(env, dataset_id)
        value = self.store.set_alias(dataset_id, alias, data["release_id"], credential["id"])
        return _json(start_response, 200, value)

    def _append_artifact(self, env, upload_id: str, path_parts: list[str], body: bytes, start_response):
        self._require_upload(env, upload_id)
        offset = int(env.get("HTTP_UPLOAD_OFFSET", "0"))
        value = self.store.append_artifact(upload_id, "/".join(path_parts), offset, body)
        return _json(start_response, 200, value)

    def _publish_upload(self, env, upload_id: str, data, start_response):
        credential, _ = self._require_upload(env, upload_id)
        value = self.store.publish_upload(upload_id, (data or {}).get("aliases", []), credential["id"])
        return _json(start_response, 201, value)

    def _credential(self, env):
        header = env.get("HTTP_AUTHORIZATION", "")
        if not header.startswith("Bearer "):
            return None
        return self.credentials.authenticate(header[7:])

    def _require(self, env, dataset_id: str | None = None, create: bool = False):
        credential = self._credential(env)
        if not credential:
            raise Forbidden("invalid or revoked publisher credential")
        if create and not credential.get("can_create_datasets"):
            raise Forbidden("credential cannot create datasets")
        if dataset_id and self.store.dataset_owner(dataset_id) not in (None, credential["id"]):
            raise Forbidden("credential does not own dataset")
        return credential

    def _require_upload(self, env, upload_id: str):
        credential = self._require(env)
        state = self.store.upload_status(upload_id)
        if self.store.dataset_owner(state["dataset_id"]) != credential["id"]:
            raise Forbidden("credential does not own dataset")
        return credential, state
