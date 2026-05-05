"""Browser session persistence for job-board plugins.

Saves Playwright storage state (cookies + localStorage) to disk so the
bot can reuse authenticated sessions across runs without logging in every
time, which drastically reduces CAPTCHA exposure.
"""

import logging
import time
from pathlib import Path

from playwright.async_api import BrowserContext

logger = logging.getLogger(__name__)

# Sessions older than this are considered expired and discarded
_TTL_SECONDS = 6 * 3600  # 6 hours


class SessionManager:
    """Manages a single board's Playwright storage state on disk."""

    def __init__(self, board: str) -> None:
        self._path = Path(f"data/sessions/{board}_session.json")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def exists_and_fresh(self) -> bool:
        """Return True when a saved session file exists and is within TTL."""
        if not self._path.exists():
            return False
        age = time.time() - self._path.stat().st_mtime
        if age >= _TTL_SECONDS:
            logger.debug("Session for %s is stale (%.0f h old) — discarding", self._path.stem, age / 3600)
            return False
        return True

    async def save(self, context: BrowserContext) -> None:
        """Persist the browser context's cookies/localStorage to disk."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        await context.storage_state(path=str(self._path))
        logger.info("Session saved to %s", self._path)

    def storage_state_path(self) -> str:
        """Return the path string to pass to browser.new_context(storage_state=...)."""
        return str(self._path)

    def invalidate(self) -> None:
        """Delete the saved session file so the next run does a fresh login."""
        if self._path.exists():
            self._path.unlink()
            logger.info("Session invalidated: %s", self._path)
