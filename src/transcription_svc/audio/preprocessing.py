"""FFmpeg audio preprocessing pipeline for transcription quality improvement.

Applies: stereo-to-mono, highpass filter, lowpass filter, volume boost,
dynamic range compression, and loudness normalisation.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_FILTER_CHAIN = ",".join([
    "pan=mono|c0=0.5*c0+0.5*c1",
    "highpass=f=100",
    "lowpass=f=8000",
    "volume=3.0",
    "acompressor=threshold=0.1:ratio=4:attack=5:release=50",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
])

_SAMPLE_RATE = 16000


async def preprocess_audio(input_path: Path, output_path: Path) -> None:
    """Enhance audio for transcription accuracy.

    Raises RuntimeError if ffmpeg is not installed or the conversion fails.
    """
    cmd = [
        "ffmpeg",
        "-i", str(input_path),
        "-af", _FILTER_CHAIN,
        "-ar", str(_SAMPLE_RATE),
        "-ac", "1",
        "-y",
        str(output_path),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        raise RuntimeError(
            f"FFmpeg preprocessing failed (exit {proc.returncode}): {stderr.decode()[:500]}"
        )

    logger.info("Preprocessed audio: %s → %s", input_path.name, output_path.name)


async def is_ffmpeg_available() -> bool:
    """Return True if ffmpeg is installed and callable."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        return proc.returncode == 0
    except FileNotFoundError:
        return False
