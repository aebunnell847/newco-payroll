"""Regenerate Kansas's percentage-method tables in src/regulatory/state/ks.js.

Reads the Kansas Department of Revenue's "Tables for Percentage Method of
Kansas Withholding" PDF and prints Tables 1-8 (single and married) as JSON:
{period: {single|married: [[overCents, baseCents, rateBasisPoints], ...]}}.
The tables are never hand-typed.

    pip install pypdf==5.1.0
    curl -O https://www.ksrevenue.gov/pdf/whrates.pdf
    python generate_ks.py whrates.pdf > ks.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages)
eff = re.search(r"For wages paid on and after ([A-Z][a-z]+ \d+, \d{4})", text)
assert eff, "no effective date"

PERIODS = {
    "WEEKLY": "weekly",
    "BI-WEEKLY": "biweekly",
    "SEMI-MONTHLY": "semimonthly",
    "MONTHLY": "monthly",
    "QUARTERLY": "quarterly",
    "SEMI-ANNUAL": "semiannual",
    "ANNUAL": "annual",
    "DAILY OR MISCELLANEOUS": "daily",
}
HEAD = re.compile(r"TABLE \d\s*\W+\s*(DAILY OR MISCELLANEOUS|SEMI-MONTHLY|SEMI-ANNUAL|BI-WEEKLY|QUARTERLY|MONTHLY|ANNUAL|WEEKLY)\s+PAYROLL PERIOD")
ROW = re.compile(r"\$([\d,]+)\s+(?:\$[\d,]+\s+)?(?:\$([\d,]+\.\d\d)\s+plus\s+)?(\d+\.\d+)% of excess over \$([\d,]+)")


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


tables = {}
period = None
for line in text.splitlines():
    m = HEAD.search(line)
    if m:
        period = PERIODS[m.group(1)]
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
        tables[period][status].append([cents(over), cents(base) if base else 0, round(float(rate) * 100)])

assert sorted(tables) == sorted(PERIODS.values()), sorted(tables)
for p, by in tables.items():
    for s, rows in by.items():
        assert [r[2] for r in rows] == [0, 520, 558], (p, s, rows)

print(json.dumps({"effective": eff.group(1), "tables": tables}))
