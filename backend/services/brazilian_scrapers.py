"""
Brazilian job platform scrapers: Gupy, Catho, Vagas.com.br

This module provides web scrapers for major Brazilian job platforms.
Each scraper returns job listings in a standardized format compatible
with the main JobSpy scraper format.
"""

import httpx
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from urllib.parse import quote_plus
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Standard headers to avoid being blocked
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Referer": "https://www.google.com/",
}

TIMEOUT = httpx.Timeout(10.0)


def parse_relative_date(date_str: str) -> str:
    """
    Convert relative date strings (e.g., '2 days ago') to ISO format.
    Falls back to today's date if parsing fails.
    """
    if not date_str:
        return datetime.now().isoformat()

    date_str_lower = date_str.lower().strip()

    try:
        # Handle 'X days ago', 'X hours ago', etc.
        if "hora" in date_str_lower or "hour" in date_str_lower:
            return datetime.now().isoformat()
        elif "dia" in date_str_lower or "day" in date_str_lower:
            parts = date_str_lower.split()
            days = int(parts[0]) if parts[0].isdigit() else 1
            date = datetime.now() - timedelta(days=days)
            return date.isoformat()
        elif "semana" in date_str_lower or "week" in date_str_lower:
            parts = date_str_lower.split()
            weeks = int(parts[0]) if parts[0].isdigit() else 1
            date = datetime.now() - timedelta(weeks=weeks)
            return date.isoformat()
        elif "mês" in date_str_lower or "month" in date_str_lower:
            parts = date_str_lower.split()
            months = int(parts[0]) if parts[0].isdigit() else 1
            date = datetime.now() - timedelta(days=months * 30)
            return date.isoformat()

        # Try parsing as ISO date directly
        if "T" in date_str or "-" in date_str:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00")).isoformat()

        return datetime.now().isoformat()
    except Exception as e:
        logger.warning(f"Could not parse date '{date_str}': {e}")
        return datetime.now().isoformat()


def scrape_gupy(
    search_term: str,
    location: str = "",
    results_wanted: int = 20,
    is_remote: bool = False,
) -> List[Dict]:
    """
    Scrape jobs from Gupy using their public API.

    Gupy provides a JSON API that doesn't require browser rendering.
    """
    jobs = []

    try:
        # Build API URL
        url = "https://portal.api.gupy.io/api/v1/jobs"
        params = {
            "name": search_term,
            "limit": min(results_wanted, 100),  # API limit
            "offset": 0,
        }

        # Add location filter if provided
        if location:
            params["city"] = location

        # Add remote filter if requested
        if is_remote:
            params["workplaceTypes[]"] = "remote"

        # Make API request
        with httpx.Client(headers=HEADERS, timeout=TIMEOUT) as client:
            response = client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        # Parse response
        job_list = data.get("data", [])
        logger.info(f"Gupy: Found {len(job_list)} jobs for '{search_term}'")

        for job in job_list[:results_wanted]:
            try:
                # Extract salary range if available
                salary_min = None
                salary_max = None
                if job.get("salaryRange"):
                    salary_range = job.get("salaryRange", {})
                    salary_min = salary_range.get("start")
                    salary_max = salary_range.get("end")

                # Determine job type
                job_type = ""
                gupy_type = job.get("type", "").lower()
                if "full" in gupy_type or "integral" in gupy_type:
                    job_type = "fulltime"
                elif "part" in gupy_type:
                    job_type = "parttime"
                elif "contrat" in gupy_type:
                    job_type = "contract"

                job_dict = {
                    "title": job.get("name", ""),
                    "company_name": job.get("careerPageName", ""),
                    "location": job.get("city", location or ""),
                    "job_url": job.get("url") or job.get("jobUrl", ""),
                    "description": job.get("description", ""),
                    "date_posted": parse_relative_date(job.get("publishedDate", "")),
                    "site": "gupy",
                    "job_type": job_type,
                    "is_remote": job.get("isRemoteWork", is_remote),
                    "salary_min": salary_min,
                    "salary_max": salary_max,
                    "salary_currency": "BRL",
                }

                # Only add if we have essential fields
                if job_dict.get("title") and job_dict.get("job_url"):
                    jobs.append(job_dict)
            except Exception as e:
                logger.warning(f"Gupy: Error parsing job: {e}")
                continue

    except httpx.HTTPError as e:
        logger.error(f"Gupy API request failed: {e}")
    except Exception as e:
        logger.error(f"Gupy scraper error: {e}")

    return jobs


