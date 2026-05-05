"""LinkedIn job-board plugin.

Anti-detection strategy (layered):
  1. Session reuse — saves Playwright storage state after first login so
     subsequent runs skip the login page entirely (lowest CAPTCHA risk).
  2. playwright-stealth — patches fingerprinting properties that expose
     Playwright (navigator.webdriver, chrome.runtime, canvas, etc.).
  3. Realistic browser args — removes automation indicators at launch.
  4. Human-like timing — randomised delays between every action.
  5. Rate limiting — hard cap via MAX_APPLICATIONS_PER_RUN.

Manual login flow:
  Call LinkedInBoard.manual_login() once (triggered from the API).
  A headed browser opens; the user logs in; the session is saved.
  Subsequent runs reuse the session silently.
"""

import asyncio
import logging
import os
import platform
import random
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from app.plugins.base_board import BaseJobBoard, CaptchaDetectedError, JobListing
from app.services import config_store
from app.services.session_manager import SessionManager

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
_LINKEDIN_BASE = "https://www.linkedin.com"

# Recent Chrome UA — avoids headless-UA fingerprinting
_REALISTIC_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# Browser launch args that hide automation signals
_STEALTH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-infobars",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _apply_stealth(page: Page) -> None:
    """Apply playwright-stealth patches when the package is installed."""
    try:
        from playwright_stealth import stealth_async  # type: ignore[import]
        await stealth_async(page)
    except ImportError:
        pass  # Degrade gracefully — install playwright-stealth for best results


async def _short_delay() -> None:
    """100–600 ms — between minor UI interactions."""
    await asyncio.sleep(random.uniform(0.1, 0.6))


async def _medium_delay() -> None:
    """1.2–4 s — after page loads and between cards."""
    await asyncio.sleep(random.uniform(1.2, 4.0))


async def _long_delay() -> None:
    """8–20 s — between job applications to stay under rate limits."""
    await asyncio.sleep(random.uniform(8.0, 20.0))


async def _human_type(page: Page, locator, text: str) -> None:
    """Type text character-by-character with random inter-key delays."""
    await locator.click()
    await _short_delay()
    for char in text:
        await page.keyboard.type(char)
        await asyncio.sleep(random.uniform(0.04, 0.16))


def _url_encode(value: str) -> str:
    from urllib.parse import quote_plus
    return quote_plus(value)


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------


