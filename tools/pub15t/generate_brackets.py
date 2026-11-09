"""Regenerate the Pub 15-T bracket tables in src/regulatory/federalWithholding.js.

Reads the IRS's own documents and prints the brackets as JSON
({year: {status: {standard, step2Checkbox}}}, each row
{overCents, baseCents, rateBp}), so the tables are never hand-typed.

    pip install pypdf==5.1.0
    curl -o p15t.html https://www.irs.gov/publications/p15t            # 2026 edition
    curl -o p15t-2025.pdf https://www.irs.gov/pub/irs-prior/p15t--2025.pdf
    python generate_brackets.py p15t.html p15t-2025.pdf > brackets.json

Compare its output with the arrays in federalWithholding.js; for a new
year, point it at that year's edition and add the year to the code.
"""
import sys, re, json
from html.parser import HTMLParser
import sys, re
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.tables=[]; s.depth=0; s.row=None; s.cell=None; s.text=[]; s.cap=None
    def handle_starttag(s,t,a):
        if t=='table': s.depth+=1; s.tables.append([]) if s.depth==1 else None
        elif s.depth==1 and t=='tr': s.row=[]
        elif s.depth==1 and t in('td','th'): s.cell=[]
        elif t=='br' and s.cell is not None: s.cell.append(' ')
    def handle_endtag(s,t):
        if t=='table': s.depth-=1
        elif s.depth==1 and t in('td','th') and s.cell is not None: s.row.append(re.sub(r'\s+',' ',''.join(s.cell)).strip()); s.cell=None
        elif s.depth==1 and t=='tr' and s.row is not None: s.tables[-1].append(s.row); s.row=None
    def handle_data(s,d):
        if s.cell is not None: s.cell.append(d)
from pypdf import PdfReader

def cents(s):
    s = s.replace('$', '').replace(',', '').strip()
    if not s: return None
    d, _, c = s.partition('.')
    return int(d) * 100 + int((c + '00')[:2])

def pct_bp(s):
    return int(round(float(s.replace('%', '')) * 100))

def rows_to_sched(rows):
    """rows: list of 10-cell rows [A,B,C,D,E, A,B,C,D,E] -> (standard, checkbox)"""
    std, chk = [], []
    for r in rows:
        for out, cells in ((std, r[:5]), (chk, r[5:])):
            a, b, c, d, e = cells
            assert cents(a) == cents(e), (a, e)
            out.append({"overCents": cents(a), "baseCents": cents(c), "rateBp": pct_bp(d)})
    return std, chk

STATUSES = ["marriedFilingJointly", "single", "headOfHousehold"]

# ---- 2026 from the HTML edition
p = P(); p.feed(open(sys.argv[1], encoding='utf-8').read())
t = next(t for t in p.tables if any('Married Filing Jointly' in ' '.join(r) for r in t) and any('2026 Percentage Method Tables' in ' '.join(r) for r in t))
groups, cur = [], None
for r in t:
    joined = ' '.join(r)
    if r and r[0] in ('Married Filing Jointly', 'Single or Married Filing Separately', 'Head of Household'):
        cur = []; groups.append(cur); continue
    if cur is not None and len(r) == 10 and r[0].startswith('$'):
        cur.append(r)
y2026 = {}
for st, g in zip(STATUSES, groups):
    y2026[st] = dict(zip(("standard", "step2Checkbox"), rows_to_sched(g)))

# ---- 2025 from the PDF edition
reader = PdfReader(sys.argv[2])
page = next(pg.extract_text() for pg in reader.pages if '2025 Percentage Method Tables for Automated' in (pg.extract_text() or '') and 'Married Filing Jointly' in (pg.extract_text() or ''))
groups, cur = [], None
for line in page.splitlines():
    line = line.strip()
    if line.startswith(('Married Filing Jointly', 'Single or Married Filing Separately', 'Head of Household')):
        cur = []; groups.append(cur); continue
    if cur is not None and line.startswith('$'):
        toks = line.split()
        # top bracket rows have no "But less than" cell: 8 tokens -> insert blanks
        if len(toks) == 8:
            toks = toks[:1] + [''] + toks[1:5] + [''] + toks[5:]
        assert len(toks) == 10, line
        cur.append(toks)
y2025 = {}
for st, g in zip(STATUSES, groups):
    y2025[st] = dict(zip(("standard", "step2Checkbox"), rows_to_sched(g)))

for y in (y2025, y2026):
    for st in STATUSES:
        for k in ("standard", "step2Checkbox"):
            assert len(y[st][k]) == 8, (st, k, len(y[st][k]))
print(json.dumps({"2025": y2025, "2026": y2026}))
