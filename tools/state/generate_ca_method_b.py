"""Regenerate California's annual Method B figures in src/regulatory/state/ca.js.

Reads EDD's "California Withholding Schedules for <year> - Method B" PDF and
prints, as JSON, the ANNUAL payroll-period values the code uses:
  lowIncomeExemption  (Table 1, annual row)
  estimatedDeduction  (Table 2, annual column, per allowance)
  standardDeduction   (Table 3, annual row)
  exemptionCredit     (Table 4, annual column, per allowance)
  brackets            (Tables 5-7: single, married, headOfHousehold)
All amounts in cents; rates in thousandths of a percent (1.100% -> 1100).

    pip install pypdf==5.1.0
    curl -o 26methb.pdf https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf
    python generate_ca_method_b.py 26methb.pdf > ca-2026.json

Compare with the arrays in ca.js. The tables are never hand-typed.
"""
import json
import re
import sys

from pypdf import PdfReader

MONEY = r"\$[0-9,]+(?:\.[0-9]{2})?"


def cents(s):
    s = s.replace("$", "").replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def rate_milli(s):
    # "10.230%" -> 10230 (thousandths of a percent)
    whole, _, frac = s.rstrip("%").partition(".")
    return int(whole) * 1000 + int((frac + "000")[:3])


text = "\n".join((p.extract_text() or "") for p in PdfReader(sys.argv[1]).pages)
lines = [l.strip() for l in text.splitlines()]

# ---- Table 1 and Table 3: "Annual $a $b $c $d" rows (first = Table 1, second = Table 3)
annual_rows = [l for l in lines if re.fullmatch(rf"Annual( {MONEY}){{4}}", l)]
assert len(annual_rows) == 2, annual_rows
t1 = [cents(m) for m in re.findall(MONEY, annual_rows[0])]
t3 = [cents(m) for m in re.findall(MONEY, annual_rows[1])]
# columns: single/dual, married 0-1, married 2+, head of household
low_income = {"single": t1[0], "marriedZeroOrOne": t1[1], "marriedTwoOrMore": t1[2], "headOfHousehold": t1[3]}
standard = {"single": t3[0], "marriedZeroOrOne": t3[1], "marriedTwoOrMore": t3[2], "headOfHousehold": t3[3]}

# ---- Table 2 and Table 4: row "1 $w $b $s $m $q $sa $a $d" -> annual is the 7th amount
one_rows = [l for l in lines if re.fullmatch(rf"1( {MONEY}){{8}}", l)]
assert len(one_rows) == 2, one_rows
est_per = cents(re.findall(MONEY, one_rows[0])[6])
credit_per = cents(re.findall(MONEY, one_rows[1])[6])

# ---- Tables 5-7 (annual): between "Annual Payroll Period" and the next period heading
start = next(i for i, l in enumerate(lines) if l.startswith("Annual Payroll Period"))
end = next(i for i in range(start + 1, len(lines)) if "Payroll Period" in lines[i])
block = lines[start:end]
brackets, current = {}, None
names = {"Table 5": "single", "Table 6": "married", "Table 7": "headOfHousehold"}
row_re = re.compile(rf"({MONEY})\s+(?:{MONEY}|)\s*([0-9.]+%)\s+({MONEY})\s+({MONEY})")
pending = ""
for l in block:
    for key, name in names.items():
        if key in l:
            current = name
            brackets[name] = []
    if current is None:
        continue
    # top rows wrap: "$1,000,000 " / "and over N/A 14.630% $1,000,000 $114,220.27"
    if re.fullmatch(MONEY, l):
        pending = l
        continue
    if l.startswith("and over N/A") and pending:
        l = pending + " " + l.replace("and over N/A", "")
        pending = ""
    m = row_re.fullmatch(l)
    if m:
        over, rate, of_over, plus = m.groups()
        assert cents(over) == cents(of_over), l
        brackets[current].append([cents(over), cents(plus), rate_milli(rate)])

for name, rows in brackets.items():
    assert len(rows) == 10, (name, len(rows))

print(json.dumps({
    "lowIncomeExemptionCents": low_income,
    "standardDeductionCents": standard,
    "estimatedDeductionPerAllowanceCents": est_per,
    "exemptionCreditPerAllowanceCents": credit_per,
    "brackets": brackets,
}, indent=2))
