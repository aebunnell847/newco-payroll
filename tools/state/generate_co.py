"""Regenerate Colorado's 2027 withholding figures in src/regulatory/state/co.js.

Reads the Colorado DOR's "2027 Colorado Withholding Worksheet for Employers"
(DR 1098) PDF and prints, as JSON, the edition marker, the line 1d W-4
allowances, the pay-period table and the six-row Withholding Table as
[atLeastCents, subtractCents, baseCents, rateBasisPoints] rows. Never
hand-typed.

Optionally also reads the Department's own electronic worksheet, the
"DR 1098 Withholding Calculator" (.xlsx), and:
  - checks its Withholding Table cells equal the PDF's;
  - prints its Step 2 formulas, which choose the row with
    `line 1e < next row's Column B` and subtract the PREVIOUS row's
    Column C ("not more than") - $25,000, not Column B's $25,001 that the
    PDF's line 2b text names. subtractCents follows the calculator, and
    the script asserts each row's Column D is the row below's D plus
    (C - previous C) x E, which only holds with that choice;
  - evaluates the calculator's own cell formulas (a small parser for the
    IF/OR/comparison/arithmetic it uses, in exact fractions) on a fixed set
    of inputs, and prints the results as test vectors for test/colorado2027.test.js.

    pip install pypdf==5.1.0 openpyxl==3.1.5
    curl -O https://tax.colorado.gov/sites/default/files/2026-11/DR_1098_2027.pdf
    curl -O https://tax.colorado.gov/sites/default/files/2026-11/DR_1098_Withholding_Calculator_Nov_2026_Revision_for_2027.xlsx
    python generate_co.py DR_1098_2027.pdf DR_1098_Withholding_Calculator_Nov_2026_Revision_for_2027.xlsx > co.json
"""
import json
import operator
import re
import sys
from fractions import Fraction

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages)
flat = re.sub(r"\s+", " ", text)

edition = re.search(r"DR 1098 \((\d\d/\d\d/\d\d)\)", text)
assert edition, "no DR 1098 edition marker"
year = re.search(r"(\d{4}) Colorado Withholding Worksheet for Employers", text)
assert year and year.group(1) == "2027", "not the 2027 worksheet"
# The worksheet prints no effective date, only the tax year.
assert not re.search(r"effective|on or after", flat, re.I), "an effective date appeared; key by it"


def cents(s):
    s = s.replace("$", "").replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


line1d = re.search(
    r"\$([\d,]+) if married filing jointly or qualifying surviving spouse; "
    r"\$([\d,]+) if single or married filing separately; or \$([\d,]+) if head of household",
    flat,
)
assert line1d, "line 1d allowances not found"
allowances = {
    "marriedFilingJointly": cents(line1d.group(1)),
    "single": cents(line1d.group(2)),
    "headOfHousehold": cents(line1d.group(3)),
}

periods = re.search(r"Annually Semiannually Quarterly Monthly Semimonthly Biweekly Weekly Daily\s+([\d ]+)\n", text)
assert periods, "no pay period table"
period_counts = [int(x) for x in periods.group(1).split()]
assert period_counts == [1, 2, 4, 12, 24, 26, 52, 260], period_counts

ROW = re.compile(r"^(\d) \$([\d,]+) (\$[\d,]+|N/A) \$([\d,]+) (0\.\d+)$", re.M)
raw = ROW.findall(text)
assert [int(r[0]) for r in raw] == [1, 2, 3, 4, 5, 6], raw
pdf_table = []  # [atLeast, notMoreThan or None, base, rate as Fraction], dollars
for _, b, c, d, e in raw:
    pdf_table.append([int(b.replace(",", "")), None if c == "N/A" else int(c[1:].replace(",", "")), int(d.replace(",", "")), Fraction(e)])
assert pdf_table[-1][1] is None and all(r[1] is not None for r in pdf_table[:-1])
assert pdf_table[0][0] == 0 and pdf_table[0][2] == 0

rows = []
for i, (at_least, not_more, base, rate) in enumerate(pdf_table):
    if i:
        prev = pdf_table[i - 1]
        assert at_least == prev[1] + 1, ("Column B is not the previous Column C + $1", i + 1)
        prev_sub = 0 if i == 1 else pdf_table[i - 2][1]
        assert base == prev[2] + (prev[1] - prev_sub) * prev[3], ("Column D does not follow from the row below", i + 1)
        assert rate > prev[3], "rates must ascend"
    subtract = 0 if i == 0 else pdf_table[i - 1][1]
    bp = rate * 10_000
    assert bp.denominator == 1, rate
    rows.append([at_least * 100, subtract * 100, base * 100, int(bp)])
