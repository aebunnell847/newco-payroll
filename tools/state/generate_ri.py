"""Regenerate Rhode Island's percentage-method tables in src/regulatory/state/ri.js.

Reads the Division of Taxation's "Rhode Island Employer's Income Tax
Withholding Tables" booklet and prints its "Tables for Percentage Method of
Withholding" (Tables 1-8, all filing statuses; printed two per row) as
JSON: {period: [[overCents, baseCents, rateBasisPoints], ...]}. Never
hand-typed.

    pip install pypdf==5.1.0
    curl -o ri.pdf "https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-12/2026%20Withholding%20Tax%20Booklet.pdf"
    python generate_ri.py ri.pdf > ri.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
pages = [p.extract_text(extraction_mode="layout") for p in PdfReader(sys.argv[1]).pages]
page = next(p for p in pages if "TABLES FOR PERCENTAGE METHOD OF WITHHOLDING" in p)
eff = re.search(r"WAGES PAID ON OR AFTER ([A-Z]+ \d+, \d{4})", page)
assert eff, "no effective date"

PERIODS = {
    "WEEKLY": "weekly",
    "BIWEEKLY": "biweekly",
    "SEMIMONTHLY": "semimonthly",
    "MONTHLY": "monthly",
    "QUARTERLY": "quarterly",
    "SEMIANNUAL": "semiannual",
    "ANNUAL": "annual",
    "DAILY OR MISC": "daily",
}
HEAD = re.compile(r"TABLE \d+ - (DAILY OR MISC|SEMIMONTHLY|SEMIANNUAL|BIWEEKLY|QUARTERLY|MONTHLY|ANNUAL|WEEKLY) PAYROLL PERIOD")
NUM = r"[\d,]+(?:\.\d\d)?"
ROW = re.compile(rf"\$?\s*({NUM})\s+(?:\$?\s*{NUM}|…+)\s+\$?\s*({NUM})\s+PLUS\s+(\d+\.\d+)%\s+\$?\s*({NUM})")


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


tables = {}
current = []
for line in page.splitlines():
    line = re.sub(r"[ \t]+", " ", line)
    heads = HEAD.findall(line)
    if heads:
        current = [PERIODS[h] for h in heads]
        for p in current:
            tables[p] = []
        continue
    rows = ROW.findall(line)
    if not rows or not current:
        continue
    assert len(rows) == len(current), (current, line)
    for period, (over, base, rate, excess) in zip(current, rows):
        assert cents(over) == cents(excess), (period, line)
        tables[period].append([cents(over), cents(base), round(float(rate) * 100)])

assert sorted(tables) == sorted(PERIODS.values()), sorted(tables)
for p, rows in tables.items():
    assert [r[2] for r in rows] == [375, 475, 599], (p, rows)
    assert rows[0][:2] == [0, 0], (p, rows)

print(json.dumps({"effective": eff.group(1), "tables": tables}))
