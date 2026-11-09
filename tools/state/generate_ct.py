"""Regenerate Connecticut's withholding calculation tables in src/regulatory/state/ct.js.

Reads DRS's TPG-211 "Withholding Calculation Rules" and prints Tables A-E as
JSON, keyed by withholding code. Every table is a set of side-by-side
columns (one per code group) of [moreThan, lessThanOrEqualTo, value] rows;
columns run out at different lengths, so each row's groups are assigned to
the column whose last upper bound equals the group's lower bound. Never
hand-typed.

    pip install pypdf==5.1.0
    curl -o tpg211.pdf https://portal.ct.gov/-/media/drs/forms/2025/wth/tpg-211_1225.pdf
    python generate_ct.py tpg211.pdf > ct.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
pages = [re.sub(r"[ 	]+", " ", p.extract_text(extraction_mode="layout")) for p in PdfReader(sys.argv[1]).pages]
assert "Withholding Calculation Rules" in pages[0]
eff = re.search(r"Effective (January\s*\d+, \d{4})", pages[0])
assert eff

GROUP = re.compile(r"\$\s*([\d,]+)\s*(?:\$\s*([\d,]+)|and up)\s*(\$\s*[\d,]+|\.\s*\d+)")


def cents(s):
    return int(s.replace(",", "").replace("$", "").strip()) * 100


def parse_columns(page_text, names, start_marker):
    text = page_text[re.search(r"^\s*" + re.escape(start_marker), page_text, re.M).start():]
    cols = {n: [] for n in names}
    done = {n: False for n in names}
    for line in text.splitlines():
        groups = GROUP.findall(line)
        if not groups:
            continue
        start = 0
        for lo, hi, val in groups:
            lo_c = cents(lo)
            placed = False
            for i in range(start, len(names)):
                n = names[i]
                if done[n]:
                    continue
                last_hi = cols[n][-1][1] if cols[n] else None
                # A column starts at its first row (Table E starts above $0)
                # and otherwise continues from its last upper bound.
                if (not cols[n] and not any(cols[m] for m in names[i + 1:])) or last_hi == lo_c:
                    v = val.replace(" ", "")
                    value = round(float(v) * 100) if v.startswith(".") else cents(v)
                    cols[n].append([lo_c, cents(hi) if hi else None, value])
                    if not hi:
                        done[n] = True
                    start = i + 1
                    placed = True
                    break
            assert placed, (start_marker, line)
    for n in names:
        assert done[n], (start_marker, n, cols[n][-3:])
        rows = cols[n]
        assert all(rows[i][1] == rows[i + 1][0] for i in range(len(rows) - 1)), (start_marker, n)
    return cols


def page_with(marker):
    # The table's own heading starts a line; step text elsewhere only mentions it.
    for p in pages:
        if any(line.strip().startswith(marker) for line in p.splitlines()):
            return p
    raise AssertionError(marker)


A = parse_columns(page_with("Table A - Personal Exemptions"), ["A", "B", "C", "F"], "Table A - Personal Exemptions")
C = parse_columns(page_with("Table C - 2% Tax Rate Phase-Out Add-Back"), ["AD", "B", "C", "F"], "Table C - 2% Tax Rate")
D = parse_columns(page_with("Table D - Tax Recapture"), ["ADF", "B", "C"], "Table D - Tax Recapture")
E = parse_columns(page_with("Table E - Personal Tax Credits"), ["A", "B", "C", "F"], "Table E - Personal Tax Credits")

# Table B: "... $X ...  $base plus R% of the excess over $X", by code group.
tb = page_with("Table B - Initial Tax Calculation") if any("Table B - Initial Tax Calculation" in p for p in pages) else None
btext = "\n".join(pages)
B = {}
for code, marker in (("ADF", "Withholding Code A, D, or F\n"), ("B", "Withholding Code B\n"), ("C", "Withholding Code C\n")):
    i = btext.index(marker.strip(), btext.index("If the amount from Step 6 is") - 200)
    chunk = btext[i:].split("If the amount from Step 6 is:", 1)[1]
    rows = []
    for line in chunk.splitlines():
        line = re.sub(r"\.{2,}", " ", line)
        m = re.search(r"Less than or equal to:\s*\$\s*([\d,]+)\s+(\d+\.\d+)%", line)
        if m and not rows:
            rows.append([0, 0, round(float(m.group(2)) * 100)])
            continue
        m = re.search(r"More than \$([\d,]*\d).*?\$([\d,]*\d) plus (\d+\.\d+)% of the excess over \$([\d,]*\d)", line)
        if m:
            assert m.group(1) == m.group(4), line
            rows.append([cents(m.group(1)), cents(m.group(2)), round(float(m.group(3)) * 100)])
            if len(rows) == 7:
                break
    assert len(rows) == 7, (code, rows)
    B[code] = rows

print(json.dumps({"effective": eff.group(1), "A": A, "B": B, "C": C, "D": D, "E": E}))
