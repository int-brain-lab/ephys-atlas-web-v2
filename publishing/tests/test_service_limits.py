from __future__ import annotations

from io import BytesIO
import json

from ibl_ephys_atlas_publish.service import PublishingApplication


class FakeStore:
    def __init__(self, state):
        self.state = state

    def list_datasets(self):
        return {"schemaVersion": "0.1", "datasets": []}


class FakeCredentials:
    def authenticate(self, _token):
        return None


def request(app, *, method="GET", path="/api/datasets", body=b"", content_type="application/json"):
    response = {}

    def start_response(status, headers):
        response["status"] = status
        response["headers"] = dict(headers)

    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "CONTENT_LENGTH": str(len(body)),
        "CONTENT_TYPE": content_type,
        "wsgi.input": BytesIO(body),
    }
    payload = b"".join(app(env, start_response))
    response["json"] = json.loads(payload)
    return response


def test_get_catalog_does_not_require_authentication(tmp_path):
    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials())
    response = request(app)
    assert response["status"].startswith("200 ")
    assert response["json"]["datasets"] == []


def test_json_body_limit_is_enforced_before_authentication(tmp_path):
    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials(), max_json_bytes=4)
    response = request(app, method="POST", body=b'{"abc":1}')
    assert response["status"].startswith("413 ")
    assert "exceeds 4 bytes" in response["json"]["error"]


def test_chunk_limit_is_distinct_from_json_limit(tmp_path):
    app = PublishingApplication(
        FakeStore(tmp_path),
        FakeCredentials(),
        max_json_bytes=4,
        max_chunk_bytes=8,
    )
    response = request(
        app,
        method="PUT",
        path="/api/uploads/upload-1/files/data.bin",
        body=b"123456789",
        content_type="application/octet-stream",
    )
    assert response["status"].startswith("413 ")
    assert "exceeds 8 bytes" in response["json"]["error"]


def test_short_wsgi_body_is_rejected(tmp_path):
    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials())
    captured = {}

    def start_response(status, headers):
        captured["status"] = status
        captured["headers"] = dict(headers)

    env = {
        "REQUEST_METHOD": "POST",
        "PATH_INFO": "/api/datasets",
        "CONTENT_LENGTH": "10",
        "CONTENT_TYPE": "application/json",
        "wsgi.input": BytesIO(b"{}"),
    }
    payload = json.loads(b"".join(app(env, start_response)))
    assert captured["status"].startswith("400 ")
    assert "shorter than Content-Length" in payload["error"]
