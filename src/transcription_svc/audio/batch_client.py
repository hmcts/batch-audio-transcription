"""Azure Batch Transcription REST client."""

from __future__ import annotations

from uuid import UUID

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential
from uwotm8 import convert_american_to_british_spelling

from transcription_svc.config.settings import get_settings
from transcription_svc.database.models import DialogueEntry

_TICKS_PER_SECOND: int = 10_000_000
_BATCH_API_VERSION: str = "2024-11-15"
_HTTP_TIMEOUT: float = 30.0
_HTTP_SERVER_ERROR_MIN: int = 500

_RETRY_POLICY = retry(
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
    wait=wait_exponential(multiplier=1, min=4, max=10),
    stop=stop_after_attempt(2),
)


class BatchSubmissionError(Exception):
    """Azure rejected the batch transcription submission."""


class BatchResultError(Exception):
    """Batch transcription results could not be retrieved."""


def _auth_headers() -> dict[str, str]:
    return {"Ocp-Apim-Subscription-Key": get_settings().AZURE_SPEECH_KEY}


def _submit_url() -> str:
    endpoint = get_settings().AZURE_SPEECH_ENDPOINT.rstrip("/")
    return f"{endpoint}/speechtotext/transcriptions?api-version={_BATCH_API_VERSION}"


@_RETRY_POLICY
async def submit_batch_job(
    audio_sas_url: str,
    display_name: str,
    locale: str = "en-GB",
    enable_diarization: bool = True,
) -> str:
    """Submit audio to Azure Batch Transcription.

    Returns the job URL from the Location response header.
    Raises BatchSubmissionError on non-201 response.
    """
    payload: dict = {
        "contentUrls": [audio_sas_url],
        "locale": locale,
        "displayName": display_name,
        "properties": {
            "wordLevelTimestampsEnabled": True,
            "profanityFilterMode": "None",
            "punctuationMode": "DictatedAndAutomatic",
        },
    }

    if enable_diarization:
        payload["properties"]["diarizationEnabled"] = True
        payload["properties"]["diarization"] = {
            "enabled": True,
            "speakers": {"minCount": 1, "maxCount": 5},
        }

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.post(_submit_url(), headers=_auth_headers(), json=payload)

    if response.status_code >= _HTTP_SERVER_ERROR_MIN:
        response.raise_for_status()

    if response.status_code != 201:
        raise BatchSubmissionError(
            f"Batch job submission failed: HTTP {response.status_code} — {response.text}"
        )

    job_url = response.headers.get("Location")
    if not job_url:
        raise BatchSubmissionError(
            "Azure did not return a Location header after batch job submission"
        )

    return job_url


@_RETRY_POLICY
async def get_batch_job_status(job_url: str) -> dict:
    """Return the full Azure batch job status JSON."""
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.get(job_url, headers=_auth_headers())
        response.raise_for_status()
    return response.json()


@_RETRY_POLICY
async def get_batch_results(
    job_url: str,
    transcription_job_id: UUID | None = None,
) -> list[DialogueEntry]:
    """Download and parse batch transcription results."""
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        files_response = await client.get(f"{job_url}/files", headers=_auth_headers())
        files_response.raise_for_status()
        files_data = files_response.json()

        transcription_files = [
            item for item in files_data.get("values", []) if item.get("kind") == "Transcription"
        ]
        if not transcription_files:
            raise BatchResultError(f"No transcription file in batch results for job: {job_url}")

        content_url = transcription_files[0].get("links", {}).get("contentUrl")
        if not content_url:
            raise BatchResultError(
                f"Transcription file missing contentUrl in batch results for job: {job_url}"
            )

        result_response = await client.get(content_url)
        result_response.raise_for_status()
        result_data = result_response.json()

    dialogue_entries: list[DialogueEntry] = []

    for phrase in result_data.get("recognizedPhrases", []):
        n_best = phrase.get("nBest")
        if not n_best:
            continue

        best = n_best[0]
        start_time = phrase.get("offsetInTicks", 0) / _TICKS_PER_SECOND
        end_time = (
            phrase.get("offsetInTicks", 0) + phrase.get("durationInTicks", 0)
        ) / _TICKS_PER_SECOND
        speaker = str(phrase.get("speaker", 0))
        text = convert_american_to_british_spelling(best.get("display", ""))

        dialogue_entries.append(
            DialogueEntry(speaker=speaker, text=text, start_time=start_time, end_time=end_time)
        )

    return dialogue_entries


@_RETRY_POLICY
async def delete_batch_job(job_url: str) -> None:
    """Delete a completed batch job from Azure. Non-fatal on HTTP 404."""
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        response = await client.delete(job_url, headers=_auth_headers())

    if response.status_code == 404:
        return

    response.raise_for_status()
