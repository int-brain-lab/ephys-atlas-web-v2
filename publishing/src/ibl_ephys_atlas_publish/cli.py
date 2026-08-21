from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from wsgiref.simple_server import make_server

from .auth import CredentialRegistry, issue_credential, revoke_credential
from .client import PublishingClient
from .core import PublicationStore
from .maintenance import cleanup_stale_uploads
from .service import DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_JSON_BYTES, PublishingApplication


def _publisher_client(args: argparse.Namespace, parser: argparse.ArgumentParser) -> PublishingClient:
    if not args.token:
        parser.error("publisher token required via --token or IBL_PUBLISH_TOKEN")
    return PublishingClient(args.url, args.token)


def _add_remote_auth(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--url", required=True)
    parser.add_argument("--token", default=os.getenv("IBL_PUBLISH_TOKEN"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ephys-atlas-publish")
    commands = parser.add_subparsers(dest="cmd", required=True)

    serve = commands.add_parser("serve")
    serve.add_argument("--storage", type=Path, required=True)
    serve.add_argument("--credentials", type=Path, required=True)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8080)
    serve.add_argument("--validator-command")
    serve.add_argument(
        "--max-json-bytes",
        type=int,
        default=DEFAULT_MAX_JSON_BYTES,
        help=f"maximum JSON request body size (default: {DEFAULT_MAX_JSON_BYTES})",
    )
    serve.add_argument(
        "--max-chunk-bytes",
        type=int,
        default=DEFAULT_MAX_CHUNK_BYTES,
        help=f"maximum binary upload chunk size (default: {DEFAULT_MAX_CHUNK_BYTES})",
    )

    create_credential = commands.add_parser("credential-create")
    create_credential.add_argument("--credentials", type=Path, required=True)
    create_credential.add_argument("--label", required=True)
    create_credential.add_argument("--can-create-datasets", action="store_true")

    revoke = commands.add_parser("credential-revoke")
    revoke.add_argument("--credentials", type=Path, required=True)
    revoke.add_argument("credential_id")

    cleanup = commands.add_parser("cleanup-staging")
    cleanup.add_argument("--storage", type=Path, required=True)
    cleanup.add_argument(
        "--older-than-hours",
        type=float,
        default=24 * 7,
        help="remove staging uploads inactive for at least this many hours (default: 168)",
    )

    create_dataset = commands.add_parser("dataset-create")
    _add_remote_auth(create_dataset)
    create_dataset.add_argument("dataset_id")
    create_dataset.add_argument("--title")

    publish = commands.add_parser("publish")
    _add_remote_auth(publish)
    publish.add_argument("dataset_id")
    publish.add_argument("release_id")
    publish.add_argument("directory", type=Path)
    publish.add_argument("--alias", action="append", default=[])

    resume = commands.add_parser("resume")
    _add_remote_auth(resume)
    resume.add_argument("upload_id")
    resume.add_argument("directory", type=Path)
    resume.add_argument("--alias", action="append", default=[])

    archive = commands.add_parser("archive")
    _add_remote_auth(archive)
    archive.add_argument("dataset_id")
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.cmd == "serve":
        store = PublicationStore(args.storage, validator_command=args.validator_command)
        app = PublishingApplication(
            store,
            CredentialRegistry(args.credentials),
            max_json_bytes=args.max_json_bytes,
            max_chunk_bytes=args.max_chunk_bytes,
        )
        make_server(args.host, args.port, app).serve_forever()
        return 0

    if args.cmd == "credential-create":
        credential_id, token = issue_credential(
            args.credentials,
            label=args.label,
            can_create_datasets=args.can_create_datasets,
        )
        print(json.dumps({"credential_id": credential_id, "token": token}, indent=2))
        return 0

    if args.cmd == "credential-revoke":
        revoke_credential(args.credentials, args.credential_id)
        return 0

    if args.cmd == "cleanup-staging":
        removed = cleanup_stale_uploads(
            PublicationStore(args.storage),
            older_than_seconds=args.older_than_hours * 3600,
        )
        print(json.dumps({"removed_upload_ids": removed, "count": len(removed)}, indent=2))
        return 0

    client = _publisher_client(args, parser)
    if args.cmd == "dataset-create":
        result = client.create_dataset(
            args.dataset_id,
            {"title": args.title} if args.title else {},
        )
    elif args.cmd == "publish":
        result = client.publish_directory(
            args.dataset_id,
            args.release_id,
            args.directory,
            args.alias,
        )
    elif args.cmd == "resume":
        result = client.resume_directory(args.upload_id, args.directory, args.alias)
    elif args.cmd == "archive":
        result = client.archive_dataset(args.dataset_id)
    else:  # pragma: no cover - argparse owns command validation
        raise AssertionError(args.cmd)
    print(json.dumps(result, indent=2))
    return 0
