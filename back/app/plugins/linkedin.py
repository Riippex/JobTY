"""LinkedIn job-board plugin.

Implements search, apply (Easy Apply), and availability check using
async Playwright. All credentials come from environment variables —
never hardcode them here.

Environment variables:
    LINKEDIN_EMAIL       — account email
    LINKEDIN_PASSWORD    — account password
    PLAYWRIGHT_HEADLESS  — "true" (default) or "false"
    PLAYWRIGHT_SLOW_MO   — ms to slow down actions (default 0)
    PLAYWRIGHT_TIMEOUT   — ms for action timeouts (default 30000)
    MAX_APPLICATIONS_PER_RUN — cap on listings to return (default 5)
"""

import asyncio
import logging
import os
import random
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from app.plugins.base_board import BaseJobBoard, CaptchaDetectedError, JobListing

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
_LINKEDIN_BASE = "https://www.linkedin.com"


def _env_headless() -> bool:
    return os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() != "false"


def _env_slow_mo() -> float:
    return float(os.getenv("PLAYWRIGHT_SLOW_MO", "0"))


def _env_timeout() -> float:
    return float(os.getenv("PLAYWRIGHT_TIMEOUT", "30000"))


def _env_max_apps() -> int:
    return int(os.getenv("MAX_APPLICATIONS_PER_RUN", "5"))


async def _human_delay() -> None:
    """Sleep a random interval to mimic human browsing pace."""
    await asyncio.sleep(random.uniform(1.5, 3.5))


