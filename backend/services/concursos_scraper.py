"""
Brazilian public concursos (civil service exams) scraper.

Scrapes concurso listings from PCI Concursos and Gov.br platforms.
Returns results in a standardized format for the JobSpy UI.
"""

from __future__ import annotations

import httpx
import logging
import re
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin, quote
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Standard headers to avoid being blocked
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Referer": "https://www.google.com/",
}

TIMEOUT = httpx.Timeout(15.0)

# Map of common state codes to normalize
STATE_MAP = {
    "sao paulo": "SP",
    "são paulo": "SP",
    "rio de janeiro": "RJ",
    "minas gerais": "MG",
    "bahia": "BA",
    "ceara": "CE",
    "ceará": "CE",
    "parana": "PR",
    "paraná": "PR",
    "santa catarina": "SC",
    "rio grande do sul": "RS",
    "distrito federal": "DF",
    "nacional": "Nacional",
}


def search_concursos(
    estado: str = "",
    nivel: str = "",
    area: str = "",
    salario_minimo: float = 0,
    apenas_abertos: bool = True,
    banca: str = "",
    orgao: str = "",
    results_wanted: int = 30,
) -> list[dict]:
    """
    Search for Brazilian public concursos across multiple platforms.

    Args:
        estado: State code (e.g., "SP", "RJ") or empty for all
        nivel: Education level (e.g., "fundamental", "medio", "superior") or empty for all
        area: Job area (e.g., "ti", "saude", "direito") or empty for all
        salario_minimo: Minimum salary filter (applied post-fetch)
        apenas_abertos: Only include open for registration if True
        banca: Exam board (e.g., "cebraspe", "fgv") or empty for all
        orgao: Organization/agency (e.g., "ibge", "inss") or empty for all
        results_wanted: Number of results to return

    Returns:
        List of concurso dicts with standardized fields
    """
    all_results = []

    try:
        logger.info(f"Scraping PCI Concursos with filters: estado={estado}, nivel={nivel}, area={area}")
        pci_results = _scrape_pci_concursos(estado, nivel, area, results_wanted)
        all_results.extend(pci_results)
    except Exception as e:
        logger.warning(f"Error scraping PCI Concursos: {e}")

    try:
        logger.info(f"Scraping Gov.br Concursos")
        govbr_results = _scrape_govbr_concursos(apenas_abertos, results_wanted)
        all_results.extend(govbr_results)
    except Exception as e:
        logger.warning(f"Error scraping Gov.br Concursos: {e}")

    # Apply post-processing filters
    filtered = _apply_filters(
        all_results,
        estado=estado,
        nivel=nivel,
        area=area,
        salario_minimo=salario_minimo,
        apenas_abertos=apenas_abertos,
        banca=banca,
        orgao=orgao,
    )

    # Limit results
    return filtered[:results_wanted]


def _scrape_pci_concursos(
    estado: str = "",
    nivel: str = "",
    area: str = "",
    results_wanted: int = 30,
) -> list[dict]:
    """
    Scrape concursos from PCI Concursos platform.
    """
    results = []

    # Build URL with filters
    base_url = "https://www.pciconcursos.com.br/concursos"

    if estado.strip():
        estado_lower = estado.lower().strip()
        url = f"{base_url}/{estado_lower}/"
    else:
        url = f"{base_url}/"

    try:
        logger.info(f"Fetching PCI Concursos from: {url}")
        response = httpx.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
        response.raise_for_status()
    except Exception as e:
        logger.warning(f"Failed to fetch PCI Concursos: {e}")
        return results

    try:
        soup = BeautifulSoup(response.content, "html.parser")

        # PCI uses various HTML structures; look for main content areas
        # Try to find concurso containers (often in divs or table rows)
        concurso_containers = soup.find_all(class_=re.compile(r"concurso|resultado|vaga"))

        if not concurso_containers:
            # Fallback: look for any clickable containers
            concurso_containers = soup.find_all("div", class_=re.compile(r"item|card|row"))

        for container in concurso_containers[:results_wanted]:
            try:
                concurso = _parse_pci_concurso(container)
                if concurso:
                    results.append(concurso)
            except Exception as e:
                logger.debug(f"Error parsing PCI concurso container: {e}")

        logger.info(f"Found {len(results)} concursos from PCI")
        return results

    except Exception as e:
        logger.warning(f"Error parsing PCI Concursos HTML: {e}")
        return results


