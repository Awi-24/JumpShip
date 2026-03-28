"""
JumpShip — Salary normalization utility.
Parses various salary string formats and normalizes them for comparison.
"""
from __future__ import annotations

import re
import logging

logger = logging.getLogger(__name__)

# Approximate monthly-to-annual multipliers
_PERIOD_MULTIPLIER = {
    "year": 1,
    "yr": 1,
    "annual": 1,
    "month": 12,
    "mo": 12,
    "monthly": 12,
    "week": 52,
    "wk": 52,
    "hour": 2080,  # 40h/week * 52 weeks
    "hr": 2080,
}

# Approximate exchange rates to USD (rough, for comparison only)
_TO_USD = {
    "USD": 1.0,
    "BRL": 0.18,
    "EUR": 1.08,
    "GBP": 1.26,
    "CAD": 0.74,
    "AUD": 0.65,
    "INR": 0.012,
    "JPY": 0.0067,
    "SGD": 0.74,
    "CHF": 1.12,
}


def parse_salary(salary_str: str) -> dict | None:
    """
    Parse a salary string and return normalized data.
    Returns: { min_usd_annual, max_usd_annual, display, currency, period }
    or None if unparseable.
    """
    if not salary_str or salary_str.strip() == "":
        return None

    s = salary_str.strip()

    # Detect currency
    currency = "USD"
    for cur in _TO_USD:
        if cur in s.upper() or (cur == "BRL" and "R$" in s):
            currency = cur
            break

    # Detect period
    period = "year"
    s_lower = s.lower()
    for p, _ in _PERIOD_MULTIPLIER.items():
        if p in s_lower:
            period = p
            break
    # Heuristic: if numbers are small (< 500), probably hourly
    # if < 20000, probably monthly

    # Extract numbers
    numbers = re.findall(r'[\d,]+(?:\.\d+)?', s.replace(',', ''))
    nums = []
    for n in numbers:
        try:
            val = float(n.replace(',', ''))
            if val > 0:
                nums.append(val)
        except ValueError:
            continue

    if not nums:
        return None

    # Heuristic period detection if not explicit
    max_num = max(nums)
    if period == "year" and "month" not in s_lower and "yr" not in s_lower and "year" not in s_lower:
        if max_num < 500:
            period = "hour"
        elif max_num < 25000:
            period = "month"

    multiplier = _PERIOD_MULTIPLIER.get(period, 1)
    rate = _TO_USD.get(currency, 1.0)

    if len(nums) >= 2:
        min_val = min(nums[0], nums[1]) * multiplier * rate
        max_val = max(nums[0], nums[1]) * multiplier * rate
    else:
        min_val = nums[0] * multiplier * rate
        max_val = min_val

    return {
        "min_usd_annual": round(min_val),
        "max_usd_annual": round(max_val),
        "currency": currency,
        "period": period,
        "display": f"~USD {round(min_val):,} – {round(max_val):,}/yr" if min_val != max_val else f"~USD {round(min_val):,}/yr",
    }
