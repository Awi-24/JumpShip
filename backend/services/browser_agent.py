"""
Browser automation agent using Playwright for job application automation.
Handles Easy Apply flows and basic form filling on external job sites.
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional
from datetime import datetime


class ApplicationAgent:
    """Automates job application submission via browser."""

    def __init__(self, headless: bool = True):
        self.headless = headless

    async def apply_easy(
        self,
        job_url: str,
        user_profile: dict,
        resume_path: Optional[str] = None,
    ) -> dict:
        """
        Attempt Easy Apply on a given job URL.
        user_profile should contain: name, email, phone, linkedin_url, cover_letter (optional)
        Returns dict with status and log.
        """
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            return {
                "success": False,
                "status": "error",
                "log": "Playwright is not installed. Run: pip install playwright && playwright install chromium",
                "timestamp": datetime.utcnow().isoformat(),
            }

        log_entries: list[str] = []

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                )
            )
            page = await context.new_page()

            try:
                log_entries.append(f"Navigating to {job_url}")
                await page.goto(job_url, timeout=30000, wait_until="domcontentloaded")
                await asyncio.sleep(2)

                # Generic "Apply" button detection
                apply_selectors = [
                    "button:has-text('Easy Apply')",
                    "button:has-text('Apply Now')",
                    "button:has-text('Apply')",
                    "a:has-text('Apply Now')",
                    "[data-automation='apply-button']",
                    ".jobs-apply-button",
                ]

                apply_btn = None
                for sel in apply_selectors:
                    try:
                        apply_btn = await page.wait_for_selector(sel, timeout=3000)
                        if apply_btn:
                            log_entries.append(f"Found apply button: {sel}")
                            break
                    except Exception:
                        continue

                if not apply_btn:
                    return {
                        "success": False,
                        "status": "manual_required",
                        "log": "\n".join(log_entries) + "\nCould not find apply button. Manual application required.",
                        "timestamp": datetime.utcnow().isoformat(),
                    }

                await apply_btn.click()
                await asyncio.sleep(2)
                log_entries.append("Clicked apply button")

                # Try to fill common form fields
                await _fill_field(page, 'input[name="name"], input[placeholder*="name" i]', user_profile.get("name", ""), log_entries)
                await _fill_field(page, 'input[type="email"], input[name="email"]', user_profile.get("email", ""), log_entries)
                await _fill_field(page, 'input[type="tel"], input[name="phone"]', user_profile.get("phone", ""), log_entries)

                if resume_path and os.path.exists(resume_path):
                    try:
                        file_input = await page.query_selector('input[type="file"]')
                        if file_input:
                            await file_input.set_input_files(resume_path)
                            log_entries.append(f"Uploaded resume: {resume_path}")
                    except Exception as e:
                        log_entries.append(f"Could not upload resume: {e}")

                # Take a screenshot for review before submitting
                screenshot_path = f"/tmp/apply_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.png"
                await page.screenshot(path=screenshot_path)
                log_entries.append(f"Screenshot saved: {screenshot_path}")

                # NOTE: We do NOT automatically click submit — user must approve
                return {
                    "success": True,
                    "status": "form_filled",
                    "log": "\n".join(log_entries),
                    "screenshot": screenshot_path,
                    "timestamp": datetime.utcnow().isoformat(),
                    "note": "Form has been filled. Review the screenshot and confirm submission.",
                }

            except Exception as e:
                log_entries.append(f"Error: {e}")
                return {
                    "success": False,
                    "status": "error",
                    "log": "\n".join(log_entries),
                    "timestamp": datetime.utcnow().isoformat(),
                }
            finally:
                await browser.close()


async def _fill_field(page, selector: str, value: str, log: list[str]):
    """Try to fill a form field, ignoring errors if not found."""
    if not value:
        return
    try:
        el = await page.query_selector(selector)
        if el:
            await el.fill(value)
            log.append(f"Filled field ({selector}) with value")
    except Exception as e:
        log.append(f"Could not fill {selector}: {e}")


def run_apply(job_url: str, user_profile: dict, resume_path: Optional[str] = None) -> dict:
    """Synchronous wrapper for use from FastAPI routes."""
    agent = ApplicationAgent(headless=True)
    return asyncio.run(agent.apply_easy(job_url, user_profile, resume_path))
