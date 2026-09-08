"""Optional persistent-client transport for the existing S3 publication protocol.

The publisher still owns snapshots, integrity checks, ordering and transactions.
Importing this module requires neither boto3 nor AWS credentials. Operators using
this adapter must install the repository's locked scientific environment.
"""
from __future__ import annotations

import json
from pathlib import Path

from .core import Conflict, ValidationError, _relpath
from .s3 import BUCKET, Destination, checksum


class AwsSdkStore:
    """Use one profile-bound S3 client and its connection pool for every object."""

    def __init__(self, destination: Destination, profile: str, *, max_workers: int = 16):
        if not profile or profile.startswith("-"):
            raise ValidationError("an explicit AWS profile is required")
        if type(max_workers) is not int or not 1 <= max_workers <= 32:
            raise ValidationError("SDK max_workers must be an integer between 1 and 32")
        try:
            import boto3
            from botocore.config import Config
            from botocore.exceptions import BotoCoreError
        except ImportError as exc:
            raise ValidationError("SDK publication requires the locked scientific environment (boto3)") from exc
        self.destination = destination
        self.profile = profile
        self.max_workers = max_workers
        try:
            self._client = boto3.Session(profile_name=profile).client(
                "s3", region_name="us-east-1",
                config=Config(max_pool_connections=max_workers,
                              retries={"mode": "standard", "total_max_attempts": 3}),
            )
        except BotoCoreError as exc:
            raise ValidationError(f"AWS SDK initialization failed: {exc}") from exc

    def close(self) -> None:
        self._client.close()

    def _check_key(self, key: str) -> None:
        if not key.startswith(self.destination.root):
            raise ValidationError("S3 key escapes the selected deployment root")
        _relpath(key[len(self.destination.root):])

    def _absent_with_scoped_listing(self, key: str) -> bool:
        from botocore.exceptions import BotoCoreError, ClientError
        try:
            result = self._client.list_objects_v2(Bucket=BUCKET, Prefix=key, MaxKeys=1)
        except (BotoCoreError, ClientError):
            return False
        entries = result.get("Contents", [])
        if (not isinstance(entries, list) or result.get("KeyCount") != len(entries)
                or any(not isinstance(entry, dict) or not isinstance(entry.get("Key"), str) for entry in entries)):
            raise ValidationError("invalid S3 listing response")
        return not any(entry["Key"] == key for entry in entries)

    def _call(self, operation: str, key: str, **arguments) -> dict | None:
        from botocore.exceptions import BotoCoreError, ClientError
        self._check_key(key)
        try:
            return getattr(self._client, operation)(Bucket=BUCKET, Key=key, **arguments)
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if operation in {"head_object", "get_object"}:
                if code in {"404", "NoSuchKey", "NotFound"}:
                    return None
                if code in {"403", "AccessDenied"} and self._absent_with_scoped_listing(key):
                    return None
            if code in {"412", "PreconditionFailed"}:
                raise Conflict(f"conditional S3 write conflict: {key}") from exc
            raise ValidationError(f"AWS {operation} failed for {key}: {exc}") from exc
        except BotoCoreError as exc:
            raise ValidationError(f"AWS {operation} failed for {key}: {exc}") from exc

    def head(self, key: str) -> dict | None:
        return self._call("head_object", key, ChecksumMode="ENABLED")

    def get_json(self, key: str) -> tuple[dict, str] | None:
        from botocore.exceptions import BotoCoreError
        result = self._call("get_object", key, ChecksumMode="ENABLED")
        if result is None:
            return None
        body = result["Body"]
        try:
            value = json.loads(body.read())
        except BotoCoreError as exc:
            raise ValidationError(f"AWS get_object body failed for {key}: {exc}") from exc
        finally:
            body.close()
        if not isinstance(value, dict) or not isinstance(result.get("ETag"), str):
            raise ValidationError(f"invalid remote JSON object: {key}")
        return value, result["ETag"]

    def put(self, key: str, path: Path, *, sha256: str, content_type: str,
            cache_control: str, expected_etag: str | None = None) -> None:
        self._check_key(key)
        condition = {"IfMatch": expected_etag} if expected_etag is not None else {"IfNoneMatch": "*"}
        with path.open("rb") as body:
            self._call("put_object", key, Body=body,
                       ChecksumAlgorithm="SHA256", ChecksumSHA256=checksum(sha256),
                       ContentType=content_type, CacheControl=cache_control, **condition)
