from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Core
    ENVIRONMENT: str = "local"
    DATABASE_CONNECTION_STRING: str = (
        "postgresql://dev:devpass@localhost:5432/transcription_svc"  # pragma: allowlist secret
    )

    # Azure Speech
    AZURE_SPEECH_KEY: str = ""
    AZURE_SPEECH_ENDPOINT: str = ""
    AZURE_SPEECH_RESOURCE_ID: str | None = None

    # Azure Storage
    AZURE_STORAGE_ACCOUNT_NAME: str = ""
    AZURE_STORAGE_CONTAINER_NAME: str = ""
    # Set in local dev to avoid mounting ~/.azure into Docker.
    # Leave unset in deployed envs — DefaultAzureCredential uses Managed Identity.
    AZURE_STORAGE_CONNECTION_STRING: str | None = None

    # Polling
    BATCH_POLL_INTERVAL_SECONDS: int = 30
    BATCH_TRANSCRIPTION_THRESHOLD_HOURS: float = 2.0

    # Auth
    LOCAL_API_KEY: str = "local-dev-key-change-me"
    # Fernet key (URL-safe base64, 32 bytes) used to encrypt webhook_secret at rest.
    # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # noqa: E501
    # The default is a fixed all-zeros key for local development only.
    WEBHOOK_SECRET_ENCRYPTION_KEY: str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="  # noqa: S105  # gitleaks:allow

    # Webhook delivery
    WEBHOOK_TIMEOUT_SECONDS: float = 30.0
    WEBHOOK_MAX_RETRIES: int = 3

    # Low-confidence word tracking (optional)
    LOW_CONFIDENCE_THRESHOLD: float | None = None

    # Observability
    SENTRY_DSN: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("BATCH_TRANSCRIPTION_THRESHOLD_HOURS")
    @classmethod
    def validate_threshold(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("BATCH_TRANSCRIPTION_THRESHOLD_HOURS must be greater than 0")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
