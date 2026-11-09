"""Regenerate Oklahoma's percentage-method tables in src/regulatory/state/ok.js.

Reads the Oklahoma Tax Commission's Packet OW-2 ("Oklahoma Income Tax
Withholding Tables") and prints its "Tables for Percentage Method of
Withholding" (Tables 1-8, single and married) as JSON:
{period: {single|married: [[overCents, baseCents, rateBasisPoints], ...]}}.
The tables are never hand-typed.

    pip install pypdf==5.1.0
    curl -o ow2.pdf https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/businesses/withholding-tables/WHTables-2026.pdf
    python generate_ok.py ow2.pdf > ok.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
pages = [p.extract_text(extraction_mode="layout") for p in PdfReader(sys.argv[1]).pages]
text = "\n".join(pages)
assert re.search(r"Packet OW-2 .{0,20}Revised", text), "unexpected document"

PERIODS = {
    "WEEKLY": "weekly",
    "BI-WEEKLY": "biweekly",
    "SEMI-MONTHLY": "semimonthly",
    "MONTHLY": "monthly",
    "QUARTERLY": "quarterly",
    "SEMI-ANNUAL": "semiannual",
    "ANNUAL": "annual",
    "DAILY or MISCELLANEOUS": "daily",
}
HEAD = re.compile(r"Table (\d): (DAILY or MISCELLANEOUS|SEMI-MONTHLY|SEMI-ANNUAL|BI-WEEKLY|QUARTERLY|MONTHLY|ANNUAL|WEEKLY) Payroll Period")
# One table row: "$over  ($upper | and above)  $base  [+(rate% of the excess over $over)]".
# Some 2025 rows print the base as "0" (no cents) or with a doubled "$ $".
ROW = re.compile(
    r"\$\s*([\d,]+)\s+(\$\s*[\d,]+|and\s+above)\s*\$\s*(?:\$\s*)?([\d,]+(?:\.\d\d)?)\s*(?:\+\(\s*(\d+\.\d+)%\s+of\s+the\s+excess\s+over\s+\$\s*([\d,]+))?"
)


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


corrections = []
tables = {}
period = None
in_percentage_section = False
done = False
for line in text.splitlines():
    if "Tables for Percentage Method of Withholding" in line:
        in_percentage_section = True
    m = HEAD.search(line)
    if m and in_percentage_section:
        period = PERIODS[m.group(2)]
        tables.setdefault(period, {"single": [], "married": []})
        continue
    if period is None:
        continue
    rows = ROW.findall(line)
    if len(rows) != 2:
        continue
    last = False
    for status, (over, upper, base, rate, excess_over) in zip(("single", "married"), rows):
        over_c = cents(over)
        if rate and cents(excess_over) != over_c:
            # 2025's daily married column prints "Over $50 ... of the excess over
            # $49" (and $58/$57, $69/$68, $79/$78): the formula's own "excess
            # over" figure is the bracket edge, so use it and report the fix.
            assert over_c - cents(excess_over) == 100, (period, status, line)
            corrections.append((period, status, over, excess_over))
            over_c = cents(excess_over)
        tables[period][status].append([over_c, cents(base), int(round(float(rate or 0) * 100))])
        last = last or upper.startswith("and")
    # Each table ends at its "and above" row; the wage-bracket tables follow
    # the last (daily) one.
    if last and len(tables) == 8:
        break

for c in corrections:
    print("corrected edge (printed over, excess over):", c, file=sys.stderr)

assert sorted(tables) == sorted(PERIODS.values()), sorted(tables)
ladder = [r[2] for r in tables["weekly"]["single"]]
assert ladder[0] == 0 and all(a < b for a, b in zip(ladder, ladder[1:])), ladder
for p, by_status in tables.items():
    for s, rows in by_status.items():
        assert rows[0][:3] == [0, 0, 0], (p, s, rows[0])
        assert [r[2] for r in rows] == ladder, (p, s, rows)
        assert all(rows[i][0] < rows[i + 1][0] for i in range(len(rows) - 1)), (p, s)

print(json.dumps(tables, indent=1))
