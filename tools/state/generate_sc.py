"""Regenerate a South Carolina tax year's constants in src/regulatory/state/sc.js.

Reads SCDOR's WH-1603F ("Formula for Computing South Carolina <year>
Withholding Tax") and prints the TABLES entry as JSON:
{"taxYear", "revision", "allowanceCents", "standardDeductionRateBp",
 "standardDeductionCapCents", "annualTable": [[overCents, baseCents, rateBp], ...]}.
It asserts the formula's own arithmetic: the addition-method base equals
the first rate on the first bracket, the subtraction-method constant
matches it, and the sheet's worked example reproduces to the cent.

Given the WH-1603 wage-bracket tables PDF as well, it re-derives every
printed cell (daily, weekly, bi-weekly, semi-monthly, monthly; 0-10
allowances) from those constants - the bracket midpoint annualized,
per-period withholding rounded up to the next whole dollar - and fails on
any mismatch. It
also checks each table's "over" footer rate against the formula's top rate.

Uses poppler's pdftotext (ships with Git for Windows; pypdf's layout mode
loses the rotated wage-bracket tables).

    curl -O https://dor.sc.gov/sites/dor/files/forms/WH1603F_2027.pdf
    curl -O https://dor.sc.gov/sites/dor/files/forms/WH1603_2027.pdf
    python -I generate_sc.py WH1603F_2027.pdf WH1603_2027.pdf > sc.json
"""
import json
import re
import subprocess
import sys
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

sys.stdout.reconfigure(encoding="utf-8")


def text_of(path):
    return subprocess.run(["pdftotext", "-layout", path, "-"], check=True, capture_output=True, text=True, encoding="utf-8").stdout


def cents(s):
    return int((Decimal(s.replace(",", "").replace("$", "")) * 100).to_integral_value())


def bp(pct):
    return int((Decimal(pct) * 100).to_integral_value())


def one(pattern, text, flags=re.S):
    m = re.search(pattern, text, flags)
    assert m, f"not found: {pattern}"
    return m


notes = []
f = text_of(sys.argv[1])
assert "WH-1603F" in f, "not a WH-1603F"
year = int(one(r"FORMULA FOR COMPUTING SOUTH CAROLINA\s+(\d{4}) WITHHOLDING TAX", f).group(1))
revision = one(r"\(Rev\. (\d+/\d+/\d+)\)", f).group(1)

allowance = cents(one(r"\$([\d,]+) per personal allowance claimed", f).group(1))
assert re.search(r"Personal Allowance.{0,200}?\$0 if zero allowances claimed OR", f, re.S), "allowance wording changed"
sciad_pct = one(r"(\d+)% of gross wages if claiming one or more", f).group(1)
sciad_cap = cents(one(r"allowances, up to \$([\d,]+) total", f).group(1))
assert re.search(r"SCIAD.{0,200}?\$0 if zero allowances claimed OR", f, re.S), "SCIAD wording changed"

# Subtraction method: two brackets, "<low>%" then "<high>%, then subtract $X".
m = one(r"SUBTRACTION METHOD:.*?\$0\s+\$([\d,]+)\s+(\d+\.\d+)%.*?\$([\d,]+)\s+and above\s+(\d+\.\d+)%, then subtract \$([\d,.]+)", f)
edge, low, edge2, high, subtract = cents(m.group(1)), bp(m.group(2)), cents(m.group(3)), bp(m.group(4)), cents(m.group(5))
assert edge == edge2, (edge, edge2)
# Addition method: same edge and rates, "Subtract $E, multiply by H%, then add $B".
m = one(r"ADDITION METHOD:.*?\$0\s+\$([\d,]+)\s+(\d+\.\d+)%.*?Subtract \$([\d,]+), multiply by (\d+\.\d+)%, then add \$([\d,.]+)", f)
assert (cents(m.group(1)), bp(m.group(2)), cents(m.group(3)), bp(m.group(4))) == (edge, low, edge, high), m.groups()
base = cents(m.group(5))
assert base * 10_000 == edge * low, ("addition base != edge x low rate", base, edge, low)
assert subtract * 10_000 == edge * (high - low), ("subtraction constant inconsistent", subtract)
annual_table = [[0, 0, low], [edge, base, high]]

# Constants table, yearly column.
m = one(r"Amount per allowance\s+\(A\)\s+\$([\d,]+)", f)
assert cents(m.group(1)) == allowance
m = one(r"\(C\)\s+\$([\d,]+)", f)
assert cents(m.group(1)) == sciad_cap


def annual_tax(taxable_cents):
    """Exact (unrounded) annual tax in cents, as a Decimal."""
    over, b, rate = annual_table[1] if taxable_cents >= edge else annual_table[0]
    return Decimal(b) + Decimal(taxable_cents - over) * rate / 10_000


