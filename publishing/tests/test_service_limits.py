from __future__ import annotations

import importlib
from io import BytesIO
import json
import math

from ibl_ephys_atlas_publish.cli import build_parser
from ibl_ephys_atlas_publish.service import PublishingApplication


class FakeStore:
    def __init__(self, state):
        self.state = state

    def list_datasets(self):
        return {"schemaVersion": "0.1", "datasets": []}

    def dataset_owner(self, _dataset_id):
        return "publisher-1"

    def create_upload(self, dataset_id, release_id, artifacts, metadata, credential_id):
        assert credential_id == "publisher-1"
        return {
            "upload_id": "upload-1",
            "dataset_id": dataset_id,
            "release_id": release_id,
            "artifact_count": len(artifacts),
            "metadata": metadata,
        }


class FakeCredentials:
    def __init__(self, authenticated=False):
        self.authenticated = authenticated

    def authenticate(self, _token):
        if self.authenticated:
            return {"id": "publisher-1", "can_create_datasets": True}
        return None


def request(
    app,
    *,
    method="GET",
    path="/api/datasets",
    body=b"",
    content_type="application/json",
    content_length=None,
    authenticated=False,
):
    response = {}

    def start_response(status, headers):
        response["status"] = status
        response["headers"] = dict(headers)

    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "CONTENT_LENGTH": str(len(body)) if content_length is None else content_length,
        "CONTENT_TYPE": content_type,
        "wsgi.input": BytesIO(body),
    }
    if authenticated:
        env["HTTP_AUTHORIZATION"] = "Bearer token"
    payload = b"".join(app(env, start_response))
    response["json"] = json.loads(payload)
    return response


def test_get_catalog_does_not_require_authentication(tmp_path):
    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials())
    response = request(app)
    assert response["status"].startswith("200 ")
    assert response["json"]["datasets"] == []


def test_json_body_limit_is_enforced_before_authentication(tmp_path):
    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials(), max_json_bytes=8)
    response = request(app, method="POST", body=b"123456789")
    assert response["status"].startswith("413 ")
    assert "exceeds 8 bytes" in response["json"]["error"]


def test_default_json_limit_accepts_representative_volume_inventory(tmp_path):
    # The measured 25 um volume shape is 528 x 456 x 320. A 41-feature,
    # depth-four orthogonal-slice release uses 13,366 pack artifacts, plus one
    # feature descriptor per feature. This request is larger than the old 2 MiB
    # limit and exercises a near-production inventory without large file bytes.
    shape = (528, 456, 320)
    artifacts = []
    for feature_index in range(41):
        feature_id = f"feature_{feature_index:02d}.denoised"
        artifacts.append(
            {
                "path": f"features/{feature_id}/feature.json",
                "size": 1234,
                "sha256": "0" * 64,
            }
        )
        for axis, axis_size in zip(("coronal", "sagittal", "horizontal"), shape):
            for pack_index in range(math.ceil(axis_size / 4)):
                artifacts.append(
                    {
                        "path": (
                            f"features/{feature_id}/volume/{axis}/packs/"
                            f"{pack_index:03d}.f16.gz"
                        ),
                        "size": 123456,
                        "sha256": "0" * 64,
                    }
                )
    body = json.dumps(
        {"release_id": "2026_W12", "artifacts": artifacts, "metadata": {}}
    ).encode()
    assert len(body) > 2 * 1024 * 1024

    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials(authenticated=True))
    response = request(
        app,
        method="POST",
        path="/api/datasets/ephys_atlas_volumes/uploads",
        body=body,
        authenticated=True,
    )
    assert response["status"].startswith("201 ")
    assert response["json"]["artifact_count"] == len(artifacts)


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


def test_cli_exposes_independent_request_limits():
    args = build_parser().parse_args(
        [
            "serve",
            "--storage",
            "/tmp/storage",
            "--credentials",
            "/tmp/credentials.json",
            "--max-json-bytes",
            "123",
            "--max-chunk-bytes",
            "45",
        ]
    )
    assert args.max_json_bytes == 123
    assert args.max_chunk_bytes == 45


def test_wsgi_deployment_reads_independent_request_limits(tmp_path, monkeypatch):
    monkeypatch.setenv("IBL_PUBLISH_STORAGE", str(tmp_path / "storage"))
    monkeypatch.setenv("IBL_PUBLISH_CREDENTIALS", str(tmp_path / "credentials.json"))
    monkeypatch.setenv("IBL_PUBLISH_MAX_JSON_BYTES", "123")
    monkeypatch.setenv("IBL_PUBLISH_MAX_CHUNK_BYTES", "45")
    wsgi = importlib.import_module("ibl_ephys_atlas_publish.wsgi")
    app = wsgi.create_app()
    assert app.max_json_bytes == 123
    assert app.max_chunk_bytes == 45


def test_malformed_content_length_is_rejected(tmp_path):
    app = PublishingApplication(FakeStore(tmp_path), FakeCredentials())
    response = request(
        app,
        method="POST",
        body=b"{}",
        content_length="not-a-number",
    )
    assert response["status"].startswith("400 ")
    assert "invalid Content-Length" in response["json"]["error"]


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
