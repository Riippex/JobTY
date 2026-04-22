"""Indeed job-board plugin.

Implements search, apply (Indeed Apply), and availability check using
async Playwright.

Environment variables:
    PLAYWRIGHT_HEADLESS  — "true" (default) or "false"
    PLAYWRIGHT_SLOW_MO   — ms to slow down actions (default 0)
    PLAYWRIGHT_TIMEOUT   — ms for action timeouts (default 30000)
    MAX_APPLICATIONS_PER_RUN — cap on listings to return (default 5)

Indeed does not require account credentials for searching, but an account
is needed for Indeed Apply. If INDEED_EMAIL / INDEED_PASSWORD are absent,
the apply flow will be skipped gracefully.
"""

import asyncio
import logging
import os
import random
from pathlib import Path

from playwright.async_api import Browser, Page, async_playwright

from app.plugins.base_board import BaseJobBoard, CaptchaDetectedError, JobListing

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
_INDEED_BASE = "https://www.indeed.com"


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


class IndeedBoard(BaseJobBoard):
    """Playwright-based Indeed automation plugin."""

    def __init__(self) -> None:
        self._email = os.getenv("INDEED_EMAIL", "")
        self._password = os.getenv("INDEED_PASSWORD", "")

        if not self._email or not self._password:
            logger.info(
                "INDEED_EMAIL / INDEED_PASSWORD not set — Indeed Apply will be skipped"
            )

        self._headless = _env_headless()
        self._slow_mo = _env_slow_mo()
        self._timeout = _env_timeout()
        self._max_apps = _env_max_apps()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        """Return True when indeed.com loads successfully."""
        try:
            async with async_playwright() as pw:
                browser = await self._launch(pw)
                context = await browser.new_context()
                page = await context.new_page()
                page.set_default_timeout(self._timeout)

                response = await page.goto(
                    _INDEED_BASE, wait_until="domcontentloaded"
                )
                await context.close()
                await browser.close()

                return response is not None and response.ok
        except Exception as exc:
            logger.error("Indeed availability check failed: %s", exc)
            return False

    async def search(
        self,
        keywords: list[str],
        locations: list[str],
        remote_only: bool,
    ) -> list[JobListing]:
        """Return up to MAX_APPLICATIONS_PER_RUN listings from Indeed."""
        listings: list[JobListing] = []

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context = await browser.new_context()
            page = await context.new_page()
            page.set_default_timeout(self._timeout)

            try:
                keyword_str = " ".join(keywords)
                location_str = locations[0] if locations else ""

                url = (
                    f"{_INDEED_BASE}/jobs"
                    f"?q={_url_encode(keyword_str)}"
                    f"&l={_url_encode(location_str)}"
                )
                if remote_only:
                    url += "&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11"

                await page.goto(url, wait_until="domcontentloaded")
                await _human_delay()
                await self._check_captcha(page)

                listings = await self._scrape_listings(page)

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("Indeed search failed: %s", exc)
                await self._screenshot_on_error(page, "indeed_search_error")
            finally:
                await context.close()
                await browser.close()

        return listings[: self._max_apps]

    async def apply(self, job: JobListing, cv_path: str, profile_data: dict) -> bool:
        """Attempt an Indeed Apply application to *job*."""
        if not self._email or not self._password:
            logger.info(
                "Indeed credentials missing — skipping apply for %s", job.url
            )
            return False

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context = await browser.new_context()
            page = await context.new_page()
            page.set_default_timeout(self._timeout)

            try:
                if not await self._login(page):
                    logger.error(
                        "Indeed login failed — cannot apply to %s", job.url
                    )
                    return False

                await page.goto(job.url, wait_until="domcontentloaded")
                await _human_delay()
                await self._check_captcha(page)

                return await self._indeed_apply(page, cv_path, profile_data)

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("Indeed apply failed for %s: %s", job.url, exc)
                await self._screenshot_on_error(page, "indeed_apply_error")
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
        """Sign in to Indeed. Returns True on success."""
        for attempt in range(MAX_RETRIES):
            try:
                await page.goto(
                    f"{_INDEED_BASE}/account/login",
                    wait_until="domcontentloaded",
                )
                await _human_delay()
                await self._check_captcha(page)

                await page.get_by_label("Email address").fill(self._email)
                await _human_delay()

                continue_btn = page.get_by_role("button", name="Continue")
                await continue_btn.click()
                await _human_delay()

                await page.get_by_label("Password").fill(self._password)
                await _human_delay()

                await page.get_by_role("button", name="Sign in").click()

                await page.wait_for_url(
                    lambda url: "/account/login" not in url,
                    timeout=self._timeout,
                )
                logger.debug("Indeed login successful")
                return True

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                backoff = 2**attempt
                logger.warning(
                    "Indeed login attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1,
                    MAX_RETRIES,
                    exc,
                    backoff,
                )
                await asyncio.sleep(backoff)

        logger.error("Indeed login failed after %d attempts", MAX_RETRIES)
        return False

    async def _scrape_listings(self, page: Page) -> list[JobListing]:
        """Extract job cards from the current Indeed search results page."""
        listings: list[JobListing] = []

        try:
            await page.wait_for_selector(
                "#mosaic-provider-jobcards, .jobsearch-ResultsList",
                timeout=self._timeout,
            )
        except Exception:
            logger.warning("Indeed: job results list not found on page")
            return listings

        cards = await page.query_selector_all(
            ".job_seen_beacon, .jobsearch-ResultsList > li"
        )
        logger.debug("Indeed: found %d job cards", len(cards))

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
                logger.warning("Indeed: failed to extract card: %s", exc)
                continue

        return listings

    async def _extract_job_detail(self, page: Page) -> JobListing | None:
        """Extract structured data from the open Indeed job panel."""
        try:
            title_el = page.locator(
                ".jobsearch-JobInfoHeader-title, h1[data-testid='jobsearch-JobInfoHeader-title']"
            ).first
            title = (await title_el.inner_text()).strip()

            company_el = page.locator(
                "[data-testid='inlineHeader-companyName'], .jobsearch-InlineCompanyRating-companyHeader"
            ).first
            company = (await company_el.inner_text()).strip()

            location_el = page.locator(
                "[data-testid='job-location'], .jobsearch-JobInfoHeader-subtitle > div"
            ).first
            location = (await location_el.inner_text()).strip()

            desc_el = page.locator(
                "#jobDescriptionText, .jobsearch-jobDescriptionText"
            ).first
            description = (await desc_el.inner_text()).strip()

            url = page.url

            # Detect Indeed Apply button
            easy_apply = await page.locator(
                "button[id*='indeedApplyButton'], button[aria-label*='Apply now']"
            ).count() > 0

            salary: str | None = None
            salary_el = page.locator(
                "#salaryInfoAndJobType, [data-testid='attribute_snippet_testid']"
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
                source="indeed",
            )
        except Exception as exc:
            logger.warning("Indeed: could not extract job detail: %s", exc)
            return None

    async def _indeed_apply(
        self, page: Page, cv_path: str, profile_data: dict
    ) -> bool:
        """Walk through the Indeed Apply multi-step form."""
        try:
            apply_btn = page.locator(
                "button[id*='indeedApplyButton'], button[aria-label*='Apply now']"
            ).first
            if await apply_btn.count() == 0:
                logger.info("Indeed Apply button not found on %s", page.url)
                return False

            await apply_btn.click()
            await _human_delay()
            await self._check_captcha(page)

            # Upload resume if the field is present
            cv_input = page.locator("input[type='file'][name*='resume'], input[type='file']")
            if await cv_input.count() > 0 and Path(cv_path).exists():
                await cv_input.first.set_input_files(cv_path)
                await _human_delay()

            # Fill phone if required
            phone = profile_data.get("phone", "")
            if phone:
                phone_input = page.get_by_label("Phone number")
                if await phone_input.count() > 0:
                    await phone_input.fill(phone)
                    await _human_delay()

            # Step through form pages
            for _ in range(10):
                continue_btn = page.get_by_role("button", name="Continue")
                review_btn = page.get_by_role("button", name="Review your application")
                submit_btn = page.get_by_role("button", name="Submit your application")

                if await submit_btn.count() > 0:
                    await submit_btn.click()
                    await _human_delay()
                    logger.info("Indeed Apply submitted for %s", page.url)
                    return True

                if await review_btn.count() > 0:
                    await review_btn.click()
                    await _human_delay()
                    continue

                if await continue_btn.count() > 0:
                    await continue_btn.click()
                    await _human_delay()
                    await self._check_captcha(page)
                    continue

                break

        except CaptchaDetectedError:
            raise
        except Exception as exc:
            logger.error("Indeed Apply form error: %s", exc)
            await self._screenshot_on_error(page, "indeed_apply_form_error")

        return False

    async def _check_captcha(self, page: Page) -> None:
        """Raise CaptchaDetectedError if a CAPTCHA challenge is visible."""
        captcha_selectors = [
            "iframe[src*='recaptcha']",
            "iframe[src*='hcaptcha']",
            "[class*='captcha']",
            "#captcha-challenge",
            ".g-recaptcha",
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
            pass


def _url_encode(value: str) -> str:
    from urllib.parse import quote_plus
    return quote_plus(value)
