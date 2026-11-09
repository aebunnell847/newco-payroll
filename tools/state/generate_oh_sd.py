"""Regenerate Ohio's school district income tax table in src/regulatory/state/oh.js.

Reads the Department of Taxation's "School District Income Tax Rates" list
(SDIT list, pages 2+: county, school district number, IRN, district,
rate, "(b)" for earned-income-only districts, first year effective) and
prints JSON: {"asOf": ..., "districts": {sdNumber: {name, rateBp,
earnedIncomeOnly}}}. Never hand-typed.

    pip install pypdf==5.1.0
    curl -o sdit_list.pdf https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/tax_analysis/tax_data_series/school_district_data/sdit_list.pdf
    python generate_oh_sd.py sdit_list.pdf > oh_sd.json
"""
import json
import re
import sys

from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
pages = [p.extract_text() for p in PdfReader(sys.argv[1]).pages]
text = "\n".join(pages[1:])  # page 1 is the summary of changes
as_of = re.search(r"Ohio Department of Taxation\s+([A-Z][a-z]+ \d+, \d{4})", text)
total = re.search(r"Total number of districts are (\d+)", text)
earned = re.search(r"Taxes based on earned income only; (\d+) districts", text)
assert as_of and total and earned, "unexpected list layout"

ROW = re.compile(r"^(?:[A-Za-z .()]+?)\s(\d{4})\s(\d{5})\s(.+?)\s(\d+\.\d\d)\s%(\s\(b\))?\s(\d{4})$")
districts = {}
pending = ""
for raw in text.splitlines():
    line = (pending + " " + raw.strip()).strip() if pending else raw.strip()
    m = ROW.match(line)
    if m:
        sd, irn, name, rate, b, first = m.groups()
        assert sd not in districts, ("duplicate", sd)
        districts[sd] = {"name": re.sub(r"\s+", " ", name), "rateBp": round(float(rate) * 100), "earnedIncomeOnly": bool(b)}
        pending = ""
    elif re.match(r"^[A-Za-z .()]+\s\d{4}\s\d{5}\b", line) and not re.search(r"%\s*(\(b\))?\s*\d{4}$", line):
        pending = line  # a district name wrapped onto the next line
    else:
        pending = ""

assert len(districts) == int(total.group(1)), (len(districts), total.group(1))
assert sum(d["earnedIncomeOnly"] for d in districts.values()) == int(earned.group(1))
assert all(0 < d["rateBp"] <= 300 for d in districts.values())
print(json.dumps({"asOf": as_of.group(1), "districts": dict(sorted(districts.items()))}))
