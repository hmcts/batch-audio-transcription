"""Entry point for the transcription service."""

import uvicorn

from transcription_svc.api.app import create_app
from transcription_svc.config.settings import get_settings

# Logging (JSON, redacted), tracing, metrics and Sentry are configured by
# create_app() through hmcts-otel (transcription_svc/telemetry.py).
app = create_app()

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "transcription_svc.main:app",
        host="0.0.0.0",  # nosec B104
        port=8000,
        reload=settings.ENVIRONMENT == "local",
        log_level="info",
        access_log=False,
    )
