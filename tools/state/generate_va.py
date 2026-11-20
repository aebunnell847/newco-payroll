"""Regenerate Virginia's withholding-formula figures in src/regulatory/state/va.js.

Reads Virginia Tax's "Withholding Table(s) for Wages Paid ..." package and
prints, as JSON, the formula's standard deduction, E1 / E2 exemption
amounts, annual brackets [[overCents, baseCents, rateBasisPoints], ...] and
pay-period conversion table (P), plus the edition's effective-date wording
and its worked example. The figures are never hand-typed.

Checks it runs every time (any failure stops the script):
  - four brackets, ascending, rates 2% / 3% / 5% / 5.75%, and each
    bracket's printed base follows from the bracket below it;
  - the worked example (T, W rounded to whole dollars, W/H) reproduces
    from the parsed figures;
  - every printed cell of the Daily, Weekly, Semi-Monthly, Biweekly and
    Monthly tables (rows contiguous, 11 exemption columns) equals the
    formula at the row's "But Less Than" wage, with W unrounded and the
    result rounded half-up to the cent (Daily, Weekly) or the dollar
    (the others). The Department calls the tables "approximate"; on the
    July 2025 - December 2026 and January 2027 editions they match the
    formula exactly.

    pip install pypdf==5.1.0
    curl -O https://www.tax.virginia.gov/sites/default/files/taxforms/withholding/any/employer-withholding-tables-january-2027-and-later-any.pdf
    python -I generate_va.py employer-withholding-tables-january-2027-and-later-any.pdf > va2027.json
"""
import json
import re
import sys
from fractions import Fraction

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
reader = PdfReader(sys.argv[1])
# The formula and example pages (1-2), whitespace collapsed so each regex
# sees one line, in two extractions: plain mode keeps the bracket table's
# wrapped cells in order (layout mode interleaves them on the January 2027
# edition), layout mode keeps words whole (plain mode splits "$2,649" across
# lines in the July 2025 edition's example). need() takes the first that
# matches; the checks below (bases, example, every table cell) catch a
# wrong match.
def collapsed(**kw):
    return " ".join(" ".join(p.extract_text(**kw).split()) for p in reader.pages[:2])


plain, layout = collapsed(), collapsed(extraction_mode="layout")


def dollars(s):
    return int(s.replace(",", ""))


def need(pattern, *texts):
    for text in texts or (plain, layout):
        m = re.search(pattern, text)
        if m:
            return m
    raise AssertionError(f"not found: {pattern}")


DATE = r"[A-Z][a-z]+ \d{1,2}, \d{4}"
eff = need(rf"Effective for wages paid after ({DATE})(?:, but before ({DATE}))?")
title = need(r"for Wages Paid (.+?) The amounts in").group(1)

f = need(r"\(G\)P - \[\$([\d,]+) \+ \(E1 X \$([\d,]+)\) \+ \(E2 X \$?([\d,]+)\)\] = T")
std, e1, e2 = (dollars(g) for g in f.groups())

first = need(r"Not over \$([\d,]+) (\d+(?:\.\d+)?)% of T")
rows = [[0, 0, Fraction(first.group(2))]]
tops = [dollars(first.group(1))]
for over, base, rate, excess in re.findall(
    r"\$([\d,]+) (?:\$[\d,]+ )?\$([\d,]+) \+ \((\d+(?:\.\d+)?)% of excess over \$([\d,]+)\)", plain
):
    assert over == excess, (over, excess)
    rows.append([dollars(over), dollars(base), Fraction(rate)])
assert len(rows) == 4, rows
assert rows[1][0] == tops[0], (rows, tops)
assert [r[2] for r in rows] == [2, 3, 5, Fraction("5.75")], rows
for lo, hi in zip(rows, rows[1:]):
    assert hi[0] > lo[0], rows
    assert lo[1] + (hi[0] - lo[0]) * lo[2] / 100 == hi[1], ("base does not follow", lo, hi)


