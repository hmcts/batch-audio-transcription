from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from transcription_svc.api.routes import limiter, router
from transcription_svc.config.settings import get_settings


_polling_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from transcription_svc.audio.polling_service import BatchPollingService

    settings = get_settings()
    if settings.ENVIRONMENT != "test":
        service = BatchPollingService()
        global _polling_task
        _polling_task = asyncio.create_task(service.run_polling_loop())

    yield

    if _polling_task:
        _polling_task.cancel()
        try:
            await _polling_task
        except asyncio.CancelledError:
            pass


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Batch Audio Transcription Service",
        description="Submits audio to Azure Batch Speech, polls for completion, delivers results via webhook.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.ENVIRONMENT in ("local", "dev") else None,
        redoc_url=None,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    app.include_router(router)
    return app