assert [r[3] for r in rows] == [370, 420, 440, 740, 790, 840], rows
print(
    "note: DR 1098 line 2b says subtract Column B ($25,001 ...); this subtracts the previous row's Column C "
    "($25,000 ...), as the Department's calculator does and as Column D requires.",
    file=sys.stderr,
)

out = {
    "edition": edition.group(1),
    "taxYear": 2027,
    "allowancesCents": allowances,
    "payPeriods": period_counts,
    "rows": rows,
}


# ---- the Department's calculator (.xlsx) --------------------------------

TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?)|(\"[^\"]*\")|([A-Z]+\d+)|([A-Z]+)\(|(<=|>=|<>|[-+*/(),<>=]))")


def parse(formula):
    """Excel formula -> AST, for the small subset the calculator uses."""
    src = formula.lstrip("=")
    toks, pos = [], 0
    while pos < len(src):
        m = TOKEN.match(src, pos)
        assert m and m.end() > pos, ("unsupported formula syntax", src[pos:])
        num, s, ref, fn, op = m.groups()
        toks.append(("num", Fraction(num)) if num else ("str", s[1:-1]) if s else ("ref", ref) if ref else ("fn", fn) if fn else ("op", op))
        pos = m.end()
    i = 0

    def peek():
        return toks[i] if i < len(toks) else (None, None)

    def take(kind=None, val=None):
        nonlocal i
        t = toks[i]
        assert (kind is None or t[0] == kind) and (val is None or t[1] == val), (t, kind, val)
        i += 1
        return t

    def comparison():
        left = additive()
        while peek()[0] == "op" and peek()[1] in ("<", ">", "=", "<=", ">=", "<>"):
            left = ("cmp", take()[1], left, additive())
        return left

    def additive():
        left = term()
        while peek() in (("op", "+"), ("op", "-")):
            left = ("bin", take()[1], left, term())
        return left

    def term():
        left = atom()
        while peek() in (("op", "*"), ("op", "/")):
            left = ("bin", take()[1], left, atom())
        return left

    def atom():
        kind, val = take()
        if kind in ("num", "str", "ref"):
            return (kind, val)
        if kind == "fn":
            assert val in ("IF", "OR"), val
            args = [comparison()]
            while peek() == ("op", ","):
                take()
                args.append(comparison())
            take("op", ")")
            return ("fn", val, args)
        if (kind, val) == ("op", "("):
            e = comparison()
            take("op", ")")
            return e
        if (kind, val) == ("op", "-"):
            return ("bin", "-", ("num", Fraction(0)), atom())
        raise AssertionError((kind, val))

    ast = comparison()
    assert i == len(toks), ("trailing tokens", toks[i:])
    return ast


CMP = {"<": operator.lt, ">": operator.gt, "=": operator.eq, "<=": operator.le, ">=": operator.ge, "<>": operator.ne}
ARITH = {"+": operator.add, "-": operator.sub, "*": operator.mul, "/": operator.truediv}


def evaluate(cells, ref):
    v = cells.get(ref)
    if isinstance(v, str) and v.startswith("="):
        return ev(cells, parse(v))
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return Fraction(str(v))
    return v


def ev(cells, n):
    k = n[0]
    if k in ("num", "str"):
        return n[1]
    if k == "ref":
        return evaluate(cells, n[1])
    if k == "fn":
        if n[1] == "IF":
            return ev(cells, n[2][1]) if ev(cells, n[2][0]) else ev(cells, n[2][2])
        return any(ev(cells, a) for a in n[2])
    if k == "cmp":
        a, b = ev(cells, n[2]), ev(cells, n[3])
        if isinstance(a, str) != isinstance(b, str):
            # Excel: any text compares greater than any number; "" = number is false.
            if n[1] in ("=", "<>"):
                return n[1] == "<>"
            return (n[1] in (">", ">=")) == isinstance(a, str)
        return CMP[n[1]](a, b)
    if k == "bin":
        a, b = ev(cells, n[2]), ev(cells, n[3])
        assert not isinstance(a, str) and not isinstance(b, str), ("text in arithmetic", n)
        return ARITH[n[1]](a, b)
    raise AssertionError(n)


