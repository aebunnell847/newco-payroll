"""Regenerate New York's withholding tables in src/regulatory/state/ny.js.

Reads the NY Tax Department's own booklets and prints, as JSON, the
Method II (exact calculation) tables, the deduction/exemption allowances
(Tables B and C, cross-checked against Table A), and the Method III top
income rates where the booklet has them:

    NYS-50-T-NYS  New York State
    NYS-50-T-NYC  New York City (residents)
    NYS-50-T-Y    Yonkers (resident surcharge uses the State method)

    pip install pypdf==5.1.0
    curl -O https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf
    curl -O https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nyc.pdf
    curl -O https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_y.pdf
    python generate_ny.py nys50_t_nys.pdf > nys.json   (likewise for nyc, y)

All amounts in cents; rates in basis points of a basis point (0.0753 ->
753, i.e. ten-thousandths). The tables are never hand-typed.
"""
import json
import re
import sys

from pypdf import PdfReader

PERIODS = {"daily": 260, "weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12, "annual": 1}


def cents(s):
    s = s.replace("$", "").replace(",", "").strip()
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


pages = [p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages]

# ---- Tables A, B, C (allowances)
text = "\n".join(pages)
lines = [l.strip() for l in text.splitlines()]


def period_key(label):
    label = label.lower()
    if label.startswith("daily"):
        return "daily"
    for k in PERIODS:
        if label.startswith(k):
            return k
    return None


# Table B: "<Period> Single $x" / "Married y" (and "Daily or" / "miscellaneous" / "Single $x")
def table_after(title, stop):
    start = next(i for i, l in enumerate(lines) if l == title)
    end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith(stop))
    return lines[start:end]


table_b = {}
current = None
for l in table_after("Table B", "Table C"):
    m = re.fullmatch(r"(Daily or|Weekly|Biweekly|Semimonthly|Monthly|Annual)?\s*(Single|Married) \$?([\d,.]+)", l)
    if l.startswith("miscellaneous"):
        continue
    if l == "Daily or":
        current = "daily"
        continue
    if m:
        if m.group(1):
            current = period_key(m.group(1))
        elif current is None:
            continue
        table_b.setdefault(current, {})[m.group(2).lower()] = cents(m.group(3))
table_c = {}
for l in table_after("Table C", "Table D"):
    m = re.fullmatch(r"(Daily/miscellaneous|Weekly|Biweekly|Semimonthly|Monthly|Annual) \$?([\d,.]+)", l)
    if m:
        table_c[period_key(m.group(1))] = cents(m.group(2))

# Table A cross-check: every published cell must equal B + n x C
table_a_rows = 0
current = None
for l in table_after("Table A", "Table B"):
    m = re.fullmatch(r"(Daily or|Weekly|Biweekly|Semimonthly|Monthly|Annual)?\s*(Single|Married) ((?:\$?[\d,.]+ ?){11})", l)
    if l.startswith("miscellaneous"):
        continue
    if l == "Daily or":
        current = "daily"
        continue
    if m:
        if m.group(1):
            current = period_key(m.group(1))
        status = m.group(2).lower()
        values = [cents(v) for v in m.group(3).split()]
        for n, v in enumerate(values):
            assert v == table_b[current][status] + n * table_c[current], (current, status, n, v)
        table_a_rows += 1
assert table_a_rows == 12, table_a_rows

# ---- Method II tables: "Table II - X <Period> payroll", status from the page heading
# Bracket edges can carry cents (NYC daily: "33.50").
AMT = r"\$?([\d,]+(?:\.\d{2})?)"
row_re = re.compile(rf"(\d+) {AMT} (?:\$?[\d,]+(?:\.\d{{2}})?|\.+) {AMT} (0\.\d{{4}}) \$?([\d,.]+)")
method2 = {}
for page in pages:
    head = page[:400]
    if "Exact Calculation Method" not in head and "Method II" not in head:
        continue
    status = "single" if "Single" in head.split("Table II")[0] else "married" if "Married" in head.split("Table II")[0] else None
    if status is None:
        continue
    current = None
    for l in (x.strip() for x in page.splitlines()):
        h = re.match(r"Table II - [A-F] (Daily|Weekly|Biweekly|Semimonthly|Monthly|Annual)", l, re.I)
        if h or l == "Annual Tax Rate Schedule":
            current = period_key(h.group(1)) if h else "annual"
            method2.setdefault(status, {})[current] = []
            continue
        if current is None:
            continue
        m = row_re.fullmatch(l)
        if m:
            line_no, over, sub, rate, plus = m.groups()
            assert cents(over) == cents(sub), l
            rows = method2[status][current]
            assert int(line_no) == len(rows) + 1, (status, current, l)
            rows.append([cents(over), int(rate.replace("0.", "")), cents(plus)])

for status, by_period in method2.items():
    for period, rows in by_period.items():
        assert rows and rows[0][0] == 0, (status, period)

# ---- Method III (top income) rates, read only from the Method III page:
# "$1,077,550 $5,000,000 0.1045" - the single table, then the married one.
method3 = {}
m3_pages = [p for p in pages if "Method III Top Income Tax Rates Method" in p[:300]]
if m3_pages:
    flat = []
    for l in (x.strip() for x in m3_pages[0].splitlines()):
        m = re.fullmatch(r"\$?([\d,]+)\s+(?:\$?[\d,]+|\.+)\s+(0\.\d{4})", l)
        if m:
            flat.append([cents(m.group(1)), int(m.group(2).replace("0.", ""))])
    assert len(flat) == 6, flat
    method3 = {"single": flat[:3], "married": flat[3:]}

# Rates are ten-thousandths: 0.0753 -> 753.
print(json.dumps({
    "deductionCents": table_b,
    "exemptionCents": table_c,
    "method2": method2,
    "method3": method3,
}, indent=1))
