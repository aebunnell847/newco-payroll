"""Regenerate Nebraska's percentage-method tables in src/regulatory/state/ne.js.

Reads the Department of Revenue's "Nebraska Income Tax Withholding
Percentage Method Tables" (Circular EN) and prints Tables 1-8 (single and
married) as JSON: {"effective": ..., "tables": {period: {single|married:
[[overCents, baseCents, rateBasisPoints], ...]}}}. Never hand-typed.

Given the Circular EN Instructions as a second argument, it also prints
"allowanceCents": the "Withholding Allowance Table" (value of one allowance
per payroll period), checked against annual / periods-per-year.

    pip install pypdf==5.1.0
    curl -O https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2026/2027_percent.pdf
    curl -O https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2026/2027_instruct.pdf
    python generate_ne.py 2027_percent.pdf 2027_instruct.pdf > ne.json
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
# Every table uses the same rate ladder (2027: 2.26 3.22 3.69 3.81 3.93 4.03;
# 2026: 2.26 3.22 4.21 4.35 4.48 4.60; 2025: 2.26 3.22 4.91 5.07 5.23 5.37),
# increasing, starting at a zero base.
ladder = [r[2] for r in tables["weekly"]["single"]]
assert ladder[0] == 0 and all(a < b for a, b in zip(ladder, ladder[1:])), ladder
for p, by in tables.items():
    for s, rows in by.items():
        assert [r[2] for r in rows] == ladder, (p, s, rows)
        assert rows[1][1] == 0, (p, s)

# Each row's base follows from the row below it (to the cent).
for p, by in tables.items():
    for s, rows in by.items():
        for a, b in zip(rows[1:], rows[2:]):
            assert abs(a[1] + (b[0] - a[0]) * a[2] / 10_000 - b[1]) <= 1, (p, s, a, b)

out = {"effective": eff.group(1), "tables": tables}

if len(sys.argv) > 2:
    itext = "\n".join(p.extract_text(extraction_mode="layout") for p in PdfReader(sys.argv[2]).pages)
    ieff = re.search(r"Withholding\s+Allowance\s+Table\s+Effective ([A-Z][a-z]+ \d+, \d{4})", itext)
    assert ieff and ieff.group(1) == eff.group(1), ("allowance table effective date", ieff and ieff.group(1))
    NAMES = {
        "Daily or Miscellaneous": ("daily", 260),
        "Weekly": ("weekly", 52),
        "Biweekly": ("biweekly", 26),
        "Semimonthly": ("semimonthly", 24),
        "Monthly": ("monthly", 12),
        "Quarterly": ("quarterly", 4),
        "Semiannually": ("semiannual", 2),
        "Annually": ("annual", 1),
    }
    allowance = {}
    for name, (key, _) in NAMES.items():
        m = re.search(rf"^\s*{name}\s*\.{{3,}}\s*\$?\s*([\d,]+\.\d\d)\s*$", itext, re.M)
        assert m, name
        allowance[key] = cents(m.group(1))
    for key, n in NAMES.values():
        # half-up: 2,510 / 24 = 104.583 -> 104.58; / 12 = 209.1667 -> 209.17
        assert allowance[key] == (2 * allowance["annual"] + n) // (2 * n), (key, allowance)
    out["allowanceCents"] = allowance

print(json.dumps(out))
