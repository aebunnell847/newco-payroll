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
reader = PdfReader(sys.argv[1])
text = "\n".join(re.sub(r"[ \t]+", " ", p.extract_text(extraction_mode="layout")) for p in reader.pages)
eff = re.search(r"For wages paid on or after (January \d+, \d{4})", text)
# No match: the 2025 edition (Rev. 11/2024) prints its tables on rotated
# pages, which the layout extractor can't read; see parse_plain below.

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



PLAIN_ORDER = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "semiannual", "annual", "daily"]
PERIODS_PER_YEAR = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12, "quarterly": 4,
                    "semiannual": 2, "annual": 1, "daily": 260}
PLAIN_ROW = re.compile(rf"({NUM}) (?:{NUM}|and over) (?:({NUM}) \+ )?(\d+\.\d)% ({NUM})")


def parse_plain(reader):
    """Plain-text reading of the 2025 layout: "313$ 542 $ 1.5% 313 $ ...".

    The tables come out in the order weekly, biweekly, semimonthly, monthly,
    quarterly, semiannual, annual, daily (the page headings don't line up
    with them), and each one's single "Not Over" amount is checked against
    the annual table's so a misordering fails loudly.
    """
    raw = "\n".join(p.extract_text() for p in reader.pages)
    eff_m = re.search(r"For wages paid on or after (January \d+, \d{4})", raw)
    assert eff_m, "no effective date in plain text either"
    out, thresholds, cur = [], [], None
    for line in raw.splitlines():
        line = re.sub(r"\s+", " ", line.replace("$", " ").replace("Ove r", "Over").replace("ove r", "over")).strip()
        nm = re.match(rf"Not Over ({NUM}) 0\.00 Not Over ({NUM}) 0\.00 Not Over ({NUM}) 0\.00$", line)
        if nm:
            cur = {s: [[0, 0, 0]] for s in STATUSES}
            out.append(cur)
            thresholds.append(cents(nm.group(1)))
            continue
        if cur is None:
            continue
        rows = PLAIN_ROW.findall(line)
        if len(rows) != 3:
            continue
        for status, (over, base, rate, excess) in zip(STATUSES, rows):
            assert cents(over) == cents(excess), (status, line)
            cur[status].append([cents(over), cents(base) if base else 0, round(float(rate) * 100)])
    assert len(out) == 8, len(out)
    tables = dict(zip(PLAIN_ORDER, out))
    annual = thresholds[PLAIN_ORDER.index("annual")]
    for period, th in zip(PLAIN_ORDER, thresholds):
        assert abs(th * PERIODS_PER_YEAR[period] - annual) <= 100 * PERIODS_PER_YEAR[period], (period, th, annual)
    return tables, eff_m.group(1)


if eff:
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

else:
    tables, effective = parse_plain(reader)

assert sorted(tables) == sorted(PERIOD.values()), sorted(tables)
ladder = [r[2] for r in tables["weekly"]["single"]]
assert ladder[0] == 0 and all(a <= b for a, b in zip(ladder, ladder[1:])), ladder
for p, by in tables.items():
    for s, rows in by.items():
        assert [r[2] for r in rows] == ladder, (p, s, rows)

print(json.dumps({"effective": eff.group(1) if eff else effective, "tables": tables}))
