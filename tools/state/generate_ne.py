"""Regenerate Nebraska's percentage-method tables in src/regulatory/state/ne.js.

Reads the Department of Revenue's "Nebraska Income Tax Withholding
Percentage Method Tables" (Circular EN) and prints Tables 1-8 (single and
married) as JSON: {"effective": ..., "tables": {period: {single|married:
[[overCents, baseCents, rateBasisPoints], ...]}}}. Never hand-typed.

    pip install pypdf==5.1.0
    curl -O https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2025/2026_percent.pdf
    python generate_ne.py 2026_percent.pdf > ne.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(p.extract_text(extraction_mode="layout") for p in PdfReader(sys.argv[1]).pages)
eff = re.search(r"For Wages Paid on or After ([A-Z][a-z]+ \d+, \d{4})", text)
assert eff, "no effective date"

PERIODS = {
    "WEEKLY": "weekly",
    "BIWEEKLY": "biweekly",
    "SEMIMONTHLY": "semimonthly",
    "MONTHLY": "monthly",
    "QUARTERLY": "quarterly",
    "SEMIANNUAL": "semiannual",
    "ANNUAL": "annual",
    "DAILY OR MISCELLANEOUS": "daily",
}
HEAD = re.compile(r"TABLE\s+\d+\s+-\s+(DAILY OR MISCELLANEOUS|SEMIMONTHLY|SEMIANNUAL|BIWEEKLY|QUARTERLY|MONTHLY|ANNUAL|WEEKLY)\s+Payroll", re.I)
# The 2025 tables print some bases with a "$" ("$0.00 plus ..."); 2026 doesn't.
ROW = re.compile(r"\$?\s*([\d,]+)\s+(?:[\d,]+|\S)\s+\$?\s*([\d,]+\.\d\d)\s+[Pp]lus\s+(\d+\.\d+)%\s+([\d,]+)")


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


tables = {}
period = None
for line in text.splitlines():
    m = HEAD.search(line)
    if m:
        period = PERIODS[m.group(1).upper()]
        tables[period] = {"single": [[0, 0, 0]], "married": [[0, 0, 0]]}
        continue
    if period is None:
        continue
    rows = ROW.findall(line)
    if not rows:
        continue
    assert len(rows) == 2, (period, line)
    for status, (over, base, rate, excess_over) in zip(("single", "married"), rows):
        assert over == excess_over, (period, status, line)
        tables[period][status].append([cents(over), cents(base), round(float(rate) * 100)])

assert sorted(tables) == sorted(PERIODS.values()), sorted(tables)
# Every table uses the same rate ladder (2026: 2.26 3.22 4.21 4.35 4.48 4.60;
# 2025: 2.26 3.22 4.91 5.07 5.23 5.37), increasing, starting at a zero base.
ladder = [r[2] for r in tables["weekly"]["single"]]
assert ladder[0] == 0 and all(a < b for a, b in zip(ladder, ladder[1:])), ladder
for p, by in tables.items():
    for s, rows in by.items():
        assert [r[2] for r in rows] == ladder, (p, s, rows)
        assert rows[1][1] == 0, (p, s)

print(json.dumps({"effective": eff.group(1), "tables": tables}))
