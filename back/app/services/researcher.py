"""Company research service.

Gathers information about a company given its domain name.
Results are cached in the companies table and refreshed after 7 days.
"""

import logging
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Company
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)

CACHE_TTL_DAYS = 7

# ------------------------------------------------------------------
# Output schema
# ------------------------------------------------------------------


class CompanyResearch(BaseModel):
    name: str
    """Company name inferred from the domain."""

    description: str
    """What the company does in 2-3 sentences."""

    size: str
    """Estimated company size: "startup" | "mid-size" | "enterprise"."""

    culture_notes: list[str]
    """Observations about culture, work style, or stated values."""

    tech_stack: list[str]
    """Technologies the company is known to use or recruit for."""

    red_flags: list[str]
    """Potential negatives: glassdoor complaints, layoffs, controversies, etc."""


# ------------------------------------------------------------------
# Prompts
# ------------------------------------------------------------------

_SYSTEM_PROMPT = """You are a job-market researcher with deep knowledge of tech companies.
Given a company domain, provide a structured research summary based on publicly known information.
If you have no reliable information about a field, use an empty list or "Unknown".
Respond ONLY with a valid JSON object — no markdown, no explanation, no code fences.

JSON schema you must follow exactly:
{
  "name": "string",
  "description": "string",
  "size": "startup" | "mid-size" | "enterprise",
  "culture_notes": ["string"],
  "tech_stack": ["string"],
  "red_flags": ["string"]
}

Few-shot example output for domain "stripe.com":
{
  "name": "Stripe",
  "description": "Stripe is a global payments infrastructure company enabling businesses to accept online payments. It provides APIs for payment processing, billing, and financial data management.",
  "size": "enterprise",
  "culture_notes": ["High engineering standards and rigorous hiring bar", "Strong writing culture — decisions made via internal documents", "Fast-paced with expectation of ownership"],
  "tech_stack": ["Ruby", "Go", "Java", "React", "AWS", "PostgreSQL"],
  "red_flags": []
}"""


def _build_prompt(domain: str) -> str:
    return (
        f"Research the company at domain: {domain}\n\n"
        "Return the JSON research object now."
    )


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------


async def research_company(domain: str, db: AsyncSession) -> CompanyResearch:
    """Return research for *domain*, using the cache when fresh enough.

    Cache is considered stale after CACHE_TTL_DAYS days.
    """
    domain = domain.lower().strip()

    # Check for a fresh cached entry
    result = await db.execute(select(Company).where(Company.domain == domain))
    company_row = result.scalar_one_or_none()

    if company_row is not None:
        age = datetime.now(UTC) - company_row.researched_at.replace(
            tzinfo=UTC
        )
        if age < timedelta(days=CACHE_TTL_DAYS):
            logger.debug(
                "company research cache hit for domain='%s' (age=%s)", domain, age
            )
            return CompanyResearch.model_validate(company_row.research_json)
        logger.debug(
            "company research cache stale for domain='%s' (age=%s), refreshing", domain, age
        )

    # Call the LLM
    logger.debug("researching company domain='%s' via LLM", domain)
    prompt = _build_prompt(domain)
    provider = get_llm_provider()
    research: CompanyResearch = await provider.complete_structured(
        prompt, CompanyResearch, system=_SYSTEM_PROMPT
    )

    now = datetime.now(UTC)
    serialised = research.model_dump()

    if company_row is None:
        company_row = Company(
            domain=domain,
            research_json=serialised,
            researched_at=now,
        )
        db.add(company_row)
    else:
        company_row.research_json = serialised
        company_row.researched_at = now

    await db.commit()
    return research
