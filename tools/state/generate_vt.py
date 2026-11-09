"""Regenerate Vermont's percentage-method tables in src/regulatory/state/vt.js.

Reads GB-1210 "Income Tax Withholding Instructions, Tables, and Charts" and
prints its "Vermont Percentage Method Withholding Tables" (single and married,
seven payroll frequencies, plus each table's allowance amount) as JSON:
{period: {"allowanceCents": n, "single": [[overCents, baseCents, rateBp]...],
"married": [...]}}. Never hand-typed.

    pip install pypdf==5.1.0
    curl -o vt.pdf https://tax.vermont.gov/sites/tax/files/documents/GB-1210-2026.pdf
    python generate_vt.py vt.pdf > vt.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(
    re.sub(r"[ \t]+", " ", p.extract_text(extraction_mode="layout")) for p in PdfReader(sys.argv[1]).pages
)
assert re.search(r"Effective Date: January 1, \d{4}", text)

HEAD = re.compile(r"^\s*(WEEKLY|BIWEEKLY|SEMIMONTHLY|MONTHLY|QUARTERLY|ANNUAL|DAILY or MISCELLANEOUS) PAYROLLS")
PERIOD = {"WEEKLY": "weekly", "BIWEEKLY": "biweekly", "SEMIMONTHLY": "semimonthly", "MONTHLY": "monthly",
          "QUARTERLY": "quarterly", "ANNUAL": "annual", "DAILY or MISCELLANEOUS": "daily"}
NUM = r"[\d,]+(?:\.\d\d)?"
ROW = re.compile(rf"({NUM}) (?:{NUM}|-) ({NUM}) \+ (\d+\.\d+)% \$?({NUM})")
ALLOW = re.compile(r"one withholding allowance equals \$([\d,]+\.\d\d)")


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


tables = {}
period = None
for line in text.splitlines():
    m = HEAD.match(line)
    if m:
        period = PERIOD[m.group(1)]
        tables[period] = {"single": [[0, 0, 0]], "married": [[0, 0, 0]]}
        continue
    if period is None:
        continue
    a = ALLOW.search(line)
    if a:
        tables[period]["allowanceCents"] = cents(a.group(1))
        period = None
        continue
    rows = ROW.findall(line)
    if not rows:
        continue
    assert len(rows) == 2, (period, line)
    for status, (over, base, rate, excess) in zip(("single", "married"), rows):
        assert cents(over) == cents(excess), (period, line)
        tables[period][status].append([cents(over), cents(base), round(float(rate) * 100)])

assert sorted(tables) == sorted(PERIOD.values()), sorted(tables)
for p, t in tables.items():
    assert "allowanceCents" in t, p
    for s in ("single", "married"):
        assert [r[2] for r in t[s]] == [0, 335, 660, 760, 875], (p, s, t[s])

print(json.dumps(tables))
