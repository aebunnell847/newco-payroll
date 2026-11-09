"""Regenerate Montana's withholding formula tables in src/regulatory/state/mt.js.

Reads the Department of Revenue's "Montana Employer and Information Agent
Guide with Montana Withholding Tax Tables" and prints the "Montana
Withholding Tax Formula" tables (W = A + B x (G - C)) as JSON:
{status: {period: [[overCents, baseCents, rateBasisPoints], ...]}} for
status in single (lines 1a / 2), marriedJoint (1b), headOfHousehold (1c).
Never hand-typed.

    pip install pypdf==5.1.0
    curl -o mt.pdf https://revenuefiles.mt.gov/files/Forms/Montana_Employer_and_Information_Agent_Guide_with_Tax_Tables.pdf
    python generate_mt.py mt.pdf > mt.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages)
start = text.index("Montana Withholding Tax Formula:")
text = text[start:]

STATUS = [
    ("Single, Married Filing Separately", "single"),
    ("Married Filing Jointly or Qualifying Surviving Spouse", "marriedJoint"),
    ("Head of Household", "headOfHousehold"),
]
PERIOD = re.compile(r"^(Monthly|Semi-Monthly|Bi-Weekly|Weekly|Daily|Annual) Payroll Period")
PERIOD_NAME = {"Monthly": "monthly", "Semi-Monthly": "semimonthly", "Bi-Weekly": "biweekly", "Weekly": "weekly", "Daily": "daily", "Annual": "annual"}
ROW = re.compile(r"^\$([\d,]+)\s+(?:\$[\d,]+\s+)?\$([\d,]+)\s+plus\s+(\d+(?:\.\d+)?)% of the net taxable earnings over \$([\d,]+)")


def cents(s):
    return int(s.replace(",", "")) * 100


out = {}
status = None
period = None
for line in text.splitlines():
    line = line.strip()
    for label, key in STATUS:
        if line.startswith(label):
            status = key
            out[status] = {}
    m = PERIOD.match(line)
    if m and status:
        period = PERIOD_NAME[m.group(1)]
        out[status][period] = []
        continue
    m = ROW.match(line)
    if m and status and period:
        frm, base, rate, over = m.groups()
        assert frm == over, line
        out[status][period].append([cents(frm), cents(base), round(float(rate) * 100)])

assert sorted(out) == ["headOfHousehold", "marriedJoint", "single"], sorted(out)
for s, by in out.items():
    assert sorted(by) == sorted(PERIOD_NAME.values()), (s, sorted(by))
    for p, rows in by.items():
        assert [r[2] for r in rows] == [0, 470, 565], (s, p, rows)

print(json.dumps(out))
