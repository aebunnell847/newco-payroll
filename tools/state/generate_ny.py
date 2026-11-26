"""Regenerate New York's withholding tables in src/regulatory/state/ny.js.

Reads the NY Tax Department's own booklets and prints, as JSON, the
Method II (exact calculation) tables, the deduction/exemption allowances
(Tables B and C, cross-checked against Table A), and the Method III top
income rates where the booklet has them:

    NYS-50-T-NYS  New York State
    NYS-50-T-NYC  New York City (residents)
    NYS-50-T-Y    Yonkers (resident surcharge uses the State method)

It reads either edition the Department publishes:

  HTML (stdlib only; used for 2027 - the 1/27 booklets were posted as web
  pages while the PDF URLs still served the 1/26 editions):

    curl -O https://www.tax.ny.gov/forms/publications/wt/nys50-t-nys.htm
    curl -O https://www.tax.ny.gov/forms/publications/wt/nys50-t-nyc.htm
    curl -O https://www.tax.ny.gov/forms/publications/wt/nys50-t-y.htm
    python -I generate_ny.py nys50-t-nys.htm > nys.json
    python -I generate_ny.py nys50-t-nyc.htm > nyc.json
    python -I generate_ny.py nys50-t-y.htm --same-as nys50-t-nys.htm > y.json

  The HTML output also carries the booklet's edition and effective dates
  (printed to stderr each run) and, for Yonkers, the resident surcharge
  rate and the nonresident Method 8 exclusion table. --same-as asserts the
  Yonkers allowance and Method 2/3 tables equal the State's.

  PDF (used for 2026):

    pip install pypdf==5.1.0
    curl -O https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf
    curl -O https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nyc.pdf
    curl -O https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_y.pdf
    python -I generate_ny.py nys50_t_nys.pdf > nys.json   (likewise for nyc, y)

Downloaded pages are untrusted input: they are only parsed as data.
All amounts in cents; rates in basis points of a basis point (0.0753 ->
753, i.e. ten-thousandths). The tables are never hand-typed.
"""
import json
import re
import sys
from html.parser import HTMLParser