def scrape_catho(
    search_term: str,
    location: str = "",
    results_wanted: int = 20,
    is_remote: bool = False,
) -> List[Dict]:
    """
    Scrape jobs from Catho.com.br using HTML parsing.

    Catho is server-side rendered, so we parse HTML directly.
    """
    jobs = []

    try:
        # Build search URL
        search_term_url = quote_plus(search_term.replace(" ", "-"))
        url = f"https://www.catho.com.br/vagas/{search_term_url}/"

        params = {}
        if location:
            params["localidade"] = location
        if is_remote:
            params["remoto"] = "sim"
        params["q"] = search_term

        # Fetch page
        with httpx.Client(headers=HEADERS, timeout=TIMEOUT) as client:
            response = client.get(url, params=params)
            response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")

        # Find job containers - typically in article or div elements
        job_containers = soup.find_all("article") or soup.find_all("div", class_="vaga")

        if not job_containers:
            # Try alternative selectors
            job_containers = soup.find_all("li", class_="resultado")
            if not job_containers:
                job_containers = soup.find_all("div", {"data-testid": "job-card"})

        logger.info(f"Catho: Found {len(job_containers)} job containers")

        for job_elem in job_containers[:results_wanted]:
            try:
                # Extract title
                title_elem = job_elem.find("h2") or job_elem.find("a", class_="job-link")
                title = title_elem.get_text(strip=True) if title_elem else ""

                # Extract company name
                company_elem = job_elem.find("span", class_="empresa") or job_elem.find("p", class_="company")
                company = company_elem.get_text(strip=True) if company_elem else ""

                # Extract location
                location_elem = job_elem.find("span", class_="local") or job_elem.find("span", class_="location")
                loc = location_elem.get_text(strip=True) if location_elem else location

                # Extract job URL
                link_elem = job_elem.find("a", href=True)
                job_url = link_elem["href"] if link_elem else ""
                if job_url and not job_url.startswith("http"):
                    job_url = f"https://www.catho.com.br{job_url}"

                # Extract date
                date_elem = job_elem.find("span", class_="data") or job_elem.find("span", class_="date")
                date_posted = parse_relative_date(
                    date_elem.get_text(strip=True) if date_elem else ""
                )

                if title and job_url:
                    job_dict = {
                        "title": title,
                        "company_name": company,
                        "location": loc,
                        "job_url": job_url,
                        "description": "",
                        "date_posted": date_posted,
                        "site": "catho",
                        "job_type": "",
                        "is_remote": is_remote,
                        "salary_min": None,
                        "salary_max": None,
                        "salary_currency": "BRL",
                    }
                    jobs.append(job_dict)
            except Exception as e:
                logger.warning(f"Catho: Error parsing job element: {e}")
                continue

    except httpx.HTTPError as e:
        logger.error(f"Catho request failed: {e}")
    except Exception as e:
        logger.error(f"Catho scraper error: {e}")

    return jobs


