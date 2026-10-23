"""DIAAT-205: telemetry configuration (hmcts-otel) for the recording API."""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient
from hmcts_otel import default_redactor
from hmcts_otel.testing import capture_telemetry

from transcription_svc.api.app import create_app
from transcription_svc.telemetry import configure_telemetry

APPEAL_FILE = "PA_50123_2024"


def test_appeal_references_are_redacted():
    configure_telemetry()
    assert [rule.name for rule in default_redactor.rules].count("appeal_reference") == 1
    for reference in ("PA/50123/2024", APPEAL_FILE):
        assert reference not in default_redactor.redact(f"uploads/u/{reference}.wav")


def test_upload_exports_no_case_reference_or_email(mocker):
    """The original file name is a case reference; no exported telemetry may carry it."""
    from transcription_svc.database.models import User
    from transcription_svc.utils.dependencies import get_current_user

    manager = mocker.AsyncMock()
    manager.create_blob_from_bytes = mocker.AsyncMock(return_value=True)
    manager.build_blob_url = mocker.Mock(return_value="https://x/y.wav")
    manager.__aenter__ = mocker.AsyncMock(return_value=manager)
    manager.__aexit__ = mocker.AsyncMock(return_value=False)
    mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)
    mocker.patch(
        "transcription_svc.api.routes.normalize_to_wav",
        new=mocker.AsyncMock(return_value=b"WAVDATA"),
    )

    with capture_telemetry() as telemetry:
        configure_telemetry()  # registers the appeal-reference rule
        app = create_app()
        user = mocker.Mock(spec=User)
        user.id = "00000000-0000-0000-0000-000000000001"
        user.email = "judge.smith@justice.gov.uk"
        app.dependency_overrides[get_current_user] = lambda: user
        response = TestClient(app).post(
            "/api/v1/uploads",
            files={"file": (f"{APPEAL_FILE}.mp3", b"fake-audio-bytes", "audio/mpeg")},
        )
        logging.getLogger("transcription_svc").info("processed upload for %s", user.email)

        assert response.status_code == 201, response.text
        assert response.headers.get("X-Request-Id")
        telemetry.assert_no_prohibited_content(APPEAL_FILE, "judge.smith@justice.gov.uk")
        (server,) = [s for s in telemetry.finished_spans() if s.kind.name == "SERVER"]
        # Route template, not the concrete path: names and IDs in paths are not exported.
        assert server.attributes.get("http.route") == "/api/v1/uploads"


def test_appeal_reference_redacted_next_to_underscores_and_in_lower_case():
    configure_telemetry()
    for text in ("uploaded hearing_PA_50123_2024.mp3", "PA_50123_2024_part1.mp3", "pa/50123/2024"):
        assert "50123" not in default_redactor.redact(text)
