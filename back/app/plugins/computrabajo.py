"""Computrabajo job-board plugin.

Computrabajo is the leading job board in Latin America (Colombia, Mexico,
Argentina, Peru, Chile, etc.). It does not require login for searching and
has relatively relaxed anti-bot measures.

Apply strategy: most listings redirect to the company's own ATS. We detect
the "Aplicar" button and click it; if it stays on-site we attempt to fill
the form, otherwise we return False so the agent logs it as a manual task.

Configuration:
    COMPUTRABAJO_COUNTRY  — country domain suffix, e.g. "com.co" (default),
                            "com.mx", "com.ar", "com.pe", "cl"
"""

import asyncio
import logging
import random
from pathlib import Path
from urllib.parse import quote_plus

from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from app.plugins.base_board import BaseJobBoard, CaptchaDetectedError, JobListing
from app.services import config_store

logger = logging.getLogger(__name__)

_BASE_DOMAIN = "computrabajo.com.co"  # default: Colombia

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
_ARGS = ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _pause(low: float = 0.8, high: float = 2.5) -> None:
    await asyncio.sleep(random.uniform(low, high))


# ---------------------------------------------------------------------------
# Plugin
# ---------------------------------------------------------------------------


class ComputrabajoBoard(BaseJobBoard):
    """Playwright-based Computrabajo automation plugin."""

    def __init__(self) -> None:
        country = str(config_store.get("computrabajo_country") or _BASE_DOMAIN)
        # Accept either "com.co" or "computrabajo.com.co"
        self._base = f"https://www.{country}" if not country.startswith("http") else country
        if "computrabajo" not in self._base:
            self._base = f"https://www.computrabajo.{country}"

        self._headless: bool = bool(
            config_store.get("playwright_headless")
            if config_store.get("playwright_headless") is not None else True
        )
        self._slow_mo: float = float(config_store.get("playwright_slow_mo") or 0)
        self._timeout: float = float(config_store.get("playwright_timeout") or 30_000)
        self._max_apps: int = int(config_store.get("max_applications_per_run") or 5)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def is_available(self) -> bool:
        return True  # No auth needed for search

    async def search(
        self,
        keywords: list[str],
        locations: list[str],
        remote_only: bool,
    ) -> list[JobListing]:
        listings: list[JobListing] = []

        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context, page = await self._new_page(browser)

            try:
                url = self._build_search_url(keywords, locations, remote_only)
                await page.goto(url, wait_until="domcontentloaded")
                await _pause()
                await self._check_captcha(page)

                listings = await self._scrape_listings(page)

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("Computrabajo search failed: %s", exc)
                await self._screenshot(page, "computrabajo_search_error")
            finally:
                await context.close()
                await browser.close()

        return listings[: self._max_apps]

    async def apply(self, job: JobListing, cv_path: str, profile_data: dict) -> bool:
        """Click Aplicar and attempt on-site form. Returns False for external redirects."""
        async with async_playwright() as pw:
            browser = await self._launch(pw)
            context, page = await self._new_page(browser)

            try:
                await page.goto(job.url, wait_until="domcontentloaded")
                await _pause()
                await self._check_captcha(page)

                apply_btn = page.locator("a.btn_apply, a[data-testid='btn-apply'], a.js-o-link-bold").first
                if await apply_btn.count() == 0:
                    logger.info("Computrabajo: no apply button on %s", job.url)
                    return False

                original_url = page.url
                await apply_btn.click()
                await _pause(1.5, 3.0)

                # If page stayed on Computrabajo, it's an on-site form
                if "computrabajo" in page.url:
                    return await self._fill_onsite_form(page, cv_path, profile_data)

                # Redirected to external ATS — can't automate
                logger.info(
                    "Computrabajo: %s redirects to external ATS (%s) — marking as manual",
                    original_url, page.url,
                )
                return False

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.error("Computrabajo apply failed for %s: %s", job.url, exc)
                await self._screenshot(page, "computrabajo_apply_error")
                return False
            finally:
                await context.close()
                await browser.close()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _build_search_url(self, keywords: list[str], locations: list[str], remote_only: bool) -> str:
        q = quote_plus(" ".join(keywords))
        url = f"{self._base}/empleos?q={q}"
        if locations:
            url += f"&l={quote_plus(locations[0])}"
        if remote_only:
            url += "&teletrabajo=1"
        return url

    async def _launch(self, pw) -> Browser:
        return await pw.chromium.launch(
            headless=self._headless,
            slow_mo=self._slow_mo,
            args=_ARGS,
        )

    async def _new_page(self, browser: Browser) -> tuple[BrowserContext, Page]:
        ctx = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent=_UA,
            locale="es-CO",
        )
        page = await ctx.new_page()
        page.set_default_timeout(self._timeout)
        return ctx, page

    async def _scrape_listings(self, page: Page) -> list[JobListing]:
        listings: list[JobListing] = []

        try:
            await page.wait_for_selector(
                "article.box_offer, .js-o-link, [data-testid='offerCard']",
                timeout=self._timeout,
            )
        except Exception:
            logger.warning("Computrabajo: job results not found on page")
            return listings

        cards = await page.query_selector_all("article.box_offer, [data-testid='offerCard']")
        logger.debug("Computrabajo: found %d job cards", len(cards))

        for card in cards[: self._max_apps]:
            try:
                # Get job URL from card before clicking
                link = await card.query_selector("a.js-o-link, h2 a, a[href*='/oferta-de-trabajo']")
                if not link:
                    continue

                job_href = await link.get_attribute("href")
                if not job_href:
                    continue

                job_url = job_href if job_href.startswith("http") else f"{self._base}{job_href}"

                # Open job in same page
                await page.goto(job_url, wait_until="domcontentloaded")
                await _pause(0.5, 1.5)
                await self._check_captcha(page)

                listing = await self._extract_detail(page)
                if listing:
                    listings.append(listing)

                await page.go_back(wait_until="domcontentloaded")
                await _pause(0.5, 1.0)

            except CaptchaDetectedError:
                raise
            except Exception as exc:
                logger.warning("Computrabajo: failed to extract card: %s", exc)

        return listings

    async def _extract_detail(self, page: Page) -> JobListing | None:
        try:
            title = (
                await page.locator("h1.title_offer, h1[class*='title'], h1").first.inner_text()
            ).strip()

            company = (
                await page.locator(
                    "p.fs16.fc_base, [data-testid='company-name'], .company_name"
                ).first.inner_text()
            ).strip()

            location = (
                await page.locator(
                    "li[data-testid='location'], p[data-testid='job-location'], .location"
                ).first.inner_text()
            ).strip()

            description = (
                await page.locator(
                    "#description_offer, [data-testid='job-description'], .description"
                ).first.inner_text()
            ).strip()

            salary: str | None = None
            salary_el = page.locator("[data-testid='salary'], .salary, li.salary").first
            if await salary_el.count() > 0:
                raw = (await salary_el.inner_text()).strip()
                if raw and raw.lower() not in ("salario", "salary"):
                    salary = raw

            return JobListing(
                url=page.url,
                title=title,
                company=company,
                location=location,
                description=description,
                salary=salary,
                easy_apply=False,  # determined at apply() time
                source="computrabajo",
            )
        except Exception as exc:
            logger.warning("Computrabajo: could not extract job detail: %s", exc)
            return None

    async def _fill_onsite_form(self, page: Page, cv_path: str, profile_data: dict) -> bool:
        """Fill Computrabajo's on-site quick-apply form if present."""
        try:
            cv_input = page.locator("input[type='file']")
            if await cv_input.count() > 0 and Path(cv_path).exists():
                await cv_input.set_input_files(cv_path)
                await _pause()

            submit = page.get_by_role("button", name="Enviar").first
            if await submit.count() == 0:
                submit = page.locator("button[type='submit']").first

            if await submit.count() > 0:
                await submit.click()
                await _pause()
                logger.info("Computrabajo: application submitted for %s", page.url)
                return True

        except Exception as exc:
            logger.error("Computrabajo on-site form error: %s", exc)
            await self._screenshot(page, "computrabajo_form_error")

        return False

    async def _check_captcha(self, page: Page) -> None:
        selectors = ["iframe[src*='recaptcha']", "iframe[src*='hcaptcha']", "#captcha"]
        for sel in selectors:
            if await page.locator(sel).count() > 0:
                raise CaptchaDetectedError(f"CAPTCHA detected on {page.url}")

    @staticmethod
    async def _screenshot(page: Page, name: str) -> None:
        try:
            shots_dir = Path("data/screenshots")
            shots_dir.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(shots_dir / f"{name}.png"))
        except Exception:
            pass