# Inputs: wages per period (cents), periods, line 1d allowance (cents),
# line 3a credit allowance (cents), line 3d additional withholding (cents).
VECTOR_INPUTS = [
    (2_000_00, 26, 5_500_00, 0, 0),  # single W-4 / no certificate, bracket 2
    (2_000_00, 26, 11_000_00, 0, 0),  # MFJ W-4, bracket 2
    (2_000_00, 26, 8_500_00, 0, 0),  # HOH W-4, bracket 2
    (500_00, 52, 5_500_00, 0, 0),  # bracket 1
    (100_00, 52, 5_500_00, 0, 0),  # 1e = 0
    (2_500_00, 12, 5_500_00, 0, 0),  # 1e = $24,500, bracket 1
    (2_542_00, 12, 5_500_00, 0, 0),  # 1e = $25,004, bracket 2 just over the edge
    (30_500_50, 1, 5_500_00, 0, 0),  # 1e = $25,000.50: the calculator keeps bracket 1 below $25,001
    (10_000_00, 24, 11_000_00, 1_200_00, 25_00),  # bracket 3, credit and extra
    (25_000_00, 24, 5_500_00, 0, 0),  # 1e = $594,500, bracket 4
    (70_000_00, 12, 8_500_00, 0, 0),  # bracket 5
    (60_000_00, 26, 0, 0, 0),  # DR 0004 line 2 = 0, bracket 6
    (400_00, 260, 5_500_00, 0, 0),  # daily, bracket 3
    (30_000_00, 4, 11_000_00, 0, 10_00),  # quarterly, bracket 3
    (60_000_00, 2, 5_500_00, 0, 0),  # semiannual, bracket 3
    (300_000_00, 1, 5_500_00, 2_000_00, 0),  # annual, bracket 3
    (1_500_00, 26, 14_500_00, 1_800_00, 0),  # credit wipes out tentative withholding
]

if len(sys.argv) > 2:
    import openpyxl

    ws = openpyxl.load_workbook(sys.argv[2], data_only=False).worksheets[0]
    cells = {c.coordinate: c.value for row in ws.iter_rows() for c in row if c.value is not None}
    assert "2027" in str(cells.get("A1")), cells.get("A1")
    xl_table = [[cells[f"C{r}"], cells[f"E{r}"], cells[f"G{r}"], Fraction(str(cells[f"J{r}"]))] for r in range(31, 37)]
    for xl, pdf in zip(xl_table, pdf_table):
        assert xl[0] == pdf[0] and xl[2] == pdf[2] and xl[3] == pdf[3], (xl, pdf)
        assert xl[1] == (pdf[1] if pdf[1] is not None else "N/A"), (xl, pdf)
    formulas = {k: cells[k] for k in ("J6", "J8", "J11", "J12", "J13", "J14", "J18", "J19", "J21")}
    # The row-selection and subtrahend the calculator uses (see the docstring).
    assert re.sub(r"\s", "", formulas["J12"]) == "=IF(J11=\"\",\"\",J8-(IF(J8<C32,C31,IF(J8<C33,E31,IF(J8<C34,E32,IF(J8<C35,E33,IF(J8<C36,E34,E35)))))))", formulas["J12"]
    vectors = []
    for wages, n, allowance, credit, extra in VECTOR_INPUTS:
        c = dict(cells)
        c.update({"J4": Fraction(wages, 100), "J5": Fraction(n), "J7": Fraction(allowance, 100), "J17": Fraction(credit, 100), "J20": Fraction(extra, 100)})
        got = {k: evaluate(c, k) for k in ("J8", "J11", "J12", "J13", "J14", "J18", "J19", "J21")}
        assert all(isinstance(v, Fraction) for v in got.values()), got
        exact_cents = got["J21"] * 100
        assert exact_cents - exact_cents // 1 != Fraction(1, 2), ("on a half cent; pick another input", wages)
        vectors.append({
            "wagesCents": wages, "payPeriodsPerYear": n, "line1dCents": allowance,
            "line3aCents": credit, "line3dCents": extra,
            "line1eCents": int(got["J8"] * 100),
            "line2Cents": float(got["J14"] * 100),
            "line3eExact": str(got["J21"]),
            "line3eCents": int((exact_cents + Fraction(1, 2)) // 1),  # half-up; none fall on a half cent
        })
    out["calculator"] = {"title": cells["A1"].replace("\n", " "), "formulas": formulas, "vectors": vectors}

print(json.dumps(out, indent=1))
