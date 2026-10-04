"""Conservative, date-specific car-access windows for recommended drives.

These are example departures, not claims that OSM restrictions stay unchanged.
Unrecognised conditional restrictions are closed in every sample window.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

# Monday/Sunday, morning/evening, in summer and autumn. Local Dutch time.
WINDOWS = (
    ("2027-07-12 08:00", datetime(2027, 7, 12, 8)),
    ("2027-07-12 20:00", datetime(2027, 7, 12, 20)),
    ("2027-07-18 08:00", datetime(2027, 7, 18, 8)),
    ("2027-07-18 20:00", datetime(2027, 7, 18, 20)),
    ("2026-09-28 08:00", datetime(2026, 9, 28, 8)),
    ("2026-09-28 20:00", datetime(2026, 9, 28, 20)),
    ("2026-10-04 08:00", datetime(2026, 10, 4, 8)),
    ("2026-10-04 20:00", datetime(2026, 10, 4, 20)),
)
ALL = (1 << len(WINDOWS)) - 1
DAYS = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
BAD = {"no", "private", "destination", "delivery", "agricultural", "forestry", "customers"}


def _active(expression: str, when: datetime) -> bool:
    """Whether a restrictive OSM condition applies; unknown means closed."""
    text = expression.strip()
    if "sunset-sunrise" in text:
        return when.hour >= (21 if when.month == 7 else 19) or when.hour < 8
    if "sundown" in text or "sunrise" in text or "sunset" in text:
        return True  # ambiguous solar expression, never assume open
    if "PH" in text and re.sub(r"\bPH\b(?:\s+off)?", "", text).strip(" ,;") == "":
        return False  # sampled dates are not public holidays
    # OSM seasonal night closures, e.g. Nov 1-Mar 16 17:00-09:00;
    # Mar 16-Oct 31 21:00-09:00 (Holterbergweg).
    periods = re.findall(
        r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})\s*-\s*("
        + "|".join(MONTHS) + r")\s+(\d{1,2})\s+"
        r"(\d{1,2}:\d\d-\d{1,2}:\d\d)", text
    )
    if periods:
        current = (when.month, when.day)
        for start_month, start_day, end_month, end_day, times in periods:
            start = (MONTHS.index(start_month) + 1, int(start_day))
            end = (MONTHS.index(end_month) + 1, int(end_day))
            if (start <= current <= end) if start <= end else (current >= start or current <= end):
                return _in_time_range(times, when)
        return False
    day_tokens = re.findall(r"\b(?:Mo|Tu|We|Th|Fr|Sa|Su)\b", text)
    month_tokens = re.findall(r"\b(?:" + "|".join(MONTHS) + r")\b", text)
    days = set(day_tokens)
    for first, last in re.findall(r"\b(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)\b", text):
        days.update(DAYS[DAYS.index(first):DAYS.index(last) + 1])
    day_match = DAYS[when.weekday()] in days
    month_match = MONTHS[when.month - 1] in month_tokens
    if (days or month_tokens or "PH" in text) and not (day_match or month_match):
        return False
    ranges = re.findall(r"(\d{1,2}:\d\d)-(\d{1,2}:\d\d)", text)
    if ranges:
        if not any(_in_time_range(f"{a}-{b}", when) for a, b in ranges):
            return False
    # Unknown non-time qualifiers may narrow an OSM restriction, never widen
    # our permission to recommend the road.
    return True


def _in_time_range(interval: str, when: datetime) -> bool:
    first, last = interval.split("-")
    start = int(first.split(":")[0]) * 60 + int(first[-2:])
    end = int(last.split(":")[0]) * 60 + int(last[-2:])
    minute = when.hour * 60 + when.minute
    return start <= minute < end if start <= end else minute >= start or minute < end


def allowed_windows(tags) -> int:
    """Bitmask of example departures in which this car road is open."""
    conditional = [tags.get(key, "") for key in
                   ("motorcar:conditional", "motor_vehicle:conditional",
                    "vehicle:conditional", "access:conditional")]
    mask = ALL
    for value in conditional:
        if not value:
            continue
        clauses = re.findall(r"(\w+)\s*@\s*\(([^)]*)\)", value)
        if not clauses:
            return 0  # cannot safely interpret a restriction
        for status, expression in clauses:
            if status in BAD:
                for bit, (_, when) in enumerate(WINDOWS):
                    if any(_active(expression, when + timedelta(hours=hour))
                           for hour in range(4)):
                        mask &= ~(1 << bit)
            elif status != "yes":
                return 0
    return mask
