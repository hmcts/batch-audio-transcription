"""Unit tests for the Azure Batch Transcription REST client."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


def _make_response(body=None, status_code=200, headers=None):
    mock = MagicMock(spec=httpx.Response)
    mock.status_code = status_code
    mock.headers = headers or {}
    mock.json.return_value = body or {}
    mock.text = str(body)
    mock.raise_for_status = MagicMock()
    return mock


class TestSubmitBatchJob:
    @pytest.mark.asyncio
    async def test_returns_job_url_on_201(self):
        from transcription_svc.audio.batch_client import submit_batch_job

        mock_response = _make_response(
            status_code=201,
            headers={
                "Location": "https://eastus.cognitiveservices.azure.com/speechtotext/transcriptions/abc-123"
            },
        )
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)

            result = await submit_batch_job("https://sas-url", "test-job")

        assert (
            result
            == "https://eastus.cognitiveservices.azure.com/speechtotext/transcriptions/abc-123"
        )

    @pytest.mark.asyncio
    async def test_raises_on_non_201(self):
        from transcription_svc.audio.batch_client import BatchSubmissionError, submit_batch_job

        mock_response = _make_response(status_code=400)
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)

            with pytest.raises(BatchSubmissionError):
                await submit_batch_job("https://sas-url", "test-job")

    @pytest.mark.asyncio
    async def test_includes_diarization_when_enabled(self):
        from transcription_svc.audio.batch_client import submit_batch_job

        mock_response = _make_response(
            status_code=201,
            headers={
                "Location": "https://eastus.cognitiveservices.azure.com/speechtotext/transcriptions/xyz"
            },
        )
        captured_payload = {}

        async def capture_post(url, headers, json):
            captured_payload.update(json)
            return mock_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = capture_post

            await submit_batch_job("https://sas-url", "test-job", enable_diarization=True)

        assert captured_payload["properties"]["diarizationEnabled"] is True
        assert "diarization" in captured_payload["properties"]

    @pytest.mark.asyncio
    async def test_omits_diarization_when_disabled(self):
        from transcription_svc.audio.batch_client import submit_batch_job

        mock_response = _make_response(
            status_code=201,
            headers={
                "Location": "https://eastus.cognitiveservices.azure.com/speechtotext/transcriptions/xyz"
            },
        )
        captured_payload = {}

        async def capture_post(url, headers, json):
            captured_payload.update(json)
            return mock_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = capture_post

            await submit_batch_job("https://sas-url", "test-job", enable_diarization=False)

        assert "diarizationEnabled" not in captured_payload.get("properties", {})

    @pytest.mark.asyncio
    async def test_profanity_filter_and_punctuation_always_set(self):
        from transcription_svc.audio.batch_client import submit_batch_job

        mock_response = _make_response(
            status_code=201,
            headers={
                "Location": "https://eastus.cognitiveservices.azure.com/speechtotext/transcriptions/xyz"
            },
        )
        captured_payload = {}

        async def capture_post(url, headers, json):
            captured_payload.update(json)
            return mock_response

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = capture_post

            await submit_batch_job("https://sas-url", "test-job")

        props = captured_payload["properties"]
        assert props["profanityFilterMode"] == "None"
        assert props["punctuationMode"] == "DictatedAndAutomatic"


class TestGetBatchResults:
    @pytest.mark.asyncio
    async def test_returns_dialogue_entries(self):
        from transcription_svc.audio.batch_client import get_batch_results

        files_data = {
            "values": [{"kind": "Transcription", "links": {"contentUrl": "https://results-url"}}]
        }
        result_data = {
            "recognizedPhrases": [
                {
                    "offsetInTicks": 10_000_000,
                    "durationInTicks": 20_000_000,
                    "speaker": 1,
                    "nBest": [{"display": "Hello world", "words": []}],
                }
            ]
        }

        def make_response_for(url, **kwargs):
            if "files" in url:
                return _make_response(body=files_data)
            return _make_response(body=result_data)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(side_effect=make_response_for)

            entries = await get_batch_results("https://job-url")

        assert len(entries) == 1
        assert entries[0].speaker == "1"
        assert entries[0].start_time == pytest.approx(1.0)

    @pytest.mark.asyncio
    async def test_raises_when_no_transcription_file(self):
        from transcription_svc.audio.batch_client import BatchResultError, get_batch_results

        files_data = {"values": [{"kind": "Report", "links": {}}]}

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=_make_response(body=files_data))

            with pytest.raises(BatchResultError):
                await get_batch_results("https://job-url")

    @pytest.mark.asyncio
    async def test_skips_phrase_with_empty_nbest(self):
        from transcription_svc.audio.batch_client import get_batch_results

        files_data = {
            "values": [{"kind": "Transcription", "links": {"contentUrl": "https://results-url"}}]
        }
        result_data = {
            "recognizedPhrases": [
                {"offsetInTicks": 0, "durationInTicks": 0, "speaker": 0, "nBest": []},
                {
                    "offsetInTicks": 10_000_000,
                    "durationInTicks": 5_000_000,
                    "speaker": 1,
                    "nBest": [{"display": "Hello", "words": []}],
                },
            ]
        }

        def make_response_for(url, **kwargs):
            if "files" in url:
                return _make_response(body=files_data)
            return _make_response(body=result_data)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(side_effect=make_response_for)

            entries = await get_batch_results("https://job-url")

        assert len(entries) == 1


class TestDeleteBatchJob:
    @pytest.mark.asyncio
    async def test_non_fatal_on_404(self):
        from transcription_svc.audio.batch_client import delete_batch_job

        mock_response = _make_response(status_code=404)
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.delete = AsyncMock(return_value=mock_response)

            await delete_batch_job("https://job-url")  # no exception

    @pytest.mark.asyncio
    async def test_succeeds_on_204(self):
        from transcription_svc.audio.batch_client import delete_batch_job

        mock_response = _make_response(status_code=204)
        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.delete = AsyncMock(return_value=mock_response)

            await delete_batch_job("https://job-url")