def taxable(annual_cents, allowances):
    sciad = 0 if allowances == 0 else min(sciad_cap, (annual_cents * int(sciad_pct) + 50) // 100)
    return max(0, annual_cents - allowances * allowance - sciad)


# Worked example: "$1,000 per week, 3 allowances" ... "$29.81 STATE TAX PER WEEK".
m = one(r"Annualize salary: \$([\d,]+)\s+per week, (\d+) allowances", f)
ex_wage, ex_allow = cents(m.group(1)), int(m.group(2))
ex_taxable = cents(one(r"\$([\d,]+\.\d\d)\s+taxable income", f).group(1))
# Both methods' examples end "- $<subtract>  $<total>" / "+ $<base>  $<total>".
ex_total = cents(one(r"-\s*\$[\d,.]+\s+\$([\d,]+\.\d\d)\s+ADDITION METHOD", f).group(1))
assert cents(one(r"\+\s*\$[\d,.]+\s+\$([\d,]+\.\d\d)\s+IV\.", f).group(1)) == ex_total
ex_weekly = cents(one(r"= \$([\d.]+) STATE TAX PER WEEK", f).group(1))
assert taxable(ex_wage * 52, ex_allow) == ex_taxable, (taxable(ex_wage * 52, ex_allow), ex_taxable)
got = annual_tax(ex_taxable).quantize(Decimal(1), ROUND_HALF_UP)
assert got == ex_total, (got, ex_total)
assert (Decimal(ex_total) / 52).quantize(Decimal(1), ROUND_HALF_UP) == ex_weekly

out = {
    "taxYear": year,
    "revision": revision,
    "allowanceCents": allowance,
    "standardDeductionRateBp": int(sciad_pct) * 100,
    "standardDeductionCapCents": sciad_cap,
    "annualTable": annual_table,
    "workedExample": {"weeklyWagesCents": ex_wage, "allowances": ex_allow, "taxableAnnualCents": ex_taxable,
                      "annualTaxCents": ex_total, "weeklyCents": ex_weekly},
}

if len(sys.argv) > 2:
    t = text_of(sys.argv[2])
    assert "WH-1603" in t and f"{year} DAILY TABLE" in t, "not the matching WH-1603"
    out["tablesRevision"] = one(r"\(Rev\. (\d+/\d+/\d+)\)", t).group(1)
    periods = {"DAILY": 260, "WEEKLY": 52, "BI-WEEKLY": 26, "SEMI-MONTHLY": 24, "MONTHLY": 12}
    pages = t.split("\f")
    checked, by_period = 0, {}
    for page in pages:
        h = re.search(rf"{year} (DAILY|WEEKLY|BI-WEEKLY|SEMI-MONTHLY|MONTHLY) TABLE", page)
        if not h:
            continue
        name, n = h.group(1), periods[h.group(1)]
        foot = one(r"plus (\d+(?:\.\d+)?)% of excess over \$([\d,]+)\.", page)
        rate_txt = foot.group(1)
        if rate_txt == "521":
            # WH-1603 prints "521%" in the daily table footer; the formula's
            # rate (and every other table) is 5.21%.
            notes.append(f"{name} table footer prints '{rate_txt}%'; normalized to 5.21% (WH-1603F top rate)")
            rate_txt = "5.21"
        assert bp(rate_txt) == high, (name, rate_txt)
        rows = []
        for line in page.splitlines():
            nums = re.findall(r"(?<![\w.$,])\d[\d,]*(?![\w.%,])", line)
            if re.search(r"\bAt\b|least|than|Allowances", line):
                continue  # column headings
            if "excess over" in line:
                # The last row shares its line with the "<top> over" footer.
                assert len(nums) == 14, (name, line)
                nums = nums[:13]
            if len(nums) == 26:
                rows += [nums[:13], nums[13:]]
            elif len(nums) == 13:
                rows.append(nums)
            elif nums and not re.search(r"Rev\.|dor\.sc\.gov|1350|WH-1603|\d{4} \w", line) and len(nums) > 2:
                raise AssertionError((name, line))
        rows = sorted(([int(x.replace(",", "")) for x in r] for r in rows), key=lambda r: r[0])
        assert rows[0][0] == 0 and all(a[1] == b[0] for a, b in zip(rows, rows[1:])), (name, "brackets not contiguous")
        assert rows[-1][1] == int(foot.group(2).replace(",", "")), (name, rows[-1], foot.group(2))
        for lo, hi, *printed in rows:
            assert len(printed) == 11
            mid = (lo + hi) * 100 // 2
            for k, want in enumerate(printed):
                tax = annual_tax(taxable(mid * n, k)) / n
                # The tables round any part of a dollar up (a $0.20 tax
                # prints as $1); every cell matches that, none matches
                # round-half-up.
                have = int((tax / 100).to_integral_value(ROUND_CEILING))
                assert have == want, (name, lo, hi, k, want, have)
                checked += 1
        by_period[name] = len(rows)
    assert sorted(by_period) == sorted(periods), by_period
    out["tableCellsReproduced"] = checked
    out["tableRows"] = by_period

for note in notes:
    print("note:", note, file=sys.stderr)
print(json.dumps(out, indent=1))
