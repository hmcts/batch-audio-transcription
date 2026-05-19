from __future__ import annotations

import hmac
from uuid import UUID, uuid4

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from transcription_svc.auth.validators import encrypt_webhook_secret, is_local_env, verify_api_key
from transcription_svc.config.settings import get_settings
from transcription_svc.database.engine import get_session
from transcription_svc.database.interface import get_all_active_callers
from transcription_svc.database.models import Caller


def _local_dev_caller() -> Caller:
    return Caller(
        id=UUID("00000000-0000-0000-0000-000000000001"),
        name="local-dev",
        hashed_key="",
        webhook_secret=encrypt_webhook_secret("local-webhook-secret"),
        is_active=True,
    )


async def get_caller(
    authorization: str = Header(...),
    session: Session = Depends(get_session),
) -> Caller:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")

    token = authorization[7:]

    if is_local_env():
        if hmac.compare_digest(token, get_settings().LOCAL_API_KEY):
            return _local_dev_caller()
        raise HTTPException(status_code=401, detail="Invalid API key")

    callers = get_all_active_callers(session)
    for caller in callers:
        if verify_api_key(token, caller.hashed_key):
            return caller

    raise HTTPException(status_code=401, detail="Invalid API key")