PERIODS = {"daily": 260, "weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12, "annual": 1}


def cents(s):
    s = s.replace("$", "").replace(",", "").strip()
    whole, _, frac = s.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


def period_key(label):
    label = label.lower()
    if label.startswith("daily"):
        return "daily"
    for k in PERIODS:
        if label.startswith(k):
            return k
    return None


def from_pdf(path):
    from pypdf import PdfReader

    pages = [p.extract_text() or "" for p in PdfReader(path).pages]

    # ---- Tables A, B, C (allowances)
    text = "\n".join(pages)
    lines = [l.strip() for l in text.splitlines()]


    # Table B: "<Period> Single $x" / "Married y" (and "Daily or" / "miscellaneous" / "Single $x")
    def table_after(title, stop):
        start = next(i for i, l in enumerate(lines) if l == title)
        end = next(i for i in range(start + 1, len(lines)) if lines[i].startswith(stop))
        return lines[start:end]


    table_b = {}
    current = None
    for l in table_after("Table B", "Table C"):
        m = re.fullmatch(r"(Daily or|Weekly|Biweekly|Semimonthly|Monthly|Annual)?\s*(Single|Married) \$?([\d,.]+)", l)
        if l.startswith("miscellaneous"):
            continue
        if l == "Daily or":
            current = "daily"
            continue
        if m:
            if m.group(1):
                current = period_key(m.group(1))
            elif current is None:
                continue
            table_b.setdefault(current, {})[m.group(2).lower()] = cents(m.group(3))
    table_c = {}
    for l in table_after("Table C", "Table D"):
        m = re.fullmatch(r"(Daily/miscellaneous|Weekly|Biweekly|Semimonthly|Monthly|Annual) \$?([\d,.]+)", l)
        if m:
            table_c[period_key(m.group(1))] = cents(m.group(2))

    # Table A cross-check: every published cell must equal B + n x C
    table_a_rows = 0
    current = None
    for l in table_after("Table A", "Table B"):
        m = re.fullmatch(r"(Daily or|Weekly|Biweekly|Semimonthly|Monthly|Annual)?\s*(Single|Married) ((?:\$?[\d,.]+ ?){11})", l)
        if l.startswith("miscellaneous"):
            continue
        if l == "Daily or":
            current = "daily"
            continue
        if m:
            if m.group(1):
                current = period_key(m.group(1))
            status = m.group(2).lower()
            values = [cents(v) for v in m.group(3).split()]
            for n, v in enumerate(values):
                assert v == table_b[current][status] + n * table_c[current], (current, status, n, v)
            table_a_rows += 1
    assert table_a_rows == 12, table_a_rows

    # ---- Method II tables: "Table II - X <Period> payroll", status from the page heading
    # Bracket edges can carry cents (NYC daily: "33.50").
    AMT = r"\$?([\d,]+(?:\.\d{2})?)"
    row_re = re.compile(rf"(\d+) {AMT} (?:\$?[\d,]+(?:\.\d{{2}})?|\.+) {AMT} (0\.\d{{4}}) \$?([\d,.]+)")
    method2 = {}
    for page in pages:
        head = page[:400]
        if "Exact Calculation Method" not in head and "Method II" not in head:
            continue
        status = "single" if "Single" in head.split("Table II")[0] else "married" if "Married" in head.split("Table II")[0] else None
        if status is None:
            continue
        current = None
        for l in (x.strip() for x in page.splitlines()):
            h = re.match(r"Table II - [A-F] (Daily|Weekly|Biweekly|Semimonthly|Monthly|Annual)", l, re.I)
            if h or l == "Annual Tax Rate Schedule":
                current = period_key(h.group(1)) if h else "annual"
                method2.setdefault(status, {})[current] = []
                continue
            if current is None:
                continue
            m = row_re.fullmatch(l)
            if m:
                line_no, over, sub, rate, plus = m.groups()
                assert cents(over) == cents(sub), l
                rows = method2[status][current]
                assert int(line_no) == len(rows) + 1, (status, current, l)
                rows.append([cents(over), int(rate.replace("0.", "")), cents(plus)])

    for status, by_period in method2.items():
        for period, rows in by_period.items():
            assert rows and rows[0][0] == 0, (status, period)

    # ---- Method III (top income) rates, read only from the Method III page:
    # "$1,077,550 $5,000,000 0.1045" - the single table, then the married one.
    method3 = {}
    m3_pages = [p for p in pages if "Method III Top Income Tax Rates Method" in p[:300]]
    if m3_pages:
        flat = []
        for l in (x.strip() for x in m3_pages[0].splitlines()):
            m = re.fullmatch(r"\$?([\d,]+)\s+(?:\$?[\d,]+|\.+)\s+(0\.\d{4})", l)
            if m:
                flat.append([cents(m.group(1)), int(m.group(2).replace("0.", ""))])
        assert len(flat) == 6, flat
        method3 = {"single": flat[:3], "married": flat[3:]}

    return {
        "deductionCents": table_b,
        "exemptionCents": table_c,
        "method2": method2,
        "method3": method3,
    }


# ---- HTML booklets (www.tax.ny.gov/forms/publications/wt/nys50-t-*.htm)
class _Booklet(HTMLParser):
    """Flattens a booklet page into an ordered list of
    ["text", tag, text] and ["table", caption, rows] items. Only top-level
    tables are read; cell text is whitespace-normalized."""

    TEXT_TAGS = ("h1", "h2", "h3", "h4", "p", "li")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.depth = 0
        self.row = self.cell = self.caption = self.text = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.depth += 1
            if self.depth == 1:
                self.items.append(["table", "", []])
        elif self.depth == 1 and tag == "caption":
            self.caption = []
        elif self.depth == 1 and tag == "tr":
            self.row = []
        elif self.depth == 1 and tag in ("td", "th"):
            self.cell = []
        elif tag == "br" and self.cell is not None:
            self.cell.append(" ")
        elif self.depth == 0 and tag in self.TEXT_TAGS:
            self.text = [tag]

    def handle_endtag(self, tag):
        def norm(parts):
            return " ".join("".join(parts).split())

        if tag == "table":
            self.depth -= 1
        elif tag == "caption" and self.caption is not None:
            self.items[-1][1] = norm(self.caption)
            self.caption = None
        elif self.depth == 1 and tag in ("td", "th") and self.cell is not None:
            self.row.append(norm(self.cell))
            self.cell = None
        elif self.depth == 1 and tag == "tr" and self.row is not None:
            self.items[-1][2].append(self.row)
            self.row = None
        elif self.text is not None and tag == self.text[0]:
            t = norm(self.text[1:])
            if t:
                self.items.append(["text", tag, t])
            self.text = None

    def handle_data(self, data):
        for buf in (self.caption, self.cell, self.text):
            if buf is not None:
                buf.append(data)
                return


def rate_of(s):
    """'0.0380' -> 380 (ten-thousandths)."""
    m = re.fullmatch(r"0\.(\d{4})", s)
    assert m, s
    return int(m.group(1))


def from_html(path):
    parser = _Booklet()
    with open(path, encoding="utf-8") as f:
        parser.feed(f.read())
    items = parser.items
    texts = [i[2] for i in items if i[0] == "text"]
    tables = [i for i in items if i[0] == "table"]

    def table(prefix):
        found = [t[2] for t in tables if t[1].startswith(prefix)]
        assert len(found) == 1, (prefix, len(found))
        return found[0]

    # Edition and effective dates, printed so every run shows what was read.
    edition = next(t for t in texts if re.fullmatch(r"\(\d{1,2}/\d{2}\)", t))
    title = next(i[2] for i in items if i[0] == "text" and i[1] == "h1")
    effective = re.search(r"Effective (.+)$", title).group(1)
    print(f"{path}: edition {edition}, effective {effective}", file=sys.stderr)

    # Table B rows: [period, status, amount], then [status, amount].
    table_b = {}
    current = None
    for row in table("Table B")[1:]:
        if len(row) == 3:
            current = period_key(row[0])
            row = row[1:]
        assert current and len(row) == 2 and row[0] in ("Single", "Married"), row
        table_b.setdefault(current, {})[row[0].lower()] = cents(row[1])
    assert set(table_b) == set(PERIODS), table_b
    table_c = {period_key(r[0]): cents(r[1]) for r in table("Table C")[1:]}
    assert set(table_c) == set(PERIODS), table_c

    # Table A cross-check: every published cell must equal B + n x C.
    # Cells may lack thousands separators ("1083.10"); cents() takes both.
    table_a_rows = 0
    current = None
    for row in table("Table A"):
        if len(row) == 13:
            current = period_key(row[0])
            row = row[1:]
        if len(row) != 12 or row[0] not in ("Single", "Married"):
            continue
        status = row[0].lower()
        for n, v in enumerate(row[1:]):
            assert cents(v) == table_b[current][status] + n * table_c[current], (current, status, n, v)
        table_a_rows += 1
    assert table_a_rows == 12, table_a_rows

    # Method 2 tables. The status comes from the section heading,
    # "[Yonkers, ]Method 2: Exact Calculation Method, Single|Married ...";
    # tables in any other section (e.g. the Yonkers nonresident Method 7,
    # whose captions also read "Table 2 - A ...") are ignored.
    method2 = {}
    status = None
    for kind, tag_or_caption, content in items:
        if kind == "text":
            if tag_or_caption == "h2":
                m = re.match(r"(?:Yonkers, )?Method 2: Exact Calculation Method, (Single|Married)\b", content)
                status = m.group(1).lower() if m else None
            continue
        if status is None:
            continue
        cap = tag_or_caption
        h = re.fullmatch(r"Table 2 \W [A-E] (Daily|Weekly|Biweekly|Semimonthly|Monthly) payroll", cap, re.I)
        if not h and cap != "Annual Tax Rate Schedule":
            continue
        period = period_key(h.group(1)) if h else "annual"
        assert period not in method2.get(status, {}), (status, period)
        rows = method2.setdefault(status, {})[period] = []
        upper = []
        for r in content:
            if len(r) == 6 and r[0].isdigit():
                line_no, at_least, less_than, sub, rate, plus = r
                assert int(line_no) == len(rows) + 1, (status, period, r)
                assert cents(at_least) == cents(sub), (status, period, r)
                rows.append([cents(at_least), rate_of(rate), cents(plus)])
                upper.append(cents(less_than) if less_than else None)
        assert rows and rows[0][0] == 0, (status, period)
        for i in range(len(rows) - 1):
            # contiguous and ascending: each line's "but less than" is the next line's "at least"
            assert upper[i] == rows[i + 1][0] and rows[i][0] < rows[i + 1][0], (status, period, i)
    for status in ("single", "married"):
        assert set(method2.get(status, {})) == set(PERIODS), (status, sorted(method2.get(status, {})))

    # Method 3 (State and Yonkers booklets): rows [line, from, to, rate].
    method3 = {}
    for status in ("Single", "Married"):
        found = [t[2] for t in tables if t[1] == f"Method 3 {status} Table"]
        if not found:
            continue
        assert len(found) == 1
        rows = [[cents(r[1]), rate_of(r[3])] for r in found[0] if len(r) == 4 and r[0].isdigit()]
        assert len(rows) == 3 and rows[0][0] < rows[1][0] < rows[2][0], rows
        method3[status.lower()] = rows
    assert method3 == {} or set(method3) == {"single", "married"}, method3

    out = {
        "edition": edition,
        "effective": effective,
        "deductionCents": table_b,
        "exemptionCents": table_c,
        "method2": method2,
        "method3": method3,
    }

    # Yonkers booklet only: the resident surcharge rate (Method 2 Step 5)
    # and the nonresident earnings tax (Method 8 annualized exclusion table).
    surcharge = {m.group(1) for t in texts for m in re.finditer(r"Multiply the result by [\d.]+% \((0\.\d+)\)", t)}
    if surcharge:
        assert len(surcharge) == 1, surcharge
        out["yonkersSurchargeRate"] = surcharge.pop()
        nr_rate = {m.group(1) for t in texts for m in re.finditer(r"nonresident earnings tax rate is [\d.]+% \((0\.\d{4})\)", t)}
        assert len(nr_rate) == 1, nr_rate
        exclusions = []
        no_tax_up_to = None
        for r in table("Annualized exclusion table"):
            if len(r) == 4 and r[0].isdigit():
                if r[3] == "No tax withheld":
                    no_tax_up_to = cents(r[2])
                else:
                    exclusions.append([cents(r[1]), cents(r[3])])
        assert no_tax_up_to and exclusions and exclusions[0][0] == no_tax_up_to, (no_tax_up_to, exclusions)
        out["yonkersNonresident"] = {
            "rateBp": rate_of(nr_rate.pop()),  # 0.0050 -> 50 basis points
            "noTaxUpToCents": no_tax_up_to,
            "exclusions": exclusions,  # [annualized pay over (cents), exclusion (cents)]
        }
    return out


def main(argv):
    """generate_ny.py BOOKLET [--same-as STATE_BOOKLET]

    BOOKLET is a saved .htm page or a .pdf. With --same-as, also assert
    that BOOKLET's allowance, Method 2 and Method 3 tables equal the
    State booklet's (the Yonkers check)."""

    def load(p):
        return from_html(p) if p.lower().endswith((".htm", ".html")) else from_pdf(p)

    out = load(argv[1])
    if len(argv) == 4 and argv[2] == "--same-as":
        other = load(argv[3])
        for k in ("deductionCents", "exemptionCents", "method2", "method3"):
            assert out[k] == other[k], f"{argv[1]}: {k} differs from {argv[3]}"
        print(f"{argv[1]}: tables identical to {argv[3]}", file=sys.stderr)
    else:
        assert len(argv) == 2, main.__doc__
    # Rates are ten-thousandths: 0.0753 -> 753.
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(sys.argv)
