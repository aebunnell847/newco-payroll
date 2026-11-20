"""Regenerate Iowa's withholding-formula figures in src/regulatory/state/ia.js.

Reads the Iowa Department of Revenue's "Iowa Individual Income Tax
Withholding Formula" PDF and prints, as JSON:
  {"effective": "January 1, 2027", "edition": "Released November 2026",
   "rateBp": 380, "legacyAllowanceCents": 4000,
   "deductionCents": {"current": {A|B|C: {period: cents}},
                      "legacy":  {A|B:   {period: cents}}},
   "examples": [{"n", "period", "wagesCents", "status", "allowanceCents"
                 | "allowances", "printedT2Cents", "withheldCents"}, ...]}
The deduction tables and the ten worked examples are never hand-typed.

Checks the PDF's shape every run: twelve "Deduction Amounts by Pay Period"
rows (six for the 2024-or-later IA W-4 with columns A/B/C, six for the
2023-or-earlier IA W-4 with columns A/B), each printed per-period amount
equal to the annual amount / periods rounded to the cent (daily: / 260),
legacy column A == current column A and legacy column B (Married) ==
current column C, a 3.80% rate, a $40 legacy allowance, and ten examples.

The example parser follows the 2027 edition's wording ("Total allowances
amount: $40", "Total withholding allowance claimed: 1"); the 2025 and 2026
editions word their examples differently, and their figures in ia.js
predate this script (transcribed, and pinned by all ten of each year's
worked examples).

    pip install pypdf==5.1.0
    curl -o ia.pdf https://revenue.iowa.gov/media/61/download
    python generate_ia.py ia.pdf > ia.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
reader = PdfReader(sys.argv[1])
pages = [re.sub(r"[ \t]+", " ", p.extract_text()) for p in reader.pages]
text = "\n".join(pages)
flat = re.sub(r"\s+", " ", text)

eff = re.search(r"Effective (January 1, \d{4})", flat)
assert eff, "no effective date"
edition = re.search(r"Released ([A-Z][a-z]+ \d{4})", flat)
assert edition, "no release marker"
year = eff.group(1)[-4:]
# The trigger is the date wages are paid ("Wages Paid Beginning ...").
paid = re.findall(r"wages paid (?:beginning|on or after) (January 1, \d{4})", flat, re.I)
assert paid and set(paid) == {eff.group(1)}, ("effective-date wording changed", paid)

rate = re.search(r"T2 = T1 x (\d+\.\d\d)% \(or (0\.\d+)\)", flat)
assert rate, "no rate"
rate_bp = round(float(rate.group(1)) * 100)
assert rate_bp == round(float(rate.group(2)) * 10_000), rate.groups()
assert rate_bp == 380, rate_bp
allow = re.search(r"multiplying the number of allowances claimed by the employee on the IA W ?-4 by \$(\d+)", flat)
assert allow, "no legacy allowance amount"
legacy_allowance = int(allow.group(1)) * 100
assert legacy_allowance == 40_00, legacy_allowance


def cents(s):
    s = s.replace(",", "").lstrip("$")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


PERIODS = {"Daily": ("daily", 260), "Weekly": ("weekly", 52), "Biweekly": ("biweekly", 26),
           "Semimonthly": ("semimonthly", 24), "Monthly": ("monthly", 12), "Annually": ("annual", 1)}
MONEY = r"\$[\d,]+\.\d\d"
ROW = re.compile(rf"^(Daily|Weekly|Biweekly|Semimonthly|Monthly|Annually) ({MONEY}) ({MONEY})(?: ({MONEY}))?\s*$")

rows = [ROW.match(line.strip()) for line in text.splitlines()]
rows = [m for m in rows if m]
assert len(rows) == 12, [m.group(0) for m in rows]
current_rows, legacy_rows = rows[:6], rows[6:]
assert all(m.group(4) for m in current_rows), "2024+ table must have columns A, B, C"
assert not any(m.group(4) for m in legacy_rows), "2023- table must have columns A, B"
assert [m.group(1) for m in current_rows] == list(PERIODS) == [m.group(1) for m in legacy_rows]
assert re.search(r"(?:Filing|Marital) Status Reported on 2024", flat), "no 2024-or-later table header"
assert re.search(r"Marital Status Reported on 2023 (?:or Earlier IA W-4|IA W-4 or earlier)", flat, re.I), "no legacy header"
assert "Head of Household" in flat and "Qualified Surviving Spouse" in flat


def table(rs, columns):
    out = {c: {} for c in columns}
    for m in rs:
        period, _ = PERIODS[m.group(1)]
        for i, c in enumerate(columns):
            out[c][period] = cents(m.group(2 + i))
    for c, by in out.items():
        annual = by["annual"]
        for name, n in PERIODS.values():
            # round half up, in integer cents
            assert by[name] == (2 * annual + n) // (2 * n), (c, name, by[name], annual)
    return out


current = table(current_rows, "ABC")
legacy = table(legacy_rows, "AB")
assert legacy["A"] == current["A"], "legacy Single should equal current column A"
assert legacy["B"] == current["C"], "legacy Married should equal current column C"

# Worked examples: the descriptions, then the T1..T4 blocks, in example order.
STATUS = [
    ("Married jointly and spouse having no earned income", "marriedJointSpouseNoEarnings"),
    ("Head of Household", "headOfHousehold"),
    ("Other", "other"),
    ("Single", "single"),
    ("Married", "married"),
]
DESC = re.compile(
    r"Example (\d+): (Biweekly|Monthly) wages of (\$[\d,]+\.\d\d), with .(.+?). (?:Filing|Marital) Status"
    r".*?\((Total allowance ?s? amount: ?\$(\d+)|Total withholding allowance ?s? claimed: (\d+))"
)
examples = []
for m in DESC.finditer(flat):
    label = m.group(4)
    status = next(code for key, code in STATUS if label.startswith(key))
    ex = {"n": int(m.group(1)), "period": m.group(2).lower(), "wagesCents": cents(m.group(3)), "status": status}
    if m.group(6) is not None:
        ex["allowanceCents"] = int(m.group(6)) * 100
    else:
        ex["allowances"] = int(m.group(7))
    examples.append(ex)
t2 = re.findall(rf"T2 = T1 x R T2 = {MONEY} x 3\.80% = ({MONEY})", flat)
withheld = re.findall(rf"({MONEY}) ?Iowa tax to be withheld", flat)
assert [e["n"] for e in examples] == list(range(1, 11)), [e["n"] for e in examples]
assert len(t2) == len(withheld) == 10, (t2, withheld)
for ex, a, b in zip(examples, t2, withheld):
    ex["printedT2Cents"] = cents(a)
    ex["withheldCents"] = cents(b)

print(json.dumps({
    "effective": eff.group(1),
    "edition": f"Released {edition.group(1)}",
    "rateBp": rate_bp,
    "legacyAllowanceCents": legacy_allowance,
    "deductionCents": {"current": current, "legacy": legacy},
    "examples": examples,
}, indent=1))
