# Batch Audio Transcription Service

A microservice that accepts audio, submits it to Azure Batch Speech, polls for completion, and delivers structured transcripts via webhook.

## Features

- Azure Batch Speech API with diarization, profanity filter off, and punctuation mode
- FFmpeg audio preprocessing (mono, normalise, filter)
- Webhook delivery with HMAC-SHA256 signature verification
- `SELECT FOR UPDATE SKIP LOCKED` for safe multi-replica polling
- Idempotent job submission
- API key authentication (Managed Identity in Azure)

## Quick start (local)

**Prerequisites**: Docker, Docker Compose, Azure Speech credentials

```bash
cp .env.example .env
# Add your AZURE_SPEECH_KEY and AZURE_SPEECH_ENDPOINT to .env
docker-compose up
```

The API is available at `http://localhost:8001/docs`.

## Submit a transcription job

```bash
curl -X POST http://localhost:8001/api/v1/jobs \
  -H "Authorization: Bearer local-dev-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "audio_url": "https://your-storage.blob.core.windows.net/container/audio.wav?sig=...",
    "locale": "en-GB",
    "enable_diarization": true,
    "callback_url": "https://your-service.example.com/webhooks/transcript-ready"
  }'
```

## Webhook verification

Incoming webhooks include an `X-Signature-256` header. Verify it:

```python
from transcription_svc.webhook.dispatcher import verify_signature

def handle_webhook(request_body: str, signature_header: str, secret: str) -> bool:
    return verify_signature(request_body, secret, signature_header)
```

## Running tests

```bash
pip install -e ".[dev]"
pytest tests/unit
```

## Environment variables

See [.env.example](.env.example) for all configuration options.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy.
