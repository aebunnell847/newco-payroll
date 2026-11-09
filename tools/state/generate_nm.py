"""Regenerate New Mexico's percentage-method tables in src/regulatory/state/nm.js.

Reads FYI-104 "New Mexico Withholding Tax" and prints its "State Wage
Withholding Tax Tables for Percentage Method of Withholding" (Tables 1-8;
single, married and head of household side by side) as JSON:
{period: {single|married|headOfHousehold: [[overCents, baseCents, rateBp], ...]}}.
Never hand-typed.

    pip install pypdf==5.1.0
    curl -O https://realfile.tax.newmexico.gov/FYI-104.pdf
    python generate_nm.py FYI-104.pdf > nm.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(
    re.sub(r"[ \t]+", " ", p.extract_text(extraction_mode="layout")) for p in PdfReader(sys.argv[1]).pages
)
eff = re.search(r"For wages paid on or after (January \d+, \d{4})", text)
assert eff, "no effective date"

HEAD = re.compile(r"Table \d+ - If the Payroll Period with Respect to an Employee is (DAILY or MISCELLANEOUS|SEMI-MONTHLY|SEMI-ANNUAL|BI-WEEKLY|QUARTERLY|MONTHLY|ANNUAL|WEEKLY)")
PERIOD = {"WEEKLY": "weekly", "BI-WEEKLY": "biweekly", "SEMI-MONTHLY": "semimonthly", "MONTHLY": "monthly",
          "QUARTERLY": "quarterly", "SEMI-ANNUAL": "semiannual", "ANNUAL": "annual", "DAILY or MISCELLANEOUS": "daily"}
NUM = r"[\d,]+(?:\.\d\d)?"
ROW = re.compile(rf"\$ ({NUM}) (?:\$ {NUM}|and over) (?:\$ ({NUM}) \+ )?(\d+\.\d)% \$ ({NUM})")
STATUSES = ("single", "married", "headOfHousehold")


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


tables = {}
period = None
for line in text.splitlines():
    m = HEAD.search(line)
    if m:
        period = PERIOD[m.group(1)]
        tables[period] = {s: [[0, 0, 0]] for s in STATUSES}
        continue
    if period is None:
        continue
    rows = ROW.findall(line)
    if not rows:
        continue
    assert len(rows) == 3, (period, line)
    for status, (over, base, rate, excess) in zip(STATUSES, rows):
        assert cents(over) == cents(excess), (period, status, line)
        tables[period][status].append([cents(over), cents(base) if base else 0, round(float(rate) * 100)])

assert sorted(tables) == sorted(PERIOD.values()), sorted(tables)
for p, by in tables.items():
    for s, rows in by.items():
        assert [r[2] for r in rows] == [0, 150, 320, 320, 430, 430, 470, 470, 490, 590], (p, s, rows)

print(json.dumps({"effective": eff.group(1), "tables": tables}))
