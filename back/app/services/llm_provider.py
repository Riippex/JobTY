"""
Single point of contact for all LLM calls in JobTY.

No other module may import openai, groq, or ollama directly.
Everything goes through the `llm_provider` singleton exposed at the bottom.
"""

import logging
import os
from enum import StrEnum

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class LLMProviderName(StrEnum):
    OPENAI = "openai"
    GROQ = "groq"
    OLLAMA = "ollama"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"


_PARSE_ERROR_MSG = (
    "Return ONLY a valid JSON object that matches the requested schema. "
    "No markdown, no explanation, no code fences — raw JSON only."
)


class LLMParseError(Exception):
    """Raised when the model fails to return parseable JSON after all retries."""

    def __init__(self, message: str, raw_response: str) -> None:
        super().__init__(message)
        self.raw_response = raw_response


class LLMProvider:
    """Unified async interface for OpenAI, Groq, Ollama, Anthropic, and Gemini."""

    def __init__(self) -> None:
        raw = os.getenv("LLM_PROVIDER", "openai").lower()
        try:
            self._provider = LLMProviderName(raw)
        except ValueError:
            raise ValueError(
                f"Unknown LLM_PROVIDER='{raw}'. Must be one of: openai, groq, ollama, anthropic, gemini"
            )

        if self._provider == LLMProviderName.OPENAI:
            import openai  # noqa: PLC0415

            self._client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
            self._model = os.getenv("OPENAI_MODEL", "gpt-4.1")
            self._timeout = 30.0

        elif self._provider == LLMProviderName.GROQ:
            import groq  # noqa: PLC0415

            self._client = groq.AsyncGroq(api_key=os.environ["GROQ_API_KEY"])
            self._model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
            self._timeout = 30.0

        elif self._provider == LLMProviderName.ANTHROPIC:
            import anthropic  # noqa: PLC0415

            self._client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
            self._model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
            self._timeout = 30.0

        elif self._provider == LLMProviderName.GEMINI:
            import google.generativeai as genai  # noqa: PLC0415

            genai.configure(api_key=os.environ["GEMINI_API_KEY"])
            self._model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
            self._timeout = 30.0

        else:  # ollama
            self._base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            self._model = os.getenv("OLLAMA_MODEL", "llama3")
            self._timeout = 120.0

    async def complete(self, prompt: str, system: str = "") -> str:
        """Call the model and return plain text."""
        if self._provider == LLMProviderName.OLLAMA:
            return await self._ollama_complete(prompt, system)
        if self._provider == LLMProviderName.ANTHROPIC:
            return await self._anthropic_complete(prompt, system)
        if self._provider == LLMProviderName.GEMINI:
            return await self._gemini_complete(prompt, system)
        return await self._openai_like_complete(prompt, system)

    async def complete_structured(
        self,
        prompt: str,
        schema: type[BaseModel],
        system: str = "",
    ) -> BaseModel:
        """Call the model and parse the response into a Pydantic model.

        Retries up to 2 times on JSON parse failure, then raises LLMParseError.
        """
        last_raw = ""
        correction_suffix = ""

        for attempt in range(3):
            full_prompt = prompt + correction_suffix
            raw = await self.complete(full_prompt, system=system)
            last_raw = raw

            try:
                cleaned = _strip_code_fences(raw)
                instance = schema.model_validate_json(cleaned)
                if attempt > 0:
                    logger.debug("LLM JSON parsed successfully on attempt %d", attempt + 1)
                return instance
            except Exception as exc:
                logger.warning(
                    "LLM returned invalid JSON (attempt %d/3): %s — raw: %.200s",
                    attempt + 1,
                    exc,
                    raw,
                )
                correction_suffix = (
                    f"\n\nYour previous response could not be parsed. Error: {exc}\n"
                    f"{_PARSE_ERROR_MSG}"
                )

        raise LLMParseError(
            f"Model failed to return valid JSON for {schema.__name__} after 3 attempts",
            raw_response=last_raw,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _openai_like_complete(self, prompt: str, system: str) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
            timeout=self._timeout,
        )
        usage = response.usage
        if usage:
            logger.debug(
                "LLM usage — provider=%s model=%s prompt_tokens=%d completion_tokens=%d",
                self._provider,
                self._model,
                usage.prompt_tokens,
                usage.completion_tokens,
            )
        return response.choices[0].message.content or ""

    async def _anthropic_complete(self, prompt: str, system: str) -> str:
        kwargs: dict = {
            "model": self._model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }
        if system:
            kwargs["system"] = system
        response = await self._client.messages.create(**kwargs)
        logger.debug(
            "LLM usage — provider=anthropic model=%s input_tokens=%d output_tokens=%d",
            self._model,
            response.usage.input_tokens,
            response.usage.output_tokens,
        )
        return response.content[0].text

    async def _gemini_complete(self, prompt: str, system: str) -> str:
        import google.generativeai as genai  # noqa: PLC0415

        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        model = genai.GenerativeModel(self._model)
        response = await model.generate_content_async(full_prompt)
        return response.text

    async def _ollama_complete(self, prompt: str, system: str) -> str:
        payload: dict = {
            "model": self._model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(f"{self._base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data.get("response", "")


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences that some models wrap JSON in."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop opening fence line (```json or ```) and closing fence
        inner = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        text = "\n".join(inner).strip()
    return text


# ---------------------------------------------------------------------------
# Module-level singleton — initialised lazily so tests can patch env vars first
# ---------------------------------------------------------------------------

_instance: LLMProvider | None = None


def get_llm_provider() -> LLMProvider:
    """Return the module-level singleton, creating it on first call."""
    global _instance
    if _instance is None:
        _instance = LLMProvider()
    return _instance
