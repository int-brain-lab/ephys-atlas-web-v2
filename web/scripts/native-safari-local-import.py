#!/usr/bin/env python3
"""Drive a configurable local-import smoke test through native Safari WebDriver.

The caller owns the running safaridriver, application server, archive, and
screenshot destination. Results are emitted as JSON on standard output and are
explicitly identified as native Safari rather than Playwright WebKit evidence.
"""

from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request


ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run a focused local-import smoke test in native Safari."
    )
    parser.add_argument("--driver", required=True, help="Running safaridriver base URL.")
    parser.add_argument("--url", required=True, help="Viewer URL in Safari's secure context.")
    parser.add_argument("--archive", required=True, help="Absolute archive path on the Mac.")
    parser.add_argument("--screenshot", required=True, help="Output PNG path on the Mac.")
    parser.add_argument(
        "--expected-preview-marker",
        action="append",
        dest="expected_preview_markers",
        help=(
            "Text required in the validated preview; repeat for multiple markers. "
            "Defaults to the authored-regional fixture markers."
        ),
    )
    parser.add_argument(
        "--expected-feature",
        default="Decision signal",
        help="Expected active feature label after import (default: %(default)s).",
    )
    parser.add_argument(
        "--expected-summary-marker",
        default="Observations4",
        help="Text required in the feature summary after import (default: %(default)s).",
    )
    parser.add_argument(
        "--expected-query-dataset",
        default="local",
        help="Expected dataset query value after import (default: %(default)s).",
    )
    parser.add_argument(
        "--expected-query-release",
        default="authored_regional_fixture@authored-regional-v1",
        help="Expected release query value after import (default: %(default)s).",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=600.0,
        help="Maximum wait for each import phase, including large archives (default: %(default)s).",
    )
    args = parser.parse_args()
    if args.timeout_seconds <= 0:
        parser.error("--timeout-seconds must be greater than zero")
    expected_preview_markers = args.expected_preview_markers or [
        "Public authoring regional fixture",
        "decision_signal",
        "ibl-ephys-atlas-regional-authoring-v1",
    ]
    started = time.monotonic()
    phases: dict[str, float] = {}
    session_id: str | None = None

    def request(method: str, path: str, payload: object | None = None) -> object:
        body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{args.driver}{path}",
            data=body,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=max(60.0, args.timeout_seconds)) as response:
                document = json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"WebDriver HTTP {error.code}: {detail}") from error
        value = document.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(f"WebDriver {value['error']}: {value.get('message', '')}")
        return value

    def session_request(method: str, path: str, payload: object | None = None) -> object:
        assert session_id is not None
        return request(method, f"/session/{session_id}{path}", payload)

    def find(selector: str, timeout: float = 20) -> str:
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                value = session_request(
                    "POST", "/element", {"using": "css selector", "value": selector}
                )
                assert isinstance(value, dict)
                return str(value[ELEMENT_KEY])
            except Exception as error:
                last_error = error
                time.sleep(0.2)
        raise RuntimeError(f"element not found: {selector}; last error: {last_error}")

    def execute(script: str, arguments: list[object] | None = None) -> object:
        return session_request(
            "POST", "/execute/sync", {"script": script, "args": arguments or []}
        )

    def wait_script(script: str, arguments: list[object] | None = None, timeout: float = 20) -> object:
        deadline = time.monotonic() + timeout
        observed: object = None
        while time.monotonic() < deadline:
            observed = execute(script, arguments)
            if observed:
                return observed
            time.sleep(0.2)
        raise RuntimeError(f"script condition timed out; last value: {observed!r}")

    def text(selector: str, timeout: float = 20) -> str:
        element = find(selector, timeout)
        return str(session_request("GET", f"/element/{element}/text"))

    def wait_text(selector: str, expected: str, timeout: float = 30) -> str:
        deadline = time.monotonic() + timeout
        observed = ""
        while time.monotonic() < deadline:
            try:
                observed = text(selector, 2)
                if expected in observed:
                    return observed
            except Exception:
                pass
            time.sleep(0.25)
        raise RuntimeError(f"{selector} did not contain {expected!r}; observed {observed!r}")

    def wait_displayed(selector: str, displayed: bool = True, timeout: float = 20) -> str:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                element = find(selector, 2)
                value = bool(session_request("GET", f"/element/{element}/displayed"))
                if value is displayed:
                    return element
            except Exception:
                if not displayed:
                    return ""
            time.sleep(0.2)
        raise RuntimeError(f"{selector} did not reach displayed={displayed}")

    def click(selector: str) -> None:
        wait_script(
            "const element = document.querySelector(arguments[0]); "
            "if (!element) return false; element.click(); return true;",
            [selector],
        )

    def screenshot() -> None:
        if session_id is None:
            return
        encoded = session_request("GET", "/screenshot")
        with open(args.screenshot, "wb") as stream:
            stream.write(base64.b64decode(str(encoded)))

    result: dict[str, object] = {
        "format": "native-safari-local-import-smoke-v2",
        "browser": "Safari",
        "transport": "native safaridriver WebDriver",
        "distinct_from": "Playwright WebKit",
        "url": args.url,
        "archive": args.archive,
        "expectations": {
            "preview_markers": expected_preview_markers,
            "feature": args.expected_feature,
            "summary_marker": args.expected_summary_marker,
            "query_dataset": args.expected_query_dataset,
            "query_release": args.expected_query_release,
            "timeout_seconds": args.timeout_seconds,
        },
    }
    try:
        value = request(
            "POST",
            "/session",
            {"capabilities": {"alwaysMatch": {"browserName": "safari"}}},
        )
        assert isinstance(value, dict)
        session_id = str(value["sessionId"])
        result["capabilities"] = value.get("capabilities")
        phases["session_ms"] = round((time.monotonic() - started) * 1000, 1)

        session_request("POST", "/window/rect", {"width": 1440, "height": 1000})
        session_request("POST", "/url", {"url": args.url})
        wait_script(
            "return Boolean(document.querySelector('.atlas-app'));",
            timeout=args.timeout_seconds,
        )
        phases["app_ready_ms"] = round((time.monotonic() - started) * 1000, 1)

        click('[data-context-field="data"] .context-menu__trigger')
        click('[data-context-option="__import_local_dataset__"]')
        file_input = find(".local-import__input")
        session_request("POST", f"/element/{file_input}/value", {"text": args.archive})
        validation_status = wait_text(
            "[data-local-import-status]",
            "Validation complete",
            timeout=args.timeout_seconds,
        )
        preview_text = text("[data-local-import-preview]")
        for expected in expected_preview_markers:
            if expected not in preview_text:
                raise RuntimeError(f"preview missing {expected!r}")
        phases["preview_ready_ms"] = round((time.monotonic() - started) * 1000, 1)

        click(".local-import__confirm")
        wait_script(
            "const element = document.querySelector('.local-import'); "
            "return Boolean(element && !element.open);",
            timeout=args.timeout_seconds,
        )
        wait_script(
            "const element = document.querySelector(arguments[0]); "
            "return Boolean(element && !element.hidden);",
            ['[data-context-field="data"] .context-field__local-badge'],
            timeout=args.timeout_seconds,
        )
        feature = wait_text(
            '[data-context-field="feature"] .context-field__value',
            args.expected_feature,
            timeout=args.timeout_seconds,
        )
        summary = wait_text(
            ".feature-summary",
            args.expected_summary_marker,
            timeout=args.timeout_seconds,
        )
        current_url = str(session_request("GET", "/url"))
        query = urllib.parse.parse_qs(urllib.parse.urlparse(current_url).query)
        if query.get("dataset") != [args.expected_query_dataset] or query.get(
            "release"
        ) != [args.expected_query_release]:
            raise RuntimeError(f"local identity missing from URL: {current_url}")
        phases["admitted_ms"] = round((time.monotonic() - started) * 1000, 1)

        session_request("POST", "/refresh", {})
        wait_script(
            "const element = document.querySelector(arguments[0]); "
            "return Boolean(element && !element.hidden);",
            ['[data-context-field="data"] .context-field__local-badge'],
            timeout=args.timeout_seconds,
        )
        reload_feature = wait_text(
            '[data-context-field="feature"] .context-field__value',
            args.expected_feature,
            timeout=args.timeout_seconds,
        )
        reload_summary = wait_text(
            ".feature-summary",
            args.expected_summary_marker,
            timeout=args.timeout_seconds,
        )
        phases["reload_ready_ms"] = round((time.monotonic() - started) * 1000, 1)
        wait_script(
            "const frames = [...document.querySelectorAll('.view-frame')]; "
            "return frames.length === 3 "
            "&& frames.every((frame) => frame.dataset.state === 'ready');",
            timeout=args.timeout_seconds,
        )
        phases["views_ready_ms"] = round((time.monotonic() - started) * 1000, 1)
        screenshot()
        result.update(
            {
                "success": True,
                "validation_status": validation_status,
                "preview_assertions": "passed",
                "feature": feature,
                "summary_contains_expected_marker": args.expected_summary_marker in summary,
                "local_identity_url": current_url,
                "reload_feature": reload_feature,
                "reload_summary_contains_expected_marker": args.expected_summary_marker
                in reload_summary,
            }
        )
    except Exception as error:
        result.update({"success": False, "error": str(error)})
        try:
            screenshot()
        except Exception as screenshot_error:
            result["screenshot_error"] = str(screenshot_error)
    finally:
        result["phases"] = phases
        result["total_ms"] = round((time.monotonic() - started) * 1000, 1)
        if session_id is not None:
            try:
                request("DELETE", f"/session/{session_id}")
            except Exception as error:
                result["session_delete_error"] = str(error)
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