def _parse_pci_concurso(element) -> Optional[dict]:
    """
    Extract concurso data from a PCI Concursos HTML element.
    """
    try:
        # Try to extract title
        title_elem = element.find("h2") or element.find("h3") or element.find("a")
        if not title_elem:
            return None

        titulo = title_elem.get_text(strip=True)
        if not titulo:
            return None

        # Get URL
        link_elem = element.find("a", href=True)
        url = link_elem["href"] if link_elem else ""
        url = urljoin("https://www.pciconcursos.com.br", url) if url else ""

        # Extract orgao, estado, banca from text
        text_content = element.get_text(separator=" ", strip=True)

        orgao = _extract_orgao(text_content)
        estado = _extract_estado(text_content)
        banca = _extract_banca(text_content)

        # Extract salary information
        salario_min, salario_max = _extract_salary_range(text_content)

        # Extract dates
        inscricoes_inicio, inscricoes_fim = _extract_dates(text_content)

        # Determine status
        status = _determine_status(inscricoes_fim)

        return {
            "titulo": titulo,
            "orgao": orgao,
            "banca": banca,
            "estado": estado,
            "nivel": _extract_nivel(text_content),
            "area": _extract_area(text_content),
            "vagas": _extract_vagas(text_content),
            "salario_min": salario_min,
            "salario_max": salario_max,
            "inscricoes_inicio": inscricoes_inicio,
            "inscricoes_fim": inscricoes_fim,
            "status": status,
            "url": url,
            "site": "pciconcursos",
            "data_publicacao": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.debug(f"Error parsing PCI concurso: {e}")
        return None


def _scrape_govbr_concursos(apenas_abertos: bool = True, results_wanted: int = 30) -> list[dict]:
    """
    Scrape concursos from Gov.br platform.
    """
    results = []

    # Gov.br has separate pages for open and predicted concursos
    urls = []
    if apenas_abertos:
        urls.append("https://www.gov.br/servidor/pt-br/acesso-a-informacao/concursos/concursos-abertos")
    else:
        urls.extend([
            "https://www.gov.br/servidor/pt-br/acesso-a-informacao/concursos/concursos-abertos",
            "https://www.gov.br/servidor/pt-br/acesso-a-informacao/concursos/concursos-previstos",
        ])

    for url in urls:
        try:
            logger.info(f"Fetching Gov.br Concursos from: {url}")
            response = httpx.get(url, headers=HEADERS, timeout=TIMEOUT, follow_redirects=True)
            response.raise_for_status()
        except Exception as e:
            logger.warning(f"Failed to fetch Gov.br Concursos: {e}")
            continue

        try:
            soup = BeautifulSoup(response.content, "html.parser")

            # Look for table rows or list items with concurso info
            table_rows = soup.find_all("tr")
            list_items = soup.find_all("li", class_=re.compile(r"concurso|item"))

            # Process table rows
            for row in table_rows[:results_wanted - len(results)]:
                try:
                    concurso = _parse_govbr_concurso(row, "table")
                    if concurso:
                        results.append(concurso)
                except Exception as e:
                    logger.debug(f"Error parsing Gov.br table row: {e}")

            # Process list items
            for item in list_items[:results_wanted - len(results)]:
                try:
                    concurso = _parse_govbr_concurso(item, "list")
                    if concurso:
                        results.append(concurso)
                except Exception as e:
                    logger.debug(f"Error parsing Gov.br list item: {e}")

            if len(results) >= results_wanted:
                break

        except Exception as e:
            logger.warning(f"Error parsing Gov.br Concursos HTML: {e}")

    logger.info(f"Found {len(results)} concursos from Gov.br")
    return results


def _parse_govbr_concurso(element, element_type: str) -> Optional[dict]:
    """
    Extract concurso data from a Gov.br HTML element (table row or list item).
    """
    try:
        text_content = element.get_text(separator=" ", strip=True)
        if not text_content or len(text_content) < 10:
            return None

        # Extract title (usually the main text or first link)
        titulo = ""
        link_elem = element.find("a", href=True)
        if link_elem:
            titulo = link_elem.get_text(strip=True)
            url = link_elem["href"]
            url = urljoin("https://www.gov.br", url) if not url.startswith("http") else url
        else:
            titulo = text_content[:100]
            url = ""

        if not titulo or len(titulo) < 5:
            return None

        # Extract orgao, estado, banca from text
        orgao = _extract_orgao(text_content)
        estado = _extract_estado(text_content)
        banca = _extract_banca(text_content)

        # Extract salary information
        salario_min, salario_max = _extract_salary_range(text_content)

        # Extract dates
        inscricoes_inicio, inscricoes_fim = _extract_dates(text_content)

        # Determine status
        status = _determine_status(inscricoes_fim)

        return {
            "titulo": titulo,
            "orgao": orgao,
            "banca": banca,
            "estado": estado,
            "nivel": _extract_nivel(text_content),
            "area": _extract_area(text_content),
            "vagas": _extract_vagas(text_content),
            "salario_min": salario_min,
            "salario_max": salario_max,
            "inscricoes_inicio": inscricoes_inicio,
            "inscricoes_fim": inscricoes_fim,
            "status": status,
            "url": url,
            "site": "govbr",
            "data_publicacao": datetime.now().isoformat(),
        }
    except Exception as e:
        logger.debug(f"Error parsing Gov.br concurso: {e}")
        return None


def _normalize_estado(text: str) -> str:
    """
    Extract and normalize state code from text.
    Returns state code (e.g., "SP", "RJ") or full name if not recognized.
    """
    if not text:
        return ""

    text = text.lower().strip()

    # Direct 2-letter codes
    match = re.search(r'\b([a-z]{2})\b', text)
    if match:
        code = match.group(1).upper()
        if code in ["SP", "RJ", "MG", "BA", "CE", "PR", "SC", "RS", "DF", "AC", "AL", "AP", "AM", "ES", "GO", "MA", "MS", "MT", "PA", "PB", "PE", "PI", "RN", "RO", "RR", "SE", "TO"]:
            return code

    # Map common state names
    for name, code in STATE_MAP.items():
        if name in text:
            return code

    # Check for "Nacional" or "Nacional"
    if "nacional" in text:
        return "Nacional"

    return ""


def _parse_salary(text: str) -> Optional[float]:
    """
    Extract salary value from text like "R$ 5.000,00" or "R$5000" or "5000,00".
    Returns float value or None if not found.
    """
    if not text:
        return None

    # Remove common prefixes
    text = re.sub(r'[Rr]\s*\$\s*', '', text)

    # Extract numeric value (handles both . and , as separators)
    # Brazilian format uses , for decimals and . for thousands
    match = re.search(r'[\d.]+[,.]?\d*', text)
    if not match:
        return None

    value_str = match.group(0)

    # Normalize: if it has both . and ,, the rightmost is decimal
    if ',' in value_str and '.' in value_str:
        if value_str.rindex(',') > value_str.rindex('.'):
            # , is decimal separator
            value_str = value_str.replace('.', '').replace(',', '.')
        else:
            # . is decimal separator
            value_str = value_str.replace(',', '')
    elif ',' in value_str:
        # Only comma, could be decimal or thousands
        # If only 2 digits after comma, likely decimal
        parts = value_str.split(',')
        if len(parts[1]) <= 2:
            value_str = value_str.replace('.', '').replace(',', '.')
        else:
            value_str = value_str.replace('.', '')
    elif '.' in value_str:
        # Only period, remove it (thousands separator)
        value_str = value_str.replace('.', '')

    try:
        return float(value_str)
    except ValueError:
        return None


def _extract_orgao(text: str) -> str:
    """
    Extract organization name from text.
    Common patterns: IBGE, INSS, CAIXA, BB, etc.
    """
    # Look for uppercase acronyms or known agency names
    patterns = [
        r'\b(IBGE|INSS|CAIXA|BB|CEF|BNDES|SERPRO|TSE|TJ|TRF|STF|MPF|AGU|ANVISA|ANEEL|ANAC|BACEN|CVM|DETRAN|EMBRAPA|INCRA|IPC|IRB|CEAGESP)\b',
        r'\b([A-Z]{2,})\s+(do|da|de)\b',
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).upper()

    return ""


def _extract_banca(text: str) -> str:
    """
    Extract exam board/banca name from text.
    Common patterns: CEBRASPE, FGV, FCC, CESPE, etc.
    """
    patterns = [
        r'\b(CEBRASPE|CESPE|FGV|FCC|VUNESP|FUNDATEC|QUADRIX|IADES|IBFC|IDECAN|REIS|AOCP)\b',
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).upper()

    return ""


def _extract_nivel(text: str) -> str:
    """
    Extract education level from text.
    Returns: "Fundamental", "Médio", "Superior", or ""
    """
    text_lower = text.lower()

    if "fundamental" in text_lower:
        return "Fundamental"
    elif "médio" in text_lower or "medio" in text_lower:
        return "Médio"
    elif "superior" in text_lower or "graduação" in text_lower or "graduacao" in text_lower:
        return "Superior"
    elif "pós-graduação" in text_lower or "pós graduação" in text_lower or "especialização" in text_lower:
        return "Pós-Graduação"

    return ""


def _extract_area(text: str) -> str:
    """
    Extract job area/field from text.
    Returns normalized area name or ""
    """
    text_lower = text.lower()

    areas = {
        "ti": ["tecnologia", "informática", "ti", "sistemas", "desenvolvimento"],
        "saude": ["saúde", "saude", "médico", "medico", "enfermagem", "psicólogo"],
        "direito": ["direito", "jurídico", "juridico", "advogado", "procurador"],
        "educacao": ["educação", "educacao", "professor", "docente"],
        "administracao": ["administração", "administracao", "administrativo"],
        "engenharia": ["engenharia", "engenheiro"],
        "contabil": ["contábil", "contabil", "contabilidade", "contador"],
        "policia": ["polícia", "policia", "delegado", "investigador"],
    }

    for normalized, keywords in areas.items():
        for keyword in keywords:
            if keyword in text_lower:
                return normalized.capitalize()

    return ""


def _extract_vagas(text: str) -> Optional[int]:
    """
    Extract number of positions/vagas from text.
    """
    # Look for patterns like "5 vagas", "vagas: 5", "5 positions"
    patterns = [
        r'(\d+)\s+(vagas?|posições?|posições?)',
        r'vagas?:\s*(\d+)',
        r'(\d+)\s+cargo',
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                continue

    return None


def _extract_salary_range(text: str) -> tuple[Optional[float], Optional[float]]:
    """
    Extract salary range from text.
    Returns tuple of (salary_min, salary_max) or (None, None)
    """
    # Look for salary patterns
    salary_min = None
    salary_max = None

    # Pattern for "R$ 5.000,00 a R$ 8.000,00"
    match = re.search(
        r'[Rr]\s*\$\s*([\d.,]+)\s*(?:a|até)\s*[Rr]\s*\$\s*([\d.,]+)',
        text
    )
    if match:
        salary_min = _parse_salary(match.group(1))
        salary_max = _parse_salary(match.group(2))
    else:
        # Look for single salary value
        match = re.search(r'[Rr]\s*\$\s*([\d.,]+)', text)
        if match:
            salary_min = _parse_salary(match.group(1))

    return salary_min, salary_max


def _extract_estado(text: str) -> str:
    """
    Extract state code from text using _normalize_estado.
    """
    return _normalize_estado(text)


def _extract_dates(text: str) -> tuple[str, str]:
    """
    Extract registration start and end dates from text.
    Returns tuple of (start_date, end_date) as strings or ("", "")

    Handles formats like:
    - "01/01/2026 a 01/02/2026"
    - "Inscrições: 01/01/2026 até 01/02/2026"
    """
    inscricoes_inicio = ""
    inscricoes_fim = ""

    # Pattern: dates separated by "a" or "até" or dash
    date_pattern = r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})'
    matches = re.findall(date_pattern, text)

    if matches:
        if len(matches) >= 2:
            # First date is start, second is end
            inscricoes_inicio = f"{matches[0][0]}/{matches[0][1]}/{matches[0][2]}"
            inscricoes_fim = f"{matches[1][0]}/{matches[1][1]}/{matches[1][2]}"
        elif len(matches) == 1:
            inscricoes_fim = f"{matches[0][0]}/{matches[0][1]}/{matches[0][2]}"

    return inscricoes_inicio, inscricoes_fim