def scrape_vagas_com_br(
    search_term: str,
    location: str = "",
    results_wanted: int = 20,
    is_remote: bool = False,
) -> List[Dict]:
    """
    Scrape jobs from Vagas.com.br using HTML parsing.

    Vagas.com.br is server-side rendered, so we parse HTML directly.
    """
    jobs = []

    try:
        # Build search URL
        search_term_url = quote_plus(search_term.replace(" ", "-"))
        url = f"https://www.vagas.com.br/vagas-de-{search_term_url}"

        params = {}
        if location:
            params["localidade"] = location
        if is_remote:
            params["work_type"] = "H"  # H for home (remote)

        # Fetch page
        with httpx.Client(headers=HEADERS, timeout=TIMEOUT) as client:
            response = client.get(url, params=params)
            response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")

        # Find job containers - typically in li elements with class "vaga"
        job_containers = soup.find_all("li", class_="vaga")

        if not job_containers:
            # Try alternative selectors
            job_containers = soup.find_all("div", class_="jobCard")
            if not job_containers:
                job_containers = soup.find_all("article", class_="vaga")

        logger.info(f"Vagas.com.br: Found {len(job_containers)} job containers")

        for job_elem in job_containers[:results_wanted]:
            try:
                # Extract title (usually in .cargo or h2)
                title_elem = job_elem.find("h2") or job_elem.find("a", class_="cargo")
                title = title_elem.get_text(strip=True) if title_elem else ""

                # Extract company name (usually in .emprVaga or .company)
                company_elem = job_elem.find("span", class_="emprVaga") or job_elem.find("p", class_="company")
                company = company_elem.get_text(strip=True) if company_elem else ""

                # Extract location
                location_elem = job_elem.find("span", class_="local") or job_elem.find("span", class_="location")
                loc = location_elem.get_text(strip=True) if location_elem else location

                # Extract job URL
                link_elem = job_elem.find("a", href=True)
                job_url = link_elem["href"] if link_elem else ""
                if job_url and not job_url.startswith("http"):
                    job_url = f"https://www.vagas.com.br{job_url}"

                # Extract date (usually in .data or .date)
                date_elem = job_elem.find("span", class_="data") or job_elem.find("span", class_="date")
                date_posted = parse_relative_date(
                    date_elem.get_text(strip=True) if date_elem else ""
                )

                # Try to detect job type from description or class
                job_type = ""
                job_type_elem = job_elem.find("span", class_="job-type")
                if job_type_elem:
                    job_type_text = job_type_elem.get_text(strip=True).lower()
                    if "integral" in job_type_text or "full" in job_type_text:
                        job_type = "fulltime"
                    elif "part" in job_type_text:
                        job_type = "parttime"
                    elif "contrat" in job_type_text:
                        job_type = "contract"

                if title and job_url:
                    job_dict = {
                        "title": title,
                        "company_name": company,
                        "location": loc,
                        "job_url": job_url,
                        "description": "",
                        "date_posted": date_posted,
                        "site": "vagas.com.br",
                        "job_type": job_type,
                        "is_remote": is_remote,
                        "salary_min": None,
                        "salary_max": None,
                        "salary_currency": "BRL",
                    }
                    jobs.append(job_dict)
            except Exception as e:
                logger.warning(f"Vagas.com.br: Error parsing job element: {e}")
                continue

    except httpx.HTTPError as e:
        logger.error(f"Vagas.com.br request failed: {e}")
    except Exception as e:
        logger.error(f"Vagas.com.br scraper error: {e}")

    return jobs


def search_brazilian_jobs(
    search_term: str,
    location: str = "",
    results_wanted: int = 20,
    is_remote: bool = False,
    sites: Optional[List[str]] = None,
) -> List[Dict]:
    """
    Search multiple Brazilian job platforms and merge results.

    Args:
        search_term: Job title or keyword to search
        location: Optional city/region filter
        results_wanted: Number of results per site
        is_remote: Filter for remote jobs only
        sites: List of sites to search. If None, searches all.
               Valid values: "gupy", "catho", "vagas.com.br"

    Returns:
        List of job dictionaries merged from all requested platforms
    """
    if sites is None:
        sites = ["gupy", "catho", "vagas.com.br"]

    all_jobs = []

    # Normalize site names
    sites = [s.lower().strip() for s in sites]

    # Call appropriate scrapers
    if "gupy" in sites:
        try:
            gupy_jobs = scrape_gupy(search_term, location, results_wanted, is_remote)
            all_jobs.extend(gupy_jobs)
            logger.info(f"Added {len(gupy_jobs)} jobs from Gupy")
        except Exception as e:
            logger.error(f"Error scraping Gupy: {e}")

    if "catho" in sites:
        try:
            catho_jobs = scrape_catho(search_term, location, results_wanted, is_remote)
            all_jobs.extend(catho_jobs)
            logger.info(f"Added {len(catho_jobs)} jobs from Catho")
        except Exception as e:
            logger.error(f"Error scraping Catho: {e}")

    if "vagas.com.br" in sites or "vagas" in sites:
        try:
            vagas_jobs = scrape_vagas_com_br(search_term, location, results_wanted, is_remote)
            all_jobs.extend(vagas_jobs)
            logger.info(f"Added {len(vagas_jobs)} jobs from Vagas.com.br")
        except Exception as e:
            logger.error(f"Error scraping Vagas.com.br: {e}")

    logger.info(f"Total jobs found across {len(sites)} site(s): {len(all_jobs)}")
    return all_jobs
