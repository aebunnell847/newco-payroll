"""Regenerate Indiana's county income tax rates in src/regulatory/state/in.js.

Reads the Department of Revenue's Departmental Notice #1 ("How to Compute
Withholding for State and County Income Tax") and prints the county table as
JSON: {"effective": "...", "stateRate": "...", "counties": {code: {name,
rate, changedSinceJan1}}}. The rates are never hand-typed.

    pip install pypdf==5.1.0
    curl -O https://www.in.gov/dor/files/dn01.pdf
    python generate_in_counties.py dn01.pdf > in_counties.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
text = "\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages)

eff = re.search(r"Departmental Notice #1\s+Effective (\w+\.? \d+, \d{4})", text)
assert eff, "no effective date found"
state = re.search(r"the state adjusted gross income tax rate for individuals is (\d+\.\d+)%", text)
assert state, "no state rate found"

ROW = re.compile(r"^([A-Z][A-Za-z.]*(?: [A-Z][A-Za-z.]*)?) (\d{2}) (0\.\d+)(\*?)\s*$")
counties = {}
for line in text.splitlines():
    m = ROW.match(line.strip())
    if not m:
        continue
    name, code, rate, star = m.groups()
    assert code not in counties, ("duplicate county code", code)
    counties[code] = {"name": name, "rate": rate, "changedSinceJan1": star == "*"}

# Indiana has 92 counties, coded 01-92 alphabetically.
assert sorted(counties) == [f"{i:02d}" for i in range(1, 93)], sorted(counties)
for c in counties.values():
    assert 0 < float(c["rate"]) < 0.05, c

print(json.dumps({"effective": eff.group(1), "stateRatePercent": state.group(1), "counties": counties}, indent=1))
