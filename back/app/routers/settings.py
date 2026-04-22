from fastapi import APIRouter
from pydantic import BaseModel

from app.services import config_store
from app.services.llm_provider import reset_provider

router = APIRouter(tags=["settings"])

_LLM_KEYS = {
    "llm_provider", "openai_api_key", "openai_model",
    "groq_api_key", "groq_model", "anthropic_api_key", "anthropic_model",
    "gemini_api_key", "gemini_model", "ollama_base_url", "ollama_model",
}


def _mask(value: str, show_last: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= show_last:
        return "****"
    return value[:6] + "****" + value[-show_last:]


class SettingsResponse(BaseModel):
    llm_provider: str
    openai_api_key: str
    openai_model: str
    groq_api_key: str
    groq_model: str
    anthropic_api_key: str
    anthropic_model: str
    gemini_api_key: str
    gemini_model: str
    ollama_base_url: str
    ollama_model: str
    playwright_headless: bool
    playwright_slow_mo: int
    playwright_timeout: int
    max_applications_per_run: int
    enabled_boards: list[str]
    linkedin_email: str
    linkedin_password: str


class SettingsUpdate(BaseModel):
    llm_provider: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None
    groq_api_key: str | None = None
    groq_model: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str | None = None
    gemini_api_key: str | None = None
    gemini_model: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str | None = None
    playwright_headless: bool | None = None
    playwright_slow_mo: int | None = None
    playwright_timeout: int | None = None
    max_applications_per_run: int | None = None
    enabled_boards: list[str] | None = None
    linkedin_email: str | None = None
    linkedin_password: str | None = None


def _to_response(cfg: dict) -> SettingsResponse:
    sensitive = {"openai_api_key", "groq_api_key", "anthropic_api_key", "gemini_api_key", "linkedin_password"}
    masked = {k: (_mask(v) if k in sensitive and isinstance(v, str) else v) for k, v in cfg.items()}
    return SettingsResponse(**masked)


@router.get("", response_model=SettingsResponse)
async def get_settings() -> SettingsResponse:
    return _to_response(config_store.load_config())


@router.put("", response_model=SettingsResponse)
async def update_settings(payload: SettingsUpdate) -> SettingsResponse:
    updates = {
        k: v for k, v in payload.model_dump(exclude_none=True).items()
        # Don't overwrite existing key with empty string
        if not (isinstance(v, str) and v == "")
    }
    llm_changed = bool(updates.keys() & _LLM_KEYS)
    cfg = config_store.save_config(updates)
    if llm_changed:
        reset_provider()
    return _to_response(cfg)