def _determine_status(inscricoes_fim: str) -> str:
    """
    Determine concurso status based on registration end date.
    Returns: "Aberto", "Previsto", or "Encerrado"
    """
    if not inscricoes_fim:
        return "Previsto"

    try:
        # Parse date in format "dd/mm/yyyy"
        parts = inscricoes_fim.split('/')
        if len(parts) != 3:
            return "Previsto"

        fim_date = datetime(int(parts[2]), int(parts[1]), int(parts[0]))
        agora = datetime.now()

        if fim_date > agora:
            return "Aberto"
        else:
            return "Encerrado"
    except Exception:
        return "Previsto"


def _apply_filters(
    results: list[dict],
    estado: str = "",
    nivel: str = "",
    area: str = "",
    salario_minimo: float = 0,
    apenas_abertos: bool = True,
    banca: str = "",
    orgao: str = "",
) -> list[dict]:
    """
    Apply post-processing filters to concurso results.
    """
    filtered = results

    # Filter by state
    if estado.strip():
        estado_normalized = _normalize_estado(estado)
        if estado_normalized:
            filtered = [r for r in filtered if _normalize_estado(r.get("estado", "")) == estado_normalized]

    # Filter by education level
    if nivel.strip():
        nivel_lower = nivel.lower()
        filtered = [r for r in filtered if nivel_lower in r.get("nivel", "").lower()]

    # Filter by area
    if area.strip():
        area_lower = area.lower()
        filtered = [r for r in filtered if area_lower in r.get("area", "").lower()]

    # Filter by minimum salary
    if salario_minimo > 0:
        filtered = [
            r for r in filtered
            if r.get("salario_min") and r.get("salario_min") >= salario_minimo
        ]

    # Filter by exam board/banca
    if banca.strip():
        banca_lower = banca.lower()
        filtered = [r for r in filtered if banca_lower in r.get("banca", "").lower()]

    # Filter by organization/agency
    if orgao.strip():
        orgao_lower = orgao.lower()
        filtered = [r for r in filtered if orgao_lower in r.get("orgao", "").lower()]

    # Filter by status (open only)
    if apenas_abertos:
        filtered = [r for r in filtered if r.get("status") == "Aberto"]

    return filtered
