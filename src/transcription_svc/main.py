"""Entry point for the transcription service."""

import logging

import uvicorn

from transcription_svc.api.app import create_app
from transcription_svc.config.settings import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = create_app()

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "transcription_svc.main:app",
        host="0.0.0.0",  # nosec B104
        port=8000,
        reload=settings.ENVIRONMENT == "local",
        log_level="info",
    )
