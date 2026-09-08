import hashlib
import io
import json
import sys
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ChecksumError, EndpointConnectionError, ProfileNotFound
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from ibl_ephys_atlas_publish.core import Conflict, ValidationError
from ibl_ephys_atlas_publish.s3 import BUCKET, Destination, IMMUTABLE_CACHE, _create_verified, checksum
from ibl_ephys_atlas_publish.s3_sdk import AwsSdkStore


@pytest.fixture
def sdk(monkeypatch):
    # Explicit dummy credentials prevent any credential-chain or metadata calls.
    client = boto3.client("s3", region_name="us-east-1",
                          aws_access_key_id="testing", aws_secret_access_key="testing")
    calls = []

    class Session:
        def __init__(self, *, profile_name):
            calls.append(("profile", profile_name))

        def client(self, service, **kwargs):
            calls.append((service, kwargs))
            return client

    monkeypatch.setattr(boto3, "Session", Session)
    store = AwsSdkStore(Destination("staging"), "ibl-atlas")
    with Stubber(client) as stubber:
        yield store, stubber, calls
        stubber.assert_no_pending_responses()
    store.close()


def read_params(key):
    return {"Bucket": BUCKET, "Key": key, "ChecksumMode": "ENABLED"}


def put_params(key, body, etag=None):
    return {"Bucket": BUCKET, "Key": key, "Body": ANY,
            "ChecksumAlgorithm": "SHA256", "ChecksumSHA256": checksum(hashlib.sha256(body).hexdigest()),
            "ContentType": "application/octet-stream", "CacheControl": IMMUTABLE_CACHE,
            **({"IfMatch": etag} if etag is not None else {"IfNoneMatch": "*"})}


def test_profile_region_and_single_client_reuse(sdk):
    store, stubber, calls = sdk
    key = store.destination.key("site/index.html")
    for _ in range(2):
        stubber.add_response("head_object", {"ContentLength": 12}, read_params(key))
        assert store.head(key)["ContentLength"] == 12
    assert calls[0] == ("profile", "ibl-atlas")
    assert len(calls) == 2
    assert calls[1][0] == "s3"
    assert calls[1][1]["region_name"] == "us-east-1"
    assert calls[1][1]["config"].max_pool_connections == store.max_workers == 16


@pytest.mark.parametrize("profile", ["", "--profile"])
def test_explicit_profile_required(profile):
    with pytest.raises(ValidationError, match="explicit AWS profile"):
        AwsSdkStore(Destination("staging"), profile)


@pytest.mark.parametrize("workers", [0, 33, -1, True, 1.5, "16"])
def test_worker_bound_checked_before_credentials(workers):
    with pytest.raises(ValidationError, match="max_workers"):
        AwsSdkStore(Destination("staging"), "ibl-atlas", max_workers=workers)


def test_profile_initialization_error_is_actionable(monkeypatch):
    def unavailable(**kwargs):
        raise ProfileNotFound(profile=kwargs["profile_name"])
    monkeypatch.setattr(boto3, "Session", unavailable)
    with pytest.raises(ValidationError, match="SDK initialization failed"):
        AwsSdkStore(Destination("staging"), "missing")


@pytest.mark.parametrize("key", [Destination("production").key("site/x"),
                                  Destination("staging").root + "../production/site/x",
                                  Destination("staging").root + "site//x"])
def test_invalid_scope_never_calls_aws_or_opens_body(sdk, tmp_path, key, monkeypatch):
    store, _, _ = sdk
    def unexpected(*args, **kwargs):
        raise AssertionError("invalid scope reached the SDK")
    monkeypatch.setattr(store._client, "_make_api_call", unexpected)
    for operation in (lambda: store.head(key), lambda: store.get_json(key),
                      lambda: store.put(key, tmp_path / "absent", sha256="ab" * 32,
                                        content_type="x", cache_control="x")):
        with pytest.raises(ValidationError):
            operation()


@pytest.mark.parametrize("operation", ["head_object", "get_object"])
@pytest.mark.parametrize("code", ["404", "NotFound", "NoSuchKey"])
def test_proven_missing_reads_return_none(sdk, operation, code):
    store, stubber, _ = sdk
    key = store.destination.key("catalog.json")
    stubber.add_client_error(operation, service_error_code=code, http_status_code=404,
                             expected_params=read_params(key))
    assert (store.head(key) if operation == "head_object" else store.get_json(key)) is None


@pytest.mark.parametrize("operation", ["head_object", "get_object"])
@pytest.mark.parametrize("listing", ["empty", "longer-key", "present", "denied", "invalid"])
def test_denied_read_requires_successful_exact_prefix_absence(sdk, operation, listing):
    store, stubber, _ = sdk
    key = store.destination.key("catalog.json")
    stubber.add_client_error(operation, service_error_code="AccessDenied", http_status_code=403,
                             expected_params=read_params(key))
    params = {"Bucket": BUCKET, "Prefix": key, "MaxKeys": 1}
    if listing == "denied":
        stubber.add_client_error("list_objects_v2", service_error_code="AccessDenied",
                                 http_status_code=403, expected_params=params)
    else:
        entries = [] if listing in {"empty", "invalid"} else [{"Key": key + (".backup" if listing == "longer-key" else "")}]
        stubber.add_response("list_objects_v2", {"KeyCount": 1 if listing == "invalid" else len(entries),
                                                 "Contents": entries}, params)
    read = store.head if operation == "head_object" else store.get_json
    if listing in {"empty", "longer-key"}:
        assert read(key) is None
    else:
        with pytest.raises(ValidationError):
            read(key)


