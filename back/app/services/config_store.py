import json
import os
from pathlib import Path

CONFIG_PATH = Path("data/config.json")

DEFAULT_CONFIG: dict = {
    # LLM
    "llm_provider": os.getenv("LLM_PROVIDER", "openai"),
    "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
    "openai_model": os.getenv("OPENAI_MODEL", "gpt-4.1"),
    "groq_api_key": os.getenv("GROQ_API_KEY", ""),
    "groq_model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", ""),
    "anthropic_model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
    "gemini_api_key": os.getenv("GEMINI_API_KEY", ""),
    "gemini_model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    "ollama_base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
    "ollama_model": os.getenv("OLLAMA_MODEL", "llama3"),
    # Bot
    "playwright_headless": os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true",
    "playwright_slow_mo": int(os.getenv("PLAYWRIGHT_SLOW_MO", "0")),
    "playwright_timeout": int(os.getenv("PLAYWRIGHT_TIMEOUT", "30000")),
    "max_applications_per_run": int(os.getenv("MAX_APPLICATIONS_PER_RUN", "10")),
    "enabled_boards": [b.strip() for b in os.getenv("ENABLED_BOARDS", "linkedin,indeed").split(",")],
    # Job boards
    "linkedin_email": os.getenv("LINKEDIN_EMAIL", ""),
    "linkedin_password": os.getenv("LINKEDIN_PASSWORD", ""),
}


def load_config() -> dict:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
        return dict(DEFAULT_CONFIG)
    stored = json.loads(CONFIG_PATH.read_text())
    # Fill in any keys added after initial creation
    merged = {**DEFAULT_CONFIG, **stored}
    return merged


def save_config(updates: dict) -> dict:
    current = load_config()
    current.update(updates)
    CONFIG_PATH.write_text(json.dumps(current, indent=2))
    return current


def get(key: str):
    return load_config().get(key, DEFAULT_CONFIG.get(key))