class LinkedInBoard(BaseJobBoard):
    """Playwright-based LinkedIn automation plugin."""

    def __init__(self) -> None:
        self._email: str = config_store.get("linkedin_email") or ""
        self._password: str = config_store.get("linkedin_password") or ""

        if not self._email or not self._password:
            logger.warning(
                "linkedin_email / linkedin_password not configured — "
                "LinkedInBoard will fall back to session-only mode"
            )

        self._headless: bool = bool(config_store.get("playwright_headless") if config_store.get("playwright_headless") is not None else True)
        self._slow_mo: float = float(config_store.get("playwright_slow_mo") or 0)
        self._timeout: float = float(config_store.get("playwright_timeout") or 30_000)
        self._max_apps: int = int(config_store.get("max_applications_per_run") or 5)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        """Return True when a valid session exists or credentials allow login."""
        session = SessionManager("linkedin")
        if session.exists_and_fresh():
            return True
        return bool(self._email and self._password)

    async def search(
        self,
        keywords: list[str],
        locations: list[str],
        remote_only: bool,
    ) -> list[JobListing]:
        """Return up to max_applications_per_run job listings from LinkedIn."""
        listings: list[JobListing] = []

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context, page = await self._get_authenticated_page(browser)

            try:
                keyword_str = " ".join(keywords)
                location_str = locations[0] if locations else ""

                url = (
                    f"{_LINKEDIN_BASE}/jobs/search/"
                    f"?keywords={_url_encode(keyword_str)}"
                    f"&location={_url_encode(location_str)}"
                )
                if remote_only:
                    url += "&f_WT=2"

                await page.goto(url, wait_until="domcontentloaded")
                await _medium_delay()
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
            logger.info("Skipping %s — no Easy Apply", job.url)
            return False

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context, page = await self._get_authenticated_page(browser)

            try:
                await page.goto(job.url, wait_until="domcontentloaded")
                await _medium_delay()
                await self._check_captcha(page)

                result = await self._easy_apply(page, cv_path, profile_data)
                if result:
                    await _long_delay()  # Rate limit between successful applications
                return result

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("LinkedIn apply failed for %s: %s", job.url, exc)
                await self._screenshot_on_error(page, "linkedin_apply_error")
                return False
            finally:
                await context.close()
                await browser.close()

    @classmethod
    async def manual_login(cls) -> bool:
        """Open a headed browser so the user can log in to LinkedIn manually.

        Saves the session to disk when the user completes login.
        Blocks until login is detected or the 3-minute timeout expires.
        Returns True on success.
        """
        if platform.system() == "Linux" and not os.environ.get("DISPLAY"):
            raise RuntimeError(
                "No display server available. "
                "Manual login requires running the backend directly on your machine "
                "(not inside Docker/WSL without a display). "
                "Use LinkedIn credentials in Settings instead."
            )

        session = SessionManager("linkedin")

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=False,  # Always headed for manual login
                slow_mo=100,
                args=_STEALTH_ARGS,
            )
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent=_REALISTIC_UA,
                locale="en-US",
            )
            page = await context.new_page()
            await _apply_stealth(page)
            page.set_default_timeout(180_000)

            try:
                await page.goto(f"{_LINKEDIN_BASE}/login", wait_until="domcontentloaded")
                logger.info("Manual login: browser opened — waiting for user to log in")

                # Wait up to 3 minutes for the user to complete login
                await page.wait_for_url(
                    lambda url: "/login" not in url and "/checkpoint" not in url,
                    timeout=180_000,
                )

                await session.save(context)
                logger.info("Manual login: session saved successfully")
                return True

            except Exception as exc:
                logger.error("Manual login failed or timed out: %s", exc)
                return False
            finally:
                await context.close()
                await browser.close()

    # ------------------------------------------------------------------
    # Internal — session & auth
    # ------------------------------------------------------------------

    async def _launch(self, pw) -> Browser:
        return await pw.chromium.launch(
            headless=self._headless,
            slow_mo=self._slow_mo,
            args=_STEALTH_ARGS,
        )

    def _new_context_kwargs(self) -> dict:
        return {
            "viewport": {"width": 1366, "height": 768},
            "user_agent": _REALISTIC_UA,
            "locale": "en-US",
        }

    async def _get_authenticated_page(
        self, browser: Browser
    ) -> tuple[BrowserContext, Page]:
        """Return an authenticated (context, page) pair.

        Strategy:
          1. Try loading a saved session — verify it's still logged in.
          2. Fall back to credential-based login and save the new session.
        """
        session = SessionManager("linkedin")

        if session.exists_and_fresh():
            ctx = await browser.new_context(
                storage_state=session.storage_state_path(),
                **self._new_context_kwargs(),
            )
            page = await ctx.new_page()
            page.set_default_timeout(self._timeout)
            await _apply_stealth(page)

            if await self._is_logged_in(page):
                logger.info("LinkedIn: reusing saved session")
                return ctx, page

            logger.info("LinkedIn: saved session expired — falling back to credentials")
            session.invalidate()
            await ctx.close()

        # Credential-based login
        if not self._email or not self._password:
            raise RuntimeError(
                "No valid session and no credentials configured. "
                "Use POST /agent/login-linkedin to log in manually."
            )

        ctx = await browser.new_context(**self._new_context_kwargs())
        page = await ctx.new_page()
        page.set_default_timeout(self._timeout)
        await _apply_stealth(page)

        if not await self._login(page):
            await ctx.close()
            raise RuntimeError("LinkedIn credential login failed after retries")

        await session.save(ctx)
        logger.info("LinkedIn: logged in with credentials, session saved")
        return ctx, page

    async def _is_logged_in(self, page: Page) -> bool:
        """Navigate to /feed/ and confirm the session is still authenticated."""
        try:
            await page.goto(
                f"{_LINKEDIN_BASE}/feed/",
                wait_until="domcontentloaded",
                timeout=15_000,
            )
            url = page.url
            return "/login" not in url and "/checkpoint" not in url
        except Exception:
            return False

    async def _login(self, page: Page) -> bool:
        """Log in with stored credentials. Returns True on success."""
        for attempt in range(MAX_RETRIES):
            try:
                await page.goto(
                    f"{_LINKEDIN_BASE}/login",
                    wait_until="domcontentloaded",
                )
                await _medium_delay()
                await self._check_captcha(page)

                email_field = page.get_by_label("Email or phone")
                password_field = page.get_by_label("Password")

                await _human_type(page, email_field, self._email)
                await _medium_delay()
                await _human_type(page, password_field, self._password)
                await _short_delay()
                await page.get_by_role("button", name="Sign in").click()

                await page.wait_for_url(
                    lambda url: "/login" not in url,
                    timeout=self._timeout,
                )
                logger.debug("LinkedIn credential login successful")
                return True

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                backoff = 2 ** attempt
                logger.warning(
                    "LinkedIn login attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1, MAX_RETRIES, exc, backoff,
                )
                await asyncio.sleep(backoff)

        logger.error("LinkedIn login failed after %d attempts", MAX_RETRIES)
        return False

    # ------------------------------------------------------------------
    # Internal — scraping & apply
    # ------------------------------------------------------------------

    async def _scrape_listings(self, page: Page) -> list[JobListing]:
        listings: list[JobListing] = []

        try:
            await page.wait_for_selector(
                "ul.jobs-search__results-list, .scaffold-layout__list-container",
                timeout=self._timeout,
            )
        except Exception:
            logger.warning("LinkedIn: job results list not found")
            return listings

        cards = await page.query_selector_all(
            ".job-card-container, .jobs-search-results__list-item"
        )
        logger.debug("LinkedIn: found %d job cards", len(cards))

        for card in cards[: self._max_apps]:
            try:
                await card.click()
                await _medium_delay()
                await self._check_captcha(page)

                listing = await self._extract_job_detail(page)
                if listing:
                    listings.append(listing)
            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.warning("LinkedIn: failed to extract card: %s", exc)

        return listings

    async def _extract_job_detail(self, page: Page) -> JobListing | None:
        try:
            title = (
                await page.locator(".jobs-unified-top-card__job-title, h1").first.inner_text()
            ).strip()
            company = (
                await page.locator(
                    ".jobs-unified-top-card__company-name, "
                    ".jobs-unified-top-card__primary-description a"
                ).first.inner_text()
            ).strip()
            location = (
                await page.locator(
                    ".jobs-unified-top-card__bullet, "
                    ".jobs-unified-top-card__workplace-type"
                ).first.inner_text()
            ).strip()
            description = (
                await page.locator("#job-details, .jobs-description-content").first.inner_text()
            ).strip()

            easy_apply = (
                await page.locator(
                    "button.jobs-apply-button[aria-label*='Easy Apply']"
                ).count() > 0
            )

            salary: str | None = None
            salary_el = page.locator(".jobs-unified-top-card__job-insight--highlight").first
            if await salary_el.count() > 0:
                salary = (await salary_el.inner_text()).strip() or None

            return JobListing(
                url=page.url,
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
        try:
            apply_btn = page.get_by_role("button", name="Easy Apply")
            if await apply_btn.count() == 0:
                return False

            await apply_btn.click()
            await _medium_delay()
            await self._check_captcha(page)

            # Upload CV
            cv_input = page.locator("input[type='file']")
            if await cv_input.count() > 0 and Path(cv_path).exists():
                await cv_input.set_input_files(cv_path)
                await _medium_delay()

            # Fill phone if present
            phone = profile_data.get("phone", "")
            if phone:
                phone_input = page.get_by_label("Phone number")
                if await phone_input.count() > 0:
                    await _human_type(page, phone_input, phone)
                    await _short_delay()

            # Walk through form steps
            for _ in range(10):
                submit_btn = page.get_by_role("button", name="Submit application")
                review_btn = page.get_by_role("button", name="Review")
                next_btn = page.get_by_role("button", name="Next")

                if await submit_btn.count() > 0:
                    await submit_btn.click()
                    await _medium_delay()
                    logger.info("LinkedIn Easy Apply submitted for %s", page.url)
                    return True

                if await review_btn.count() > 0:
                    await review_btn.click()
                    await _medium_delay()
                    continue

                if await next_btn.count() > 0:
                    await next_btn.click()
                    await _medium_delay()
                    await self._check_captcha(page)
                    continue

                break  # No navigation button — bail

        except CaptchaDetectedError:
            raise
        except Exception as exc:
            logger.error("LinkedIn Easy Apply error: %s", exc)
            await self._screenshot_on_error(page, "linkedin_easy_apply_error")

        return False

    async def _check_captcha(self, page: Page) -> None:
        selectors = [
            "iframe[src*='recaptcha']",
            "iframe[src*='hcaptcha']",
            "iframe[src*='arkoselabs']",
            "[class*='captcha']",
            "#captcha-challenge",
        ]
        for sel in selectors:
            if await page.locator(sel).count() > 0:
                raise CaptchaDetectedError(f"CAPTCHA detected on {page.url}")

    @staticmethod
    async def _screenshot_on_error(page: Page, name: str) -> None:
        try:
            shots_dir = Path("data/screenshots")
            shots_dir.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(shots_dir / f"{name}.png"))
        except Exception:
            pass
