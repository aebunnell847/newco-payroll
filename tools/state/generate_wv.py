"""Regenerate West Virginia's percentage-method tables in src/regulatory/state/wv.js.

Reads Form WV IT-100.2A "Tables for Percentage Method of Withholding" and
prints both table sets (two earner / two or more jobs, and the optional one
earner / one job set), each for six payroll periods, as JSON:
{"twoEarner"|"oneEarner": {period: [[overCents, baseCents, rateBp], ...]}}.

The PDF's text puts each block's rows before its heading, so blocks are
matched to payroll periods by their first bracket edge (the annual edge /
periods, rounded). Never hand-typed.

    pip install pypdf==5.1.0
    curl -O https://tax.wv.gov/Documents/Withholding/it100.2a.pdf
    python generate_wv.py it100.2a.pdf > wv.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
# The October 2024 edition prints hyphens as U+2010 ("IT‐100.2A", "‐$").
pages = [p.extract_text().replace("‐", "-") for p in PdfReader(sys.argv[1]).pages]
assert any("IT-100.2A" in p for p in pages)

# "$" sits before or after the space depending on the edition ("144 $" in 2026,
# "144$" in October 2024).
FIRST = re.compile(r"^-\s*\$\s*([\d,]+)\s*\$\s*(\d+\.\d+)%")
MID = re.compile(r"^([\d,]+)\s*\$\s*[\d,]+\s*\$\s*([\d,]+\.\d\d)\s*\$\s*plus\s+(\d+\.\d+)%\s+([\d,]+)")
TOP = re.compile(r"^([\d,]+)\s*\$\s*([\d,]+\.\d\d)\s*\$\s*plus\s+(\d+\.\d+)%\s+([\d,]+)")
PERIODS = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12, "annual": 1, "daily": 260}
ANNUAL_FIRST_EDGE = {"twoEarner": 7_500, "oneEarner": 10_000}


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


out = {"twoEarner": {}, "oneEarner": {}}
tset = None
for text in pages:
    # A set's heading is on its first page; its second page continues it.
    if "TWO EARNER" in text.upper():
        tset = "twoEarner"
    elif "ONE EARNER" in text.upper():
        tset = "oneEarner"
    if tset is None:
        continue
    block = None
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw.strip())
        m = FIRST.match(line)
        if m:
            edge = cents(m.group(1))
            period = min(PERIODS, key=lambda p: abs(edge / 100 - ANNUAL_FIRST_EDGE[tset] / PERIODS[p]))
            assert abs(edge / 100 - ANNUAL_FIRST_EDGE[tset] / PERIODS[period]) < 1, (tset, line)
            block = out[tset].setdefault(period, [[0, 0, round(float(m.group(2)) * 100)]])
            continue
        m = MID.match(line) or TOP.match(line)
        if m and block is not None:
            over, base, rate, excess = m.groups()
            assert over == excess, line
            block.append([cents(over), cents(base), round(float(rate) * 100)])

for tset, by in out.items():
    assert sorted(by) == sorted(PERIODS), (tset, sorted(by))
    for p, rows in by.items():
        # 2026: 2.11 / 2.81 / 3.16 / 4.22 / 4.58%; October 2024: 2.22 / 2.96 / 3.33 / 4.44 / 4.82%.
        assert [r[2] for r in rows] == [r[2] for r in out["twoEarner"]["weekly"]], (tset, p, rows)
        assert len(rows) == 5 and all(a < b for a, b in zip([r[2] for r in rows], [r[2] for r in rows][1:])), (tset, p)

print(json.dumps(out))
