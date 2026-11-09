"""Regenerate Maryland's percentage-method tables in src/regulatory/state/md.js.

Maryland withholds state and local (county) income tax together. The
Comptroller publishes one "Percentage method of withholding for X.XX PERCENT
LOCAL INCOME TAX" PDF per local rate (pm225.pdf ... pm330.pdf); each has the
per-period exemption and standard-deduction amounts, a "do not withhold on
gross wages less than" floor, and two tables per payroll period - (a)
married filing joint / head of household and (b) single / married filing
separately - whose rates already combine the 4.75%+ state rates and the
local rate.

This reads every pmNNN.pdf given and prints JSON:
{ "NNN": { "localRateBp": n, "periods": { period: { "exemptionCents",
  "standardDeductionCents", "floorCents", "joint": [[overCents, baseCents,
  rateBp], ...], "single": [...] } } } }
Never hand-typed.

    pip install pypdf==5.1.0
    for r in 225 240 265 275 300 305 310 320 330; do
      curl -O https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/instructions/withholding/2026/pm$r.pdf
    done
    python generate_md.py pm*.pdf > md.json
"""
import json
import pathlib
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")

PERIODS = {"Daily": "daily", "Weekly": "weekly", "Bi-Weekly": "biweekly", "Semi-Monthly": "semimonthly",
           "Monthly": "monthly", "Quarterly": "quarterly", "Annual": "annual"}
HEADER_ROW = {"Weekly": "weekly", "Bi-weekly": "biweekly", "Semi-monthly": "semimonthly", "Monthly": "monthly",
              "Quarterly": "quarterly", "Annually": "annual", "Daily": "daily"}
NUM = r"[\d,]+(?:\.\d\d)?"
# Maryland's marginal state rates from 4.75% up (the tables leave out the rates
# under 4.75%, as the Comptroller says the withholding schedules do).
STATE_MARGINAL_BP = (475, 500, 525, 550, 575, 625, 650)
FIRST = re.compile(rf"\$ ?0 \$ ?({NUM}) (\d+\.\d\d)% \$ ?0 \$ ?({NUM}) (\d+\.\d\d)%")
# The top row's upper bound prints as "$ --", "--", "$ ---" or not at all
# (pm300: "$ 19,231 $ 1,700.74 plus 9.50% ...").
ROW = re.compile(rf"\$ ({NUM}) (?:(?:\$ ({NUM})|(?:\$ ?)?-+) )?(?:\$ )?({NUM}) plus (\d+\.\d\d)% \$ ?({NUM})")


def cents(s):
    s = s.replace(",", "")
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def bp(s):
    return round(float(s) * 100)


out = {}
for arg in sys.argv[1:]:
    code = re.search(r"pm(\d{3})", pathlib.Path(arg).name).group(1)
    text = "\n".join(
        re.sub(r"[ \t]+", " ", p.extract_text(extraction_mode="layout")) for p in PdfReader(arg).pages
    )
    rate = re.search(r"(\d\.\d\d) PERCENT LOCAL INCOME TAX", text)
    assert rate and round(float(rate.group(1)) * 100) == int(code), (arg, rate)
    periods = {}
    for label, key in HEADER_ROW.items():
        m = re.search(rf"^\s*{label} \$ ({NUM}) \$ ({NUM})", text, re.M)
        assert m, (arg, label)
        periods[key] = {"exemptionCents": cents(m.group(1)), "standardDeductionCents": cents(m.group(2))}
    current = None
    upper = {}  # each status's previous row "but not over", per period
    for line in text.splitlines():
        # "Withholding - Weekly payroll period" (most files) or "Withholding Weekly Period" (pm240)
        m = re.search(r"Withholding\s*-?\s*(Daily|Weekly|Bi-Weekly|Semi-Monthly|Monthly|Quarterly|Annual)\s+(?:payroll\s+)?period", line, re.I)
        if m:
            current = PERIODS[next(k for k in PERIODS if k.lower() == m.group(1).lower())]
            periods[current].setdefault("joint", [])
            periods[current].setdefault("single", [])
            continue
        if current is None:
            continue
        f = re.search(rf"LESS THAN \$({NUM})", line)
        if f:
            periods[current]["floorCents"] = cents(f.group(1))
            continue
        m = FIRST.search(line)
        if m:
            if not periods[current]["joint"]:
                periods[current]["joint"].append([0, 0, bp(m.group(2))])
                periods[current]["single"].append([0, 0, bp(m.group(4))])
                upper[current] = {"joint": cents(m.group(1)), "single": cents(m.group(3))}
            continue
        rows = ROW.findall(line)
        if rows:
            assert len(rows) == 2, (arg, current, line)
            for status, (over, top, base, r, excess) in zip(("joint", "single"), rows):
                edge = cents(over)
                if cents(over) != cents(excess):
                    # Print defect: the row start and its "of excess over" disagree
                    # (several in pm225/pm240). The previous row's "but not over"
                    # decides which one is right; the bracket-chain check below
                    # then proves the base belongs to it.
                    prev = upper[current][status]
                    assert prev in (cents(over), cents(excess)), (arg, current, status, line)
                    edge = prev
                    print(f"note: pm{code} {current} {status}: row prints {over} and 'of excess over "
                          f"{excess}'; the row above ends at {prev / 100:,.0f}, so {prev / 100:,.0f} is used",
                          file=sys.stderr)
                upper[current][status] = cents(top) if top else None
                if [edge, cents(base), bp(r)] not in periods[current][status]:
                    periods[current][status].append([edge, cents(base), bp(r)])
    for key, p in periods.items():
        assert "floorCents" in p, (arg, key)
        for status in ("joint", "single"):
            rows = p[status]
            assert len(rows) == 7, (arg, key, status, rows)
            assert all(rows[i][0] < rows[i + 1][0] for i in range(6)), (arg, key, status)
            # Every rate is the local rate plus Maryland's marginal state rates
            # (4.75% ... 6.50%); a printed rate that isn't is a print defect
            # (pm275 monthly joint prints 8.25% twice where the second is 8.50%).
            for i, state_bp in enumerate(STATE_MARGINAL_BP):
                if rows[i][2] != state_bp + int(code):
                    print(f"note: pm{code} {key} {status} row {i}: printed rate {rows[i][2] / 100:.2f}% should be "
                          f"{(state_bp + int(code)) / 100:.2f}% (state {state_bp / 100:.2f}% + local); corrected",
                          file=sys.stderr)
                    rows[i][2] = state_bp + int(code)
            for i in range(1, 7):
                (o0, b0, r0), (o1, b1, _) = rows[i - 1], rows[i]
                chained = b0 + (o1 - o0) * r0 / 10_000
                # Printed edges are rounded to the dollar (e.g. $2,885 for $2,884.62), so up to
                # 15 cents of difference is expected (pm265 semimonthly single, $3,539.90 vs
                # $3,539.13 from its own bracket, is beyond that).
                diff = abs(chained - b1)
                # The edges and rates are already verified, so a base that doesn't follow
                # from them (pm275 monthly single repeats the row above's $953.13) is
                # recomputed and reported, never silently kept.
                if diff > 15:
                    fixed = round(chained)
                    print(f"note: pm{code} {key} {status} row {i}: printed base {b1 / 100:,.2f} doesn't follow "
                          f"from the bracket below ({chained / 100:,.2f}); using {fixed / 100:,.2f}", file=sys.stderr)
                    rows[i][1] = fixed
    out[code] = {"localRateBp": int(code), "periods": periods}

print(json.dumps(out))
