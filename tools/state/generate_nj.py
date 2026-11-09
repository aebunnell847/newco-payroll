"""Regenerate New Jersey's withholding rate tables in src/regulatory/state/nj.js.

Reads the Division of Taxation's "Tables for Percentage Method of
Withholding" PDF (Rate tables A-E, every payroll period) and prints them as
JSON: {rate: {period: [[overCents, baseCents, rateBasisPoints], ...]}}
plus the per-period allowance value.

    pip install pypdf==5.1.0
    curl -O https://www.nj.gov/treasury/taxation/pdf/withholdingtables.pdf
    python generate_nj.py withholdingtables.pdf > nj.json

The PDF prints two payroll periods side by side, so this reads it in
pypdf's layout mode and splits each row at its first rate. The tables are
never hand-typed.
"""
import json
import re
import sys

from pypdf import PdfReader

PERIOD_NAMES = {
    "WEEKLY": "weekly",
    "BIWEEKLY": "biweekly",
    "SEMIMONTHLY": "semimonthly",
    "MONTHLY": "monthly",
    "QUARTERLY": "quarterly",
    "SEMIANNUAL": "semiannual",
    "ANNUAL": "annual",
    "DAILY OR MISCELLANEOUS": "daily",
}


def cents(s):
    s = s.replace(",", "").replace(" ", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def bp(s):
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


pages = [p.extract_text(extraction_mode="layout") for p in PdfReader(sys.argv[1]).pages]
text = "\n".join(pages)
assert "Paid on and after October 1, 2020" in text, "unexpected table edition"

TOKEN = re.compile(r"\$\s*(\d[\d,]*(?:\.\d\d)?)|(\d+\.\d+)\s*%")
header_re = re.compile(r"(DAILY OR MISCELLANEOUS|SEMIMONTHLY|SEMIANNUAL|BIWEEKLY|QUARTERLY|MONTHLY|ANNUAL|WEEKLY)\s+PAYROLL\s+PERIOD\s*\(Allowance\s*\$\s*([\d,.]+)\)")

tables = {}
allowance = {}
rate = None
columns = []
for line in text.splitlines():
    m = re.search(r"RATE\s+\W([A-E])\W", line)
    if m:
        rate = m.group(1)
        tables.setdefault(rate, {})
        continue
    heads = header_re.findall(re.sub(r"\s+", " ", line))
    if heads:
        columns = [PERIOD_NAMES[h] for h, _ in heads]
        for (h, a) in heads:
            allowance[PERIOD_NAMES[h]] = cents(a)
            tables[rate].setdefault(PERIOD_NAMES[h], [])
        continue
    if rate is None or not columns:
        continue
    # Typos in the published PDF, normalized (and reported) before parsing:
    #   "82 ,180.00" -> "82,180.00"   (stray space)
    #   "$ 15.000"   -> "$ 15,000"    (Rate D quarterly: period for comma; no
    #                                  amount in these tables has 3 decimals,
    #                                  and the row's "excess over" says 15,000)
    #   "+ 1   1.8%" -> "+ 11.8%"     (Rate C semiannual: rate digits spaced apart)
    fixed = re.sub(r"(\d) ,(\d)", r"\1,\2", line)
    fixed2 = re.sub(r"(\$\s*\d+)\.(\d{3})(?![\d.])", r"\1,\2", fixed)
    if fixed2 != fixed:
        print(f"note: corrected thousands separator in Rate {rate}: {fixed.strip()[:60]}", file=sys.stderr)
    fixed3 = re.sub(r"\+\s*(\d)\s+(\d+\.\d+\s*%)", r"+ \1\2", fixed2)
    if fixed3 != fixed2:
        print(f"note: rejoined a split rate in Rate {rate}: {fixed2.strip()[-70:]}", file=sys.stderr)
    fixed2 = fixed3
    toks = []
    for money, pct in TOKEN.findall(fixed2):
        toks.append(("pct", bp(pct)) if pct else ("$", cents(money)))
    if sum(1 for k, _ in toks if k == "pct") != len(columns):
        continue
    # split into one group per column: money tokens, a pct, then one money (excess over)
    groups, cur = [], []
    i = 0
    while i < len(toks):
        cur.append(toks[i])
        if toks[i][0] == "pct":
            cur.append(toks[i + 1])
            groups.append(cur)
            cur = []
            i += 2
            continue
        i += 1
    assert len(groups) == len(columns), line
    for period, g in zip(columns, groups):
        before = [v for k, v in g[:-2]]
        pct, excess = g[-2][1], g[-1][1]
        over = before[0]
        if len(before) == 3:
            base = before[2]
        elif len(before) == 2:
            base = 0 if over == 0 else before[1]
        else:
            raise AssertionError(line)
        assert over == excess, (rate, period, line)
        tables[rate][period].append([over, base, pct])

for r, by_period in tables.items():
    assert len(by_period) == 8, (r, list(by_period))
    lengths = {len(rows) for rows in by_period.values()}
    assert len(lengths) == 1, (r, {p: len(x) for p, x in by_period.items()})
    for p, rows in by_period.items():
        assert rows[0][:2] == [0, 0], (r, p)
        assert all(rows[i][0] < rows[i + 1][0] for i in range(len(rows) - 1)), (r, p)
assert sorted(tables) == list("ABCDE"), sorted(tables)
# Every table shares the statutory bottom (1.5%) and top (11.8%) rates.
for r, by_period in tables.items():
    for p, rows in by_period.items():
        assert rows[0][2] == 150 and rows[-1][2] == 1180, (r, p, rows[0], rows[-1])

print(json.dumps({"allowanceCents": allowance, "rates": tables}, indent=1))
