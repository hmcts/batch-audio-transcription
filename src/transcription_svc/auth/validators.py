from __future__ import annotations

from passlib.context import CryptContext

from transcription_svc.config.settings import get_settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_api_key(plain_key: str, hashed_key: str) -> bool:
    return _pwd_context.verify(plain_key, hashed_key)


def hash_api_key(plain_key: str) -> str:
    return _pwd_context.hash(plain_key)


def is_local_env() -> bool:
    return get_settings().ENVIRONMENT.lower() == "local"