class LinkedInBoard(BaseJobBoard):
    """Playwright-based LinkedIn automation plugin."""

    def __init__(self) -> None:
        self._email = os.getenv("LINKEDIN_EMAIL", "")
        self._password = os.getenv("LINKEDIN_PASSWORD", "")

        if not self._email or not self._password:
            logger.warning(
                "LINKEDIN_EMAIL or LINKEDIN_PASSWORD not set — LinkedInBoard will be unavailable"
            )

        self._headless = _env_headless()
        self._slow_mo = _env_slow_mo()
        self._timeout = _env_timeout()
        self._max_apps = _env_max_apps()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        """Return True when credentials allow a successful LinkedIn login."""
        if not self._email or not self._password:
            return False

        try:
            async with async_playwright() as pw:
                browser = await self._launch(pw)
                context = await browser.new_context()
                page = await context.new_page()
                page.set_default_timeout(self._timeout)

                logged_in = await self._login(page)
                await context.close()
                await browser.close()
                return logged_in
        except Exception as exc:
            logger.error("LinkedIn availability check failed: %s", exc)
            return False

    async def search(
        self,
        keywords: list[str],
        locations: list[str],
        remote_only: bool,
    ) -> list[JobListing]:
        """Return up to MAX_APPLICATIONS_PER_RUN job listings from LinkedIn Jobs."""
        listings: list[JobListing] = []

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            # Fresh context per session to avoid cross-session tracking
            context = await browser.new_context()
            page = await context.new_page()
            page.set_default_timeout(self._timeout)

            try:
                if not await self._login(page):
                    logger.error("LinkedIn login failed — aborting search")
                    return listings

                keyword_str = " ".join(keywords)
                location_str = locations[0] if locations else ""

                url = (
                    f"{_LINKEDIN_BASE}/jobs/search/"
                    f"?keywords={_url_encode(keyword_str)}"
                    f"&location={_url_encode(location_str)}"
                )
                if remote_only:
                    url += "&f_WT=2"  # LinkedIn remote filter

                await page.goto(url, wait_until="domcontentloaded")
                await _human_delay()

                await self._check_captcha(page)

                listings = await self._scrape_listings(page)
            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("LinkedIn search failed: %s", exc)
                await self._screenshot_on_error(page, "linkedin_search_error")
            finally:
                await context.close()
                await browser.close()

        return listings[: self._max_apps]

    async def apply(self, job: JobListing, cv_path: str, profile_data: dict) -> bool:
        """Attempt an Easy Apply application to *job*."""
        if not job.easy_apply:
            logger.info("Skipping %s — no Easy Apply button", job.url)
            return False

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context = await browser.new_context()
            page = await context.new_page()
            page.set_default_timeout(self._timeout)

            try:
                if not await self._login(page):
                    logger.error("LinkedIn login failed — cannot apply to %s", job.url)
                    return False

                await page.goto(job.url, wait_until="domcontentloaded")
                await _human_delay()
                await self._check_captcha(page)

                return await self._easy_apply(page, cv_path, profile_data)

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("LinkedIn apply failed for %s: %s", job.url, exc)
                await self._screenshot_on_error(page, "linkedin_apply_error")
                return False
            finally:
                await context.close()
                await browser.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _launch(self, pw) -> Browser:
        return await pw.chromium.launch(
            headless=self._headless,
            slow_mo=self._slow_mo,
        )

    async def _login(self, page: Page) -> bool:
        """Navigate to LinkedIn login and authenticate. Returns True on success."""
        for attempt in range(MAX_RETRIES):
            try:
                await page.goto(
                    f"{_LINKEDIN_BASE}/login",
                    wait_until="domcontentloaded",
                )
                await _human_delay()
                await self._check_captcha(page)

                await page.get_by_label("Email or phone").fill(self._email)
                await _human_delay()
                await page.get_by_label("Password").fill(self._password)
                await _human_delay()
                await page.get_by_role("button", name="Sign in").click()

                # Wait for navigation away from login page
                await page.wait_for_url(
                    lambda url: "/login" not in url,
                    timeout=self._timeout,
                )
                logger.debug("LinkedIn login successful")
                return True

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                backoff = 2**attempt
                logger.warning(
                    "LinkedIn login attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1,
                    MAX_RETRIES,
                    exc,
                    backoff,
                )
                await asyncio.sleep(backoff)

        logger.error("LinkedIn login failed after %d attempts", MAX_RETRIES)
        return False

    async def _scrape_listings(self, page: Page) -> list[JobListing]:
        """Extract job cards from the current search results page."""
        listings: list[JobListing] = []

        try:
            # Wait for the job cards list to appear
            await page.wait_for_selector(
                "ul.jobs-search__results-list, .scaffold-layout__list-container",
                timeout=self._timeout,
            )
        except Exception:
            logger.warning("LinkedIn: job results list not found on page")
            return listings

        cards = await page.query_selector_all(
            ".job-card-container, .jobs-search-results__list-item"
        )
        logger.debug("LinkedIn: found %d job cards", len(cards))

        for card in cards[: self._max_apps]:
            try:
                await card.click()
                await _human_delay()
                await self._check_captcha(page)

                listing = await self._extract_job_detail(page)
                if listing:
                    listings.append(listing)
            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.warning("LinkedIn: failed to extract card: %s", exc)
                continue

        return listings

    async def _extract_job_detail(self, page: Page) -> JobListing | None:
        """Extract structured data from the open job detail panel."""
        try:
            title_el = page.locator(".jobs-unified-top-card__job-title, h1").first
            title = (await title_el.inner_text()).strip()

            company_el = page.locator(
                ".jobs-unified-top-card__company-name, .jobs-unified-top-card__primary-description a"
            ).first
            company = (await company_el.inner_text()).strip()

            location_el = page.locator(
                ".jobs-unified-top-card__bullet, .jobs-unified-top-card__workplace-type"
            ).first
            location = (await location_el.inner_text()).strip()

            desc_el = page.locator("#job-details, .jobs-description-content").first
            description = (await desc_el.inner_text()).strip()

            url = page.url

            # Detect Easy Apply button
            easy_apply = await page.locator(
                "button.jobs-apply-button[aria-label*='Easy Apply']"
            ).count() > 0

            salary: str | None = None
            salary_el = page.locator(
                ".jobs-unified-top-card__job-insight--highlight"
            ).first
            if await salary_el.count() > 0:
                salary = (await salary_el.inner_text()).strip() or None

            return JobListing(
                url=url,
                title=title,
                company=company,
                location=location,
                description=description,
                salary=salary,
                easy_apply=easy_apply,
                source="linkedin",
            )
        except Exception as exc:
            logger.warning("LinkedIn: could not extract job detail: %s", exc)
            return None

    async def _easy_apply(self, page: Page, cv_path: str, profile_data: dict) -> bool:
        """Walk through the Easy Apply multi-step form."""
        try:
            apply_btn = page.get_by_role(
                "button", name="Easy Apply"
            )
            if await apply_btn.count() == 0:
                logger.info("Easy Apply button not found on %s", page.url)
                return False

            await apply_btn.click()
            await _human_delay()
            await self._check_captcha(page)

            # Upload CV if the file upload field is present
            cv_input = page.locator("input[type='file']")
            if await cv_input.count() > 0 and Path(cv_path).exists():
                await cv_input.set_input_files(cv_path)
                await _human_delay()

            # Fill basic text fields that match profile data
            phone = profile_data.get("phone", "")
            if phone:
                phone_input = page.get_by_label("Phone number")
                if await phone_input.count() > 0:
                    await phone_input.fill(phone)
                    await _human_delay()

            # Step through form pages
            for _ in range(10):
                next_btn = page.get_by_role("button", name="Next")
                review_btn = page.get_by_role("button", name="Review")
                submit_btn = page.get_by_role("button", name="Submit application")

                if await submit_btn.count() > 0:
                    await submit_btn.click()
                    await _human_delay()
                    logger.info("LinkedIn Easy Apply submitted for %s", page.url)
                    return True

                if await review_btn.count() > 0:
                    await review_btn.click()
                    await _human_delay()
                    continue

                if await next_btn.count() > 0:
                    await next_btn.click()
                    await _human_delay()
                    await self._check_captcha(page)
                    continue

                # No known navigation button found — bail
                break

        except CaptchaDetectedError:
            raise
        except Exception as exc:
            logger.error("LinkedIn Easy Apply form error: %s", exc)
            await self._screenshot_on_error(page, "linkedin_easy_apply_error")

        return False

    async def _check_captcha(self, page: Page) -> None:
        """Raise CaptchaDetectedError if a CAPTCHA challenge is visible."""
        captcha_selectors = [
            "iframe[src*='recaptcha']",
            "iframe[src*='hcaptcha']",
            "[class*='captcha']",
            "#captcha-challenge",
        ]
        for selector in captcha_selectors:
            if await page.locator(selector).count() > 0:
                raise CaptchaDetectedError(
                    f"CAPTCHA detected on {page.url}"
                )

    @staticmethod
    async def _screenshot_on_error(page: Page, name: str) -> None:
        """Save a screenshot for post-mortem debugging."""
        try:
            screenshots_dir = Path("data/screenshots")
            screenshots_dir.mkdir(parents=True, exist_ok=True)
            path = screenshots_dir / f"{name}.png"
            await page.screenshot(path=str(path))
            logger.debug("Screenshot saved to %s", path)
        except Exception:
            pass  # Never crash inside an error handler


def _url_encode(value: str) -> str:
    from urllib.parse import quote_plus
    return quote_plus(value)
