"""Base interface for all job-board plugins.

Every plugin MUST inherit from BaseJobBoard and implement the three
abstract methods. The dataclass JobListing is the canonical exchange
format between plugins and the agent runner.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class JobListing:
    url: str
    title: str
    company: str
    location: str
    description: str
    salary: str | None = None
    easy_apply: bool = False
    source: str = ""
    extra: dict = field(default_factory=dict)


class CaptchaDetectedError(Exception):
    """Raised when a CAPTCHA challenge is encountered on a job board.

    The agent runner catches this, emits a WebSocket event, and stops
    the current run so a human can intervene.
    """


class BaseJobBoard(ABC):
    """Abstract base class for all job-board automation plugins."""

    @abstractmethod
    async def search(
        self,
        keywords: list[str],
        locations: list[str],
        remote_only: bool,
    ) -> list[JobListing]:
        """Search for job listings matching the given criteria.

        Implementations must respect MAX_APPLICATIONS_PER_RUN when
        capping the number of results returned.
        """

    @abstractmethod
    async def apply(self, job: JobListing, cv_path: str, profile_data: dict) -> bool:
        """Attempt to apply to *job*.

        Returns True when the application was successfully submitted,
        False when the application form was not compatible (e.g. no Easy
        Apply button, mandatory fields missing).

        Must NOT raise on non-critical form errors — log them and return
        False instead. CaptchaDetectedError is the only exception that
        should propagate.
        """

    @abstractmethod
    async def is_available(self) -> bool:
        """Return True when the board is reachable and credentials are valid."""
