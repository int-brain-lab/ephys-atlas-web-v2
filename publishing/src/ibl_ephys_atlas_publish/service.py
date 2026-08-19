from __future__ import annotations

import json
from urllib.parse import unquote
from .auth import CredentialRegistry
from .core import Forbidden, OffsetConflict, PublicationStore, PublishingError


def _json(start_response, status: int, value):
    body = json.dumps(value, sort_keys=True).encode()
    start_response(f"{status} { {200:'OK',201:'Created',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',409:'Conflict',422:'Unprocessable Entity'}.get(status,'Error') }",
                   [("Content-Type", "application/json"), ("Content-Length", str(len(body)))])
    return [body]


class PublishingApplication:
    def __init__(self, store: PublicationStore, credentials: CredentialRegistry):
        self.store = store; self.credentials = credentials

    def _credential(self, env):
        header = env.get("HTTP_AUTHORIZATION", "")
        if not header.startswith("Bearer "): return None
        return self.credentials.authenticate(header[7:])

    def _require(self, env, dataset_id=None, create=False):
        c = self._credential(env)
        if not c: raise Forbidden("invalid or revoked publisher credential")
        if create and not c.get("can_create_datasets"): raise Forbidden("credential cannot create datasets")
        if dataset_id and self.store.dataset_owner(dataset_id) not in (None, c["id"]): raise Forbidden("credential does not own dataset")
        return c

    def _require_upload(self, env, upload_id):
        c = self._require(env)
        state = self.store.upload_status(upload_id)
        if self.store.dataset_owner(state["dataset_id"]) != c["id"]:
            raise Forbidden("credential does not own dataset")
        return c, state

    def __call__(self, env, start_response):
        try:
            method = env["REQUEST_METHOD"]; path = [unquote(x) for x in env.get("PATH_INFO", "").split("/") if x]
            body = env["wsgi.input"].read(int(env.get("CONTENT_LENGTH") or 0))
            data = json.loads(body) if body and env.get("CONTENT_TYPE", "").startswith("application/json") else None
            if method == "GET" and path == ["api", "datasets"]: return _json(start_response, 200, self.store.list_datasets())
            if method == "GET" and len(path) == 3 and path[:2] == ["api", "datasets"]: return _json(start_response, 200, self.store.get_dataset(path[2]))
            if method == "POST" and path == ["api", "datasets"]:
                c = self._require(env, create=True); return _json(start_response, 201, self.store.create_dataset(data["dataset_id"], data.get("metadata", {}), c["id"]))
            if len(path) >= 3 and path[:2] == ["api", "datasets"]:
                dataset_id = path[2]
                if method == "POST" and path[3:] == ["uploads"]:
                    c = self._require(env, dataset_id); return _json(start_response, 201, self.store.create_upload(dataset_id, data["release_id"], data["artifacts"], data.get("metadata", {}), c["id"]))
                if method == "POST" and path[3:] == ["archive"]:
                    c = self._require(env, dataset_id); return _json(start_response, 200, self.store.archive_dataset(dataset_id, c["id"]))
                if method == "PUT" and len(path) == 5 and path[3] == "aliases":
                    c = self._require(env, dataset_id); return _json(start_response, 200, self.store.set_alias(dataset_id, path[4], data["release_id"], c["id"]))
            if len(path) >= 3 and path[:2] == ["api", "uploads"]:
                upload_id = path[2]
                if method == "GET" and len(path) == 3:
                    _, state = self._require_upload(env, upload_id)
                    return _json(start_response, 200, state)
                if method == "PUT" and len(path) >= 5 and path[3] == "files":
                    self._require_upload(env, upload_id)
                    file_path = "/".join(path[4:])
                    offset = int(env.get("HTTP_UPLOAD_OFFSET", "0"))
                    return _json(start_response, 200, self.store.append_artifact(upload_id, file_path, offset, body))
                if method == "POST" and path[3:] == ["publish"]:
                    c, _ = self._require_upload(env, upload_id)
                    return _json(start_response, 201, self.store.publish_upload(upload_id, (data or {}).get("aliases", []), c["id"]))
            return _json(start_response, 404, {"error": "not found"})
        except PublishingError as e:
            payload = {"error": str(e)}
            if isinstance(e, OffsetConflict): payload["expected_offset"] = e.expected_offset
            return _json(start_response, e.status, payload)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as e:
            return _json(start_response, 400, {"error": str(e)})