def annual_tax(T):
    for over, base, rate in reversed(rows):
        if T > over:
            return base + (T - over) * rate / 100
    return Fraction(0)


periods = {k.lower(): int(v) for k, v in re.findall(
    r"\b(Annual|Semiannual|Quarterly|Monthly|Semi-monthly|Bi-weekly|Weekly|Daily) =? ?(\d+)\b", layout)}
assert periods == {"annual": 1, "semiannual": 2, "quarterly": 4, "monthly": 12,
                   "semi-monthly": 24, "bi-weekly": 26, "weekly": 52, "daily": 300}, periods

# Worked example.
ex = need(r"\(\$([\d,]+)\)(\d+) - \[\$([\d,]+) \+ \(\$([\d,]+)\)(\d+)\] = T")
G, EP, ex_std, ex_e1, n = (dollars(g) for g in ex.groups())
assert (ex_std, ex_e1) == (std, e1), ex.groups()
ex_T = dollars(need(r"\$[\d,]+ - \$[\d,]+ = \$([\d,]+) 2\. T is").group(1))
ex_W = dollars(need(r"= \$([\d,]+) 3\. W ÷ P").group(1))
wh = need(r"\$([\d,]+) ÷ (\d+) = \$([\d,]+)\.(\d\d)")
T = G * EP - (std + n * e1)
W = round(annual_tax(T))
assert T == ex_T and W == ex_W == dollars(wh.group(1)) and int(wh.group(2)) == EP, (T, W, ex_T, ex_W)
ex_wh = dollars(wh.group(3)) * 100 + int(wh.group(4))
assert int(Fraction(W * 100, EP) + Fraction(1, 2)) == ex_wh, (W, EP, ex_wh)

# Every printed table cell.
TABLE_P = {"Daily": 300, "Weekly": 52, "Semi-Monthly": 24, "Biweekly": 26, "Monthly": 12}
ROW = re.compile(r"^\$?([\d,]+) ([\d,]+)((?: \d[\d,]*(?:\.\d\d)?){11})\s*$")
seen = {}
for page in reader.pages[2:]:
    text = page.extract_text()
    name = need(r"(Daily|Weekly|Semi-Monthly|Biweekly|Monthly) Payroll Period", text).group(1)
    assert eff.group(1) in text, ("table page edition differs", name)
    for line in text.splitlines():
        m = ROW.match(line.strip())
        if not m:
            continue
        lo, hi = dollars(m.group(1)), dollars(m.group(2))
        prev = seen.setdefault(name, [])
        assert hi > lo and (not prev or prev[-1][1] == lo), (name, line)
        prev.append((lo, hi))
        P = TABLE_P[name]
        for k, cell in enumerate(m.group(3).split()):
            v = annual_tax(max(0, hi * P - (std + k * e1))) / P
            want = int(v * 100 + Fraction(1, 2)) if "." in cell else int(v + Fraction(1, 2)) * 100
            got = int(cell.replace(",", "").replace(".", "")) * (1 if "." in cell else 100)
            assert got == want, (name, line, k, got, want)
assert sorted(seen) == sorted(TABLE_P), sorted(seen)
assert all(rows_[0][0] == 0 for rows_ in seen.values()), seen
cells = sum(len(v) for v in seen.values()) * 11
print(f"note: {cells} printed table cells reproduce from the formula", file=sys.stderr)

print(json.dumps({
    "title": title,
    "effectiveAfter": eff.group(1),
    "effectiveBefore": eff.group(2),
    "standardDeductionCents": std * 100,
    "personalExemptionCents": e1 * 100,
    "ageBlindExemptionCents": e2 * 100,
    "dailyPeriods": periods["daily"],
    "annualTable": [[o * 100, b * 100, int(r * 100)] for o, b, r in rows],
    "example": {"grossCents": G * 100, "periods": EP, "personalExemptions": n,
                "TCents": ex_T * 100, "WCents": ex_W * 100, "withholdingCents": ex_wh},
    "tableCellsChecked": cells,
}))