@pytest.mark.parametrize("code,status", [("ExpiredToken", 403), ("SlowDown", 503), ("InternalError", 500)])
def test_nonabsence_errors_fail_closed(sdk, code, status):
    store, stubber, _ = sdk
    key = store.destination.key("catalog.json")
    stubber.add_client_error("head_object", service_error_code=code, http_status_code=status,
                             expected_params=read_params(key))
    with pytest.raises(ValidationError):
        store.head(key)


def test_transport_failure_is_not_absence(sdk, monkeypatch):
    store, _, _ = sdk
    def timeout(**kwargs):
        raise EndpointConnectionError(endpoint_url="https://s3.invalid")
    monkeypatch.setattr(store._client, "head_object", timeout)
    with pytest.raises(ValidationError, match="head_object failed"):
        store.head(store.destination.key("catalog.json"))


@pytest.mark.parametrize("value,etag,valid", [({"datasets": []}, '"v1"', True),
                                           ([], '"v1"', False), ({}, None, False)])
def test_json_response_and_etag_are_checked_and_stream_closed(sdk, value, etag, valid):
    store, stubber, _ = sdk
    key = store.destination.key("catalog.json")
    body = json.dumps(value).encode()
    raw = io.BytesIO(body)
    response = {"Body": StreamingBody(raw, len(body))}
    if etag is not None:
        response["ETag"] = etag
    stubber.add_response("get_object", response, read_params(key))
    if valid:
        assert store.get_json(key) == (value, etag)
    else:
        with pytest.raises(ValidationError, match="invalid remote JSON"):
            store.get_json(key)
    assert raw.closed


def test_json_checksum_read_failure_closes_stream_and_fails_closed(sdk):
    store, stubber, _ = sdk
    key = store.destination.key("catalog.json")
    class FailedBody(io.BytesIO):
        def read(self, *args, **kwargs):
            raise ChecksumError(checksum_type="sha256", expected_checksum="expected", actual_checksum="bad")
    raw = FailedBody(b"{}")
    stubber.add_response("get_object", {"Body": StreamingBody(raw, 2), "ETag": '"v1"'}, read_params(key))
    with pytest.raises(ValidationError, match="body failed"):
        store.get_json(key)
    assert raw.closed


@pytest.mark.parametrize("etag", [None, '"prior-version"'])
def test_put_uses_sha256_and_conditional_write_without_content_encoding(sdk, tmp_path, etag):
    store, stubber, _ = sdk
    path = tmp_path / "numeric.f16.gz"
    body = b"opaque bytes; never HTTP gzip"
    path.write_bytes(body)
    key = store.destination.key("datasets/d/releases/r/numeric.f16.gz")
    stubber.add_response("put_object", {}, put_params(key, body, etag))
    store.put(key, path, sha256=hashlib.sha256(body).hexdigest(),
              content_type="application/octet-stream", cache_control=IMMUTABLE_CACHE, expected_etag=etag)


@pytest.mark.parametrize("code", ["PreconditionFailed", "412"])
def test_conditional_put_conflict_is_preserved(sdk, tmp_path, code):
    store, stubber, _ = sdk
    path = tmp_path / "value"
    body = b"value"
    path.write_bytes(body)
    key = store.destination.key("datasets/d/releases/r/value")
    stubber.add_client_error("put_object", service_error_code=code, http_status_code=412,
                             expected_params=put_params(key, body))
    with pytest.raises(Conflict, match="conditional S3 write conflict"):
        store.put(key, path, sha256=hashlib.sha256(body).hexdigest(),
                  content_type="application/octet-stream", cache_control=IMMUTABLE_CACHE)


@pytest.mark.parametrize("bad_field", [None, "ChecksumSHA256", "ContentLength", "ContentType", "CacheControl", "ContentEncoding"])
def test_existing_publisher_verifies_uploaded_bytes_and_serving_metadata(sdk, tmp_path, bad_field):
    store, stubber, _ = sdk
    path = tmp_path / "value"
    body = b"value"
    path.write_bytes(body)
    key = store.destination.key("datasets/d/releases/r/value")
    digest = hashlib.sha256(body).hexdigest()
    artifact = {"size": len(body), "sha256": digest, "content_type": "application/octet-stream"}
    stubber.add_client_error("head_object", service_error_code="404", http_status_code=404,
                             expected_params=read_params(key))
    stubber.add_response("put_object", {}, put_params(key, body))
    head = {"ContentLength": len(body), "ChecksumSHA256": checksum(digest),
            "ContentType": artifact["content_type"], "CacheControl": IMMUTABLE_CACHE}
    if bad_field:
        head[bad_field] = 999 if bad_field == "ContentLength" else "different"
    stubber.add_response("head_object", head, read_params(key))
    if bad_field:
        with pytest.raises(Conflict, match="serving metadata differ"):
            _create_verified(store, key, path, artifact, IMMUTABLE_CACHE)
    else:
        _create_verified(store, key, path, artifact, IMMUTABLE_CACHE)
