"""DIAAT-287: telemetry validation scenarios and their prohibited-content evidence.

Every test in this package that uses ``tel`` has everything it exported scanned on
teardown (prohibited_content.scan): a finding fails the test. At the end of the session
the results of every scanned scenario are written to
``test-results/telemetry-pii-scan.json`` (gitignored; CI uploads it as an artefact),
the automated PII test result attached to the release evidence.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
from dataclasses import asdict
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

import pytest
from hmcts_otel.testing import capture_telemetry

from tests.unit.validation.prohibited_content import PATTERNS, SEEDED, Counts, scan
from transcription_svc.telemetry import configure_telemetry

EVIDENCE_PATH = Path("test-results") / "telemetry-pii-scan.json"

_scenarios: list[dict] = []


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from transcription_svc.api.routes import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def tel(request):
    """Capture the scenario's telemetry; on teardown, scan all of it (AC3)."""
    with capture_telemetry() as capture:
        configure_telemetry()  # the service schema and redaction rules, as deployed
        yield capture
        result = scan(capture)
    _scenarios.append(
        {
            "scenario": request.node.nodeid,
            "counts": asdict(result.counts),
            "findings": [finding.as_dict() for finding in result.findings],
            "result": "pass" if result.passed else "fail",
        }
    )
    if not result.passed:
        pytest.fail(f"prohibited content in exported telemetry: {result.summary()}")


def _commit() -> str | None:
    sha = os.environ.get("GITHUB_SHA")
    if sha:
        return sha
    try:
        return subprocess.run(  # noqa: S603 - fixed arguments, evidence metadata only
            ["git", "rev-parse", "HEAD"],  # noqa: S607
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        ).stdout.strip()
    except Exception:  # noqa: BLE001 - evidence metadata is best effort
        return None


def pytest_sessionfinish(session, exitstatus):
    if not _scenarios:
        return
    totals = Counts()
    for scenario in _scenarios:
        totals.add(Counts(**scenario["counts"]))
    failed = [s["scenario"] for s in _scenarios if s["result"] != "pass"]
    evidence = {
        "check": "DIAAT-287 automated prohibited-content (PII) scan of exported telemetry",
        "epic": "DIAAT-205",
        "ticket": "DIAAT-287",
        "generated_at": datetime.now(UTC).isoformat(),
        "commit": _commit(),
        "python": platform.python_version(),
        "hmcts_otel": version("hmcts-otel"),
        "result": "fail" if failed else "pass",
        "scenarios_scanned": len(_scenarios),
        "scenarios_failed": failed,
        "totals": asdict(totals),
        "seeded_values": sorted(SEEDED),  # labels only, never the values
        "patterns": {name: pattern.pattern for name, pattern in PATTERNS.items()},
        "scope": (
            "span names, attributes, status descriptions, events and links; log record "
            "bodies and attributes (custom events included); metric data point attributes"
        ),
        "scenarios": _scenarios,
    }
    path = Path(session.config.rootpath) / EVIDENCE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(evidence, indent=2) + "\n")
