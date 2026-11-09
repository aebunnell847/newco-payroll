"""Regenerate Arkansas's formula-method tax brackets in src/regulatory/state/ar.js.

Reads the Department of Finance and Administration's "Withholding Tax
Formula Method" PDF and prints its bracket table as JSON:
{"standardDeduction": cents, "personalCredit": cents,
 "rows": [[fromCents, rateBasisPoints, adjustmentCents], ...]}.
The table is never hand-typed (it has a $100-step phase-out of the
adjustment near the top bracket).

    pip install pypdf==5.1.0
    curl -O https://www.dfa.arkansas.gov/wp-content/uploads/Withholding-Tax-Formula.pdf
    python generate_ar.py Withholding-Tax-Formula.pdf > ar.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages)
year = re.search(r"Tax Year (\d{4})", text)
assert year, "no tax year"
std = re.search(r"Standard Deduction of \$\s*([\d,]+)", text)
credit = re.search(r"Form AR4EC by \$([\d.]+)", text)
assert std and credit, "missing standard deduction or personal credit"


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


ROW = re.compile(r"^\$([\d,]+)\s+(?:\$[\d,]+|and over)\s+(\d+\.\d\d)%\s*(?:\$([\d,]+\.\d\d))?\s*$")
rows = []
for line in text.splitlines():
    m = ROW.match(line.strip())
    if m:
        frm, rate, adj = m.groups()
        rows.append([cents(frm), round(float(rate) * 100), cents(adj) if adj else 0])

assert rows[0] == [0, 0, 0], rows[0]
assert all(rows[i][0] < rows[i + 1][0] for i in range(len(rows) - 1))
assert rows[-1][1] == max(r[1] for r in rows)
print(json.dumps({
    "taxYear": int(year.group(1)),
    "standardDeduction": cents(std.group(1)),
    "personalCredit": cents(credit.group(1)),
    "rows": rows,
}))
