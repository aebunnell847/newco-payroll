# newco-payroll

The payroll / HRIS application layer for NewCo. This is where gross pay,
tax withholding, and 401(k) deferrals actually get calculated, and where
those results get checked against wallet-granted consent and recorded to
the on-chain reconciliation ledger.

This package sits on top of two smart contracts built and tested
separately in `newco-contracts`:

- **ConsentRegistry** - the on-chain record of which downstream entities
  an employee's own wallet has actively granted access to which category
  of their data ("Tenet 1": the employee controls this, not NewCo).
- **ReconciliationLedger** - the immutable record comparing what payroll
  withheld against what the custodian confirms it received ("Tenet 2": a
  401(k) administrator's real job is reconciliation, not crypto-asset
  custody).

## What's here

```
src/
  models/Employee.js      - minimal employee shape (pay-calc inputs only;
                            NOT a place to store real PII)
  payroll/payrollEngine.js - gross pay, tax withholding, 401(k) deferral math
  regulatory/irsLimits.js  - IRS 401(k) limits by tax year, each figure
                            cited to an IRS source (see below)
  regulatory/federalWithholding.js - federal income tax withholding, IRS
                            Pub 15-T Worksheet 1A + percentage tables
  regulatory/fica.js       - Social Security and Medicare (IRS Pub 15)
  regulatory/state/        - state income tax withholding, one file per
                            state, each with its own sources and years
  payroll/payrollRun.js    - orchestrates a batch: consent check -> payroll
                            math -> record to the ledger
  payroll/storedPayrollRun.js - runs a pay period from the data layer and
                            saves the results (see "Payroll records")
  data/payrollStore.js     - SQLite records: employees, pay periods,
                            timesheets, FICA wages, payroll results
  chain/contracts.js       - the only file that talks to the blockchain
                            (ConsentRegistry + ReconciliationLedger)
  remittance/instructions.js - the remittance file payroll sends the custodian
                            (ledger IDs + amounts, CSV); see below
  custodian/recordRemittances.js - custodian side: records what it actually
                            received against payroll's ledger IDs, no key
  chain/ledgerIds.js       - derives each employee's on-chain ID with a keyed
                            hash (see "Employee IDs on the public ledger")
  config/index.js          - reads RPC URL / addresses / signer key /
                            employee-ID key from env
  chain/abi/*.json         - vendored copy of newco-contracts' compiled
                            ABI/bytecode (keep in sync manually for now)
test/
  payrollEngine.test.js       - unit tests for the math, no chain needed
  payrollRun.test.js          - orchestration tests against a fake chain client
  integration.realChain.test.js - deploys the REAL contracts to a local node
                                  and runs a full payroll batch through them
demo/
  real-chain-demo.html     - a clickable page that grants consent, runs
                            payroll, and records a remittance against
                            REAL deployed contracts on a local chain -
                            open it in a browser once a local node is running
```

## Running the tests

```
npm install
npm test
```

16 of the 19 tests need no blockchain at all - `payrollEngine.test.js`
tests pure arithmetic, and `payrollRun.test.js` uses a hand-written fake
chain client so the consent-gating and per-employee error isolation logic
can be proven without a running node. The remaining 3, in
`integration.realChain.test.js`, deploy the actual contracts to a local
node and run a real payroll batch through the real `chain/contracts.js`
wrapper - they auto-skip with a clear message if no local node is
reachable at `http://127.0.0.1:8545` (start one from the sibling
`newco-contracts` repo with `npm run node`).

## Trying the real-chain demo yourself

```
# in newco-contracts:
npm run node          # leave this running

# then open newco-payroll/demo/real-chain-demo.html in a browser
# (same computer as the node above)
```

Click through: deploy fresh contracts, grant consent as the employee,
run payroll, then record a matching, a mismatched, or a late remittance
as the custodian, and watch the reconciliation status update - all
against real transactions on a real (local, test) chain.

## 401(k) limits: sourced, by tax year

`src/regulatory/irsLimits.js` holds the IRS limits for 2025 and 2026,
each copied from and cited to an IRS primary source (Notice 2025-67,
IR-2025-111, Publications 560 and 17). `test/irsLimits.test.js` pins every
figure, so a typo fails CI.

- **Every pay period needs a `taxYear`** (the year the pay date falls
  in). There is no default year, and a year with no sourced figures
  throws. That employee fails; the rest of the batch carries on.
- **Catch-up is off unless the plan offers it** (`plan: { allowsCatchUp:
  true }` on `runPayrollBatch`). Then employees 50+ get the standard
  catch-up and those turning 60-63 in the year get the higher SECURE 2.0
  amount, judged from `employee.birthYear` (a year, not a birth date).
  Off by default because deferring too little is fixed next period, while
  an excess deferral needs a corrective distribution.
- **Roth catch-up (IRC 414(v)(7)) is reported, not applied.** From 2026,
  catch-up dollars must be Roth if last year's FICA wages from this
  employer exceeded the threshold ($150,000 for 2026). Each deferral
  result says `rothCatchUpRequired: true | false | null`; `null` means
  there were catch-up dollars but no `priorYearFicaWagesCents` on file,
  and a person has to resolve it. The engine doesn't split pre-tax and
  Roth yet.
- **Adding a year:** copy the figures from that year's IRS cost-of-living
  notice into the table with citations, and pin them in the test.

## Payroll records

`src/data/payrollStore.js` keeps payroll's records in SQLite, using
Node's built-in `node:sqlite` (Node 22.13+), so there's no extra
dependency. `runStoredPayroll(store, payPeriodId, options)` runs a period
from those records and saves every outcome.

```js
const { openPayrollStore } = require("./src/data/payrollStore");
const { runStoredPayroll, remittanceInstructionsForPeriod } = require("./src/payroll/storedPayrollRun");
const { toRemittanceCsv } = require("./src/remittance/instructions");

const store = openPayrollStore("payroll.db"); // or ":memory:"
store.upsertEmployee({ id: "emp-001", payType: "salary", workState: "CA", annualSalaryCents: 104_000_00,
                       payPeriodsPerYear: 26, deferralElectionPct: 5, consentAttestationId: "0x..." });
store.createPayPeriod({ id: "2026-P01", periodStart: "2025-12-22", periodEnd: "2026-01-04", payDate: "2026-01-09" });
await runStoredPayroll(store, "2026-P01", { chainClient, employeeIdKey, plan: { allowsCatchUp: true } });
const csv = toRemittanceCsv(remittanceInstructionsForPeriod(store, "2026-P01"));
```

What the records settle, so callers no longer pass them in:

- **Year-to-date deferrals** are summed from paid results in the pay
  date's tax year, so the IRS limit check always uses what was actually
  deferred.
- **The tax year comes from the pay date.** A period from Dec 22 to Jan 4
  paid Jan 9 counts in the new year, as the IRS counts it.
- **Hours are per employee.** An hourly employee with no timesheet is
  flagged as an error, never paid $0.
- **Nobody is paid twice for a period.** A paid result is final (the
  database refuses to overwrite it, and hours can't change after it).
  Re-running a period skips paid employees and retries the skipped or
  failed ones.
- **Bonuses are per employee per period.** `setSupplemental(employeeId,
  payPeriodId, cents)` records a bonus, commission or award paid with that
  period's regular pay; like hours, it can't change once the period is
  paid. Paid results keep the supplemental part, so year-to-date bonuses
  (for the federal $1 million rule) come from the records.
- **Prior-year FICA wages** (for the Roth catch-up rule) are recorded per
  year with `setFicaWages`. If none are on file the answer is "unknown",
  not zero.
- **The remittance file can be rebuilt** from saved results at any time.

No names, SSNs, addresses or bank details are stored (a test checks the
schema). Those belong in the wallet-gated store Tenet 1 describes. Birth
year is kept only because the IRS catch-up test needs it.

Known gap: the ledger write happens before the result is saved. If the
process dies between the two, the retry's ledger write is refused
("already recorded"), and that employee shows as an error for a person to
resolve. They are never paid twice.

## Federal withholding and FICA: sourced, by tax year

**Federal income tax** (`src/regulatory/federalWithholding.js`) follows
IRS Publication 15-T's method for automated payroll systems: Worksheet 1A
plus the Annual Percentage Method tables, for 2025 and 2026.

- **Where the tables come from.** A script generated them from the IRS
  documents themselves (the irs.gov HTML edition for 2026, the 2025 PDF);
  nothing was typed by hand.
- **How the tests check them.**
  - Every bracket's base amount has to follow from the bracket before it.
  - Results have to match the IRS's separately published 2026 weekly
    wage-bracket table to the dollar, at three wages across all six columns.
- **Every Form W-4 case is handled.**
  - 2020-or-later forms: filing status, the Step 2 checkbox, Step 3
    credits, and Step 4(a)/(b)/(c).
  - 2019-or-earlier forms with allowances.
  - Exempt.
  - No W-4 on file: the IRS default of Single with no adjustments, and the
    result says so (`w4Basis: "none-on-file"`).
- **Income-tax wages are gross minus pre-tax deferrals.** Catch-up dollars
  that must be Roth (`rothCatchUpRequired: true`) stay taxable.
- **The worksheet lines are returned** (`federalWorksheet`), so anyone can
  check the arithmetic.

**FICA** (`src/regulatory/fica.js`, IRS Publication 15):
- 6.2% Social Security up to the year's wage base ($184,500 in 2026,
  $176,100 in 2025);
- 1.45% Medicare;
- 0.9% Additional Medicare on wages over $200,000 in the year.

FICA is on gross pay, because 401(k) deferrals don't reduce FICA wages.

**Supplemental pay (bonuses)** (`src/regulatory/supplemental.js`, IRS
Publication 15 (2026), section 7) is added to gross pay. Federal income
tax on it:
- **Aggregate** (the default, always allowed): regular pay and bonus are
  withheld on as one payment.
- **Flat 22%** when the plan elects it (`plan.supplementalMethod:
  "flat"`): regular pay on the tables, the bonus at exactly 22%. An
  employee with no income tax withheld (exempt W-4) gets the aggregate
  result instead, as Publication 15 requires.
- **37% above $1 million**: supplemental wages past $1 million in the
  calendar year are withheld at 37% whatever the method or W-4.

A pre-tax deferral is shared between regular pay and bonus in proportion
to each. The breakdown is returned (`federalSupplemental`). State tax and
FICA treat the bonus as ordinary pay (every state guide here allows
combining it with regular pay; states' optional flat bonus rates aren't
used).
The wage base and threshold need year-to-date wages, which the data layer
sums from saved results.

**Taxes come first, then the 401(k).** If an election would leave negative
net pay, the deferral is cut back to what's left (`cappedByNetPay`). If
taxes alone would exceed gross pay (say, a large W-4 extra-withholding
amount), that employee fails for review instead of getting a negative
check.

**Every employee needs `payPeriodsPerYear`**, hourly employees included,
because withholding annualizes each paycheck.

A year with no sourced tables throws, same as the 401(k) limits.

## State withholding: one state at a time, sourced

State tax follows the employee's **work state** (`employee.workState`) and
that state's withholding certificate (`employee.stateW4`, or null for none
on file). Each state lives in its own file under `src/regulatory/state/`,
with its own sources and tax years.

| State | Method | Wages taxed | No certificate on file | Years |
|---|---|---|---|---|
| AL | Jan. 2026 booklet formula: GI less standard deduction (phased), **annual federal withholding**, personal exemption, dependents; 2% / 4% / 5%; A-4 | Gross minus pre-tax 401(k) (booklet) | Zero exemptions (booklet) | 2025, 2026 |
| AR | 2026 formula method: $2,470 standard deduction, $50 midrange, generated brackets to 3.7%, $29 per exemption credit; AR4EC | Gross minus pre-tax 401(k) (DFA instructions) | No exemptions (AR4EC) | 2025, 2026 |
| AZ | Elected % of wages on Form A-4 (0.5%-3.5% or zero) plus extra | Gross minus pre-tax 401(k) (A-4 instructions: federal W-2 box 1) | 2.0% default (A-4 instructions) | 2025, 2026 |
| CA | EDD Method B, annual method, DE 4 | Gross minus pre-tax 401(k) (EDD DE 231A) | Single, 0 allowances (DE 44) | 2026 |
| CO | DR 1098 worksheet: 4.40% after an annual allowance; DR 0004 or the federal W-4 | Gross minus pre-tax 401(k) (Wage Withholding Tax Guide) | As a "single" W-4: $5,500 allowance (DR 1098). A pre-2020 W-4 also gets $5,500 (DR 1098 is silent; flagged) | 2026 |
| CT | TPG-211 calculation rules: Tables A-E by CT-W4 code (generated), no percentage method | Gross minus pre-tax 401(k) (Circular CT) | 6.99% flat, no exemption (Circular CT) | 2025, 2026 |
| DE | Employer's Guide annualized formula: $3,250 / $6,500 deduction, 0%-6.6%, $110 per exemption credit | Gross minus pre-tax 401(k) | Single, no allowances (Guide 15(a)); a pre-2020 federal W-4's allowances if on file | 2025, 2026 |
| GA | 2026 Guide percentage method: 4.99% after Table F standard deduction and $5,000 per allowance; G-4 | Gross minus pre-tax 401(k) (Guide, O.C.G.A. 48-7-27) | Single, zero allowances (the Guide also allows using the federal election; flagged) | 2026 (5.19%, $12,000 / $24,000, $4,000 before May 11) |
| HI | Booklet A annualized method: $1,144 per allowance + $4,350 extra, 1.4%-7.9% | Gross minus pre-tax 401(k) (HRS 235-61) | Single, no allowances (Booklet A) | 2026 |
| IA | 2026 formula T1-T4: 3.80% after a per-period deduction, minus allowance $ / periods; IA W-4 (2024+ and 2023-or-earlier forms) | Gross minus pre-tax 401(k) (formula, Step 1) | Column A, no allowances | 2025, 2026 |
| ID | EPB00744 percentage table: 5.3% over $16,100 / $32,200 a year, rounded to the dollar; ID W-4 status A/B/C | Gross minus pre-tax 401(k) | Single chart (unstated by Idaho; flagged) | 2026 ($15,000 / $30,000 and child tax credit allowances before Jul. 23) |
| IL | IL-700-T automated method, IL-W-4 | Gross minus pre-tax 401(k) (86 Ill. Adm. Code 100.7010) | No exemptions (IL-W-4) | 2025, 2026 |
| IN | Departmental Notice #1: 2.95% state **plus county tax** (92 counties) after Table A-C deduction constants; WH-4 | Gross minus pre-tax 401(k) (IC 6-3-1-3.5) | State tax with no exemptions and **no county tax** (county unknown without a WH-4; flagged) | 2026 |
| KS | Percentage tables (generated, 8 periods) after $9,160 / $18,320 + $2,320 exemptions / periods; K-4 | Gross minus pre-tax 401(k) (KW-100) | Single, no allowances (KW-100) | 2025, 2026 |
| KY | 42A003 formula: 3.5% after the $3,360 standard deduction; K-4 (exempt, extra only) | Gross minus pre-tax 401(k) (42A003: IRC 3401 wages) | Formula with no extra | 2025, 2026 |
| LA | R-1306 computer formula: 3.09% after $12,875 / $25,750 / N; L-4 | Gross minus pre-tax 401(k) | No standard deduction (L-4) | 2025, 2026 |
| MA | Circular M (2026) percentage method: wages - employee FICA (max $2,000/yr) - exemption factors, 5% / 9% over $1,107,750, less head-of-household and blindness values; M-4 | Gross minus pre-tax 401(k) (DOR; Roth stays taxable) | Zero exemptions (by analogy to M-4P; flagged) | 2026 |
| MD | 2026 percentage method, one generated table set per local rate (state + **county** combined); county from the MW507, tiered Anne Arundel / Frederick by taxable income | Gross minus pre-tax 401(k) | Single, no exemptions, highest local table (unstated; flagged) | 2026 |
| ME | Aug. 2026 revised percentage method: $5,300 per allowance, phased standard deduction, 5.8%-7.15% + 2% surcharge over $1M / $1.5M | Gross minus pre-tax 401(k) | Single, no allowances (booklet) | 2025; 2026 (revision applied to all 2026 pay dates; flagged) |
| MI | Form 446 direct percentage: 4.25% after exemptions x $5,900 ($5,800 in 2025); MI-W4 | Gross minus pre-tax 401(k) (Form 446: follows federal) | Zero exemptions (Form 446) | 2025, 2026 |
| MN | 2026 computer formula: $5,300 per allowance, 5.35%-9.85% (daily = 360); W-4MN | Gross minus pre-tax 401(k) | Single, zero allowances (booklet) | 2025, 2026 |
| MO | 2026 formula: annual rates 0%-4.7% after $16,100 / $32,200 / $24,150, rounded to the dollar; MO W-4 | Gross minus pre-tax 401(k) (formula: Pub 15 wages) | Single (Form 4282) | 2025, 2026 |
| MS | Pub 89-700 annualized: 0% on first $10,000, 4.0% after exemption + standard deduction, rounded to the dollar; 89-350 | Gross minus pre-tax 401(k) (**not confirmed** from a Mississippi source; flagged) | Zero exemption, single (Pub 89-700) | 2025, 2026 |
| MT | 2026 guide formula W = A + B x (G - C), generated (3 statuses x 6 periods), 4.7% / 5.65%; MW-4 | Gross minus pre-tax 401(k) | Single table (unstated; flagged) | 2025, 2026 |
| NC | NC-30 annualized method: 4.09% after the standard deduction and $2,500 per allowance, rounded to the dollar; NC-4 | Gross minus pre-tax 401(k) (NC-30: IRC 3401 wages) | Single, no allowances (NC-30) | 2025, 2026 |
| ND | 2026 booklet: federal W-4 status, annual 1.95% / 2.50% brackets, rounded to the dollar; pre-2020 W-4s less $5,050 per allowance | Gross minus pre-tax 401(k) | Single (booklet) | 2025, 2026 |
| NE | Circular EN percentage tables (generated, 8 periods) after allowance values, with the 1.5% / 50% minimum; W-4N | Gross minus pre-tax 401(k) (federal taxable wages) | Pre-2020 federal W-4's status and allowances, else single with none (Circular EN) | 2025, 2026, 2027 |
| NJ | Rate Tables A-E per payroll period, NJ-W4 (A for single/separate, B for joint/HoH/widow(er), or the table chosen on line 3) | Gross minus 401(k) up to the federal limit (NJ-WT) | Rate A, 0 allowances (current NJ-WT is silent; this is the higher-withholding choice) | 2025, 2026 |
| NM | FYI-104 percentage tables (generated; single / married / HoH, no allowances); federal W-4 status | Gross minus pre-tax 401(k) | Single (unstated; flagged) | 2025, 2026 |
| NY | NYS-50-T Method II per pay frequency, Method III top rates, IT-2104; **plus NYC resident tax and Yonkers resident surcharge** | Gross minus pre-tax 401(k) (NYS-50) | Single, 0 allowances; a pre-2020 federal W-4's allowances if that's what's on file (NYS-50); no city tax | 2026 |
| OH | Percentage Method effective Aug. 1, 2026: $650 / periods per exemption, 1.6% / 2.99% / 3.4%; IT 4 | Gross minus pre-tax 401(k) | Zero exemptions (unstated; flagged) | 2026 (Oct. 2025 tables, 1.775% / 2.99% / 3.64%, before Aug. 1) |
| OK | OW-2 percentage tables (generated, 8 periods) after $1,000 per allowance / periods, rounded to the dollar; OK-W-4 | Gross minus pre-tax 401(k) | Single, no allowances (OAC 710:90-3-3) | 2025, 2026 |
| OR | 150-206-436 formula: wages - federal tax withheld (capped, phased) - standard deduction, 4.75%-9.9%, $263 per allowance; OR-W-4 | Gross minus pre-tax 401(k) (FAQ 6) | 8% of wages (HB 2119) | 2025, 2026 |
| PA | Flat 3.07% | **Gross; 401(k) deferrals are taxed** (REV-415) | No certificate exists | 2025, 2026 |
| RI | 2026 percentage method (generated): $1,000 / periods per exemption, $0 above $290,800 / periods; 3.75%-5.99%; RI W-4 | Gross minus pre-tax 401(k) | Zero exemptions (unstated; flagged) | 2025, 2026 |
| SC | WH-1603F: $5,000 per allowance, 10% standard deduction up to $7,500 (with 1+ allowances), 0% / 3% / 6%; SC W-4 | Gross minus pre-tax 401(k) | Zero allowances (WH-1603) | 2025, 2026 |
| UT | Pub 14 schedules: 4.45% less a base allowance phased out at 1.3%, whole dollars; federal W-4 status | Gross minus pre-tax 401(k) (Pub 14: IRC 3401(a)) | Single (no W-4) | 2026 (Rev. 4/25 schedules at 4.5% before Jun. 1) |
| VA | Formula for wages paid after July 1, 2025: $8,750 + $930 / $800 exemptions, 2%-5.75%; VA-4 | Gross minus pre-tax 401(k) (Guide: federal-exempt is VA-exempt) | No exemptions (Guide) | 2026 (deduction sunsets after 2026) |
| VT | GB-1210-2026 percentage tables (generated), allowance per table; W-4VT | Gross minus pre-tax 401(k) (IRC 3401) | Federal W-4 status (+30% of federal extra), else single (flagged) | 2025, 2026 |
| WI | W-166 alternate method: phased deduction, $400 per exemption, 3.54%-7.65%; WT-4 | Gross minus pre-tax 401(k) | Zero exemptions (W-166), single | 2025, 2026 |
| WV | IT-100.2A (March 2026, after the 5% cut) two-earner or optional one-earner tables (generated); IT-104 | Gross minus pre-tax 401(k) | Two-earner, zero exemptions (unstated; flagged) | 2025, 2026 |
| AK, FL, NH, NV, SD, TN, TX, WA, WY | No individual income tax on wages (each cited in `noIncomeTax.js`) | n/a | n/a | 2025, 2026 |

How the figures are checked:
- **California.** `tools/state/generate_ca_method_b.py` generates the
  tables from EDD's own PDF. EDD's worked Examples A, B, E and F match to
  the cent. C and D come within 2 cents, because EDD worked those with its
  per-period tables while this uses the annual method EDD allows.
- **Illinois.** Both years' booklet examples match to the cent.
- **Kentucky.** The 42A003 monthly example matches to the cent. The
  biweekly one prints $1,247.40 / 26 as "$47"; this keeps the cent
  ($47.98).
- **North Carolina.** NC-30's worked example ($450 weekly, single, 2
  allowances = $4.00) matches.
- **Colorado and Michigan** publish a formula but no worked example; the
  tests pin the formula line by line.
- **Iowa** (all 10 formula examples), **Utah** (all 6 Pub 14 examples),
  **Louisiana** (both R-1306 examples), **Indiana** (the Notice's example,
  state and county) and **Georgia** (the Guide's percentage-method
  example) match to the cent. Georgia's and Idaho's printed per-period
  figures are each reproduced from the annual amounts.
- **Missouri, Oklahoma, South Carolina and Virginia** match their worked
  examples to the cent. Oklahoma's tables are generated by
  `tools/state/generate_ok.py`.
- **North Dakota**'s 2026 booklet example still uses the 2025 single
  threshold ($734 a year); this follows the 2026 table printed beside it
  ($701.51).
- **Alabama, Arkansas, Kansas, Montana (all 9) and Wisconsin (both)** match
  their worked examples. Arkansas, Kansas, Montana and Nebraska tables are
  generated by `tools/state/generate_{ar,ks,mt,ne}.py`.
- **Alabama** deducts the employee's federal withholding, so payroll passes
  this period's federal amount to the state rules.
- **Delaware, Hawaii and Maine (all 3)** match their worked examples.
  **Connecticut**'s Circular CT examples were worked from wage-bracket
  tables; the exact TPG-211 rules come out 14-48 cents higher, and the
  tests check that range. Its five tables are generated by
  `tools/state/generate_ct.py`.
- **Oregon, Rhode Island and Vermont** match their worked examples
  (Oregon's per its worked lines; its prose has typos - see `or.js`).
  Minnesota and West Virginia print no example; the tests pin every
  bracket base. Rhode Island, Vermont and West Virginia tables are
  generated by `tools/state/generate_{ri,vt,wv}.py`.
- **Oregon** subtracts federal income tax withheld (like Alabama).
- **New Mexico** matches FYI-104's example ($41.80; tables generated by
  `tools/state/generate_nm.py`). **Ohio**'s per-period tables reproduce
  every printed figure from the annual amounts.
- **Maryland**'s nine percentage-method PDFs carry ten print defects
  (mismatched edges, a wrong rate, bases that don't follow their bracket);
  `tools/state/generate_md.py` corrects and reports each one. No worked
  example is printed; the tests pin every rate to state + local and every
  base to its bracket.
- **Massachusetts** prints wage-bracket tables rather than examples; the
  tests match a dozen cells of the 2026 weekly table within 3 cents.
  Massachusetts subtracts employee FICA (up to $2,000 a year), so payroll
  passes it to the state rules.
- **Mississippi** has no worked example; the tests match a full row of
  the printed 2026 biweekly single table (all ten exemption columns) and
  two more rows, to the dollar.
- **Indiana's county rates** are generated by
  `tools/state/generate_in_counties.py` from Departmental Notice #1.
  Boone County changed its rate Oct. 1, 2026 (0.017 to 0.0171); earlier
  pay dates use 0.017 from the Jan. 1 Notice, which shows no other county
  changed.
- **Mid-year changes.** Georgia (May 11), Utah (Jun. 1), Idaho (Jul. 23)
  and Ohio (Aug. 1) changed their figures during 2026. Each keeps the
  figures it replaced (`TABLES[2026].earlier`) and picks by pay date, so
  every 2026 pay date works; those states need the pay date. The earlier
  documents are cited per figure: Georgia's original 2026 Guide, Utah's
  Pub 14 Rev. 4/25 and Indiana's Jan. 1 Notice from the agencies' own
  PDFs as archived by the Internet Archive (the agencies now serve only
  the revisions), Idaho's April 2025 table and Ohio's October 2025 tables
  from the agencies. `test/earlier2026.test.js` checks each against its
  own printed tables and worked examples.
- **New Jersey.** `tools/state/generate_nj.py` generates all 40 tables
  (Rates A-E, 8 payroll periods) from the Division's PDF.
  - It corrects and reports two print defects in that PDF: "$15.000" for
    $15,000, and an 11.8% rate typeset as "1   1.8%".
  - It asserts every table runs from 1.5% to 11.8%.
  - NJ-WT's worked examples still use pre-2020 bracket edges. The three
    that fall in brackets that haven't changed match to the cent; the other
    three are within 2 cents.
- **New York.** `tools/state/generate_ny.py` generates the State, NYC and
  Yonkers tables from the Tax Department's 2026 booklets.
  - The generator checks every published allowance (Table A) against
    Table B + N × Table C.
  - It confirms the Yonkers tables are identical to the State's, which is
    why Yonkers is the State amount × 16.75%.
  - Of the booklets' 24 worked examples, 21 match to the cent. The other 3
    are within 1 cent, and in each one the booklet's own text is
    inconsistent (for example, it prints a rate of 0.070 where its table
    says 0.0707). The test file explains each case.

**City and local taxes** are returned separately as `localities` (e.g.
`{ NYC: 611 }`) and stored that way (`local_withholding_json`), because the
W-2 reports them separately. They are included in total withholding.
NYC and Yonkers residency comes from the IT-2104, so with no IT-2104 on file
no city tax is withheld.

Local taxes withheld today:

| Locality | Code | What | Source |
|---|---|---|---|
| New York City | `NYC` | Resident tax, from the IT-2104 | NYS-50-T-NYC |
| Yonkers residents | `YONKERS` | 16.75% surcharge on NYS tax | NYS-50-T-Y |
| Yonkers nonresidents | `YONKERS_NR` | 0.50% earnings tax, Method VIII; employer sets `worksInYonkers` | NYS-50-T-Y |
| Indiana counties | `IN-<code>` | County tax by Jan. 1 residence (92 counties) | Departmental Notice #1 |
| Maryland counties | (in `stateCents`) | Combined with state tax, by MW507 county | Comptroller percentage-method tables |
| Oregon | `OR_STT` | Statewide transit tax, 0.1% of Oregon wages | Oregon DOR |
| Denver | `DENVER_OPT` | $5.75 once a month at $500 of Denver pay; employer sets `denverWorker` | Denver Tax Guide Topic 61 |
| Ohio school districts | `OH_SD_<number>` | 214 districts (generated): (wages - $650/yr per IT 4 exemption) x rate; earned-income-only districts skip the exemption | 2026 SDIT list + SDIT computer formula |

Denver's tax is monthly, so it needs month-to-date pay: the stored payroll
run supplies it from the database (`payrollStore.monthToDate`), and a run
without it refuses a Denver worker rather than guess. Aurora repealed its
occupational privilege tax effective January 1, 2025.

**Reciprocity.** Fifteen states have reciprocity agreements
(`src/regulatory/state/reciprocity.js`, each cited to the work state's own
publication): a resident of a reciprocal state who files the work state's
nonresidence certificate (NJ-165, REV-419, WH-47, W-220, ...) owes the work
state no income tax, and the employer withholds the home state's tax
instead. Employees carry `residenceState`, `residenceStateW4` (the home
state's certificate) and `reciprocityCertificate`; the result's
`state` / the stored `state_code` say which state was withheld for.
Work-state local taxes (an Indiana county of principal employment) still
apply. A certificate no agreement covers is refused. Agreement conditions
(Virginia's daily commute, Maryland's 183-day abode rule, ...) are recorded
as notes; the certificate on file is the employer's evidence. Database
schema is version 5 (a version 4 file is migrated in place).

An employee with **no work state**, or one in a state or year that isn't
listed, fails for review, never a guessed rate. Washington is listed only
through 2026, because it has enacted a tax on income over $1M starting in
2028.

Not modeled yet:
- other states;
- other local income taxes, including PA's local earned income tax,
  Michigan's city income taxes (Detroit and others), Kentucky's
  occupational license taxes, Ohio municipal taxes (Michigan's city
  guidance, form 5469, refuses automated downloads, so it isn't sourced yet),
  Alabama occupational taxes and Wilmington's earned income tax (the
  city's site refuses automated requests, so it isn't sourced yet);
- New York pay frequencies other than daily, weekly, biweekly,
  semimonthly, monthly and annual;
- resident-state credits where there is NO reciprocity agreement (an
  employee living in one state and working in another owes both; only the
  work state is withheld), and Oregon residents working outside Oregon
  (statewide transit tax).

## Not modeled yet
- states' optional flat supplemental (bonus) rates;
- Section 125 cafeteria-plan deductions, which would reduce both income-tax
  and FICA wages;
- local taxes beyond those listed under state withholding;
- nonresident-alien withholding adjustments.

The browser demo still uses flat rates. It's a chain demo, not the engine.

## The one guardrail that matters

`payrollRun.js` checks consent and will hard-stop (skip or error) an
individual employee if their wallet hasn't granted active consent. That's
intentional and different from the reconciliation side: per the project's
single non-negotiable rule, nothing in this codebase is allowed to
automatically block or "correct" a remittance based on a reconciliation
mismatch - mismatches only ever get flagged (in `ReconciliationLedger.sol`)
for a human/ministerial process to resolve. Consent is the one place a
hard stop is correct; reconciliation is not.

## Employee IDs on the public ledger

`ReconciliationLedger` stores each employee's contribution amount next
to an `employeeId`, and everything on a public chain is readable by
anyone, forever. A plain hash of a guessable identifier (a sequential
employee number, an email) can be reversed by hashing every candidate,
which would expose individual 401(k) deferrals.

So the on-chain ID is `HMAC-SHA256(NEWCO_EMPLOYEE_ID_KEY,
"newco:ledger-employee-id:v1:" + employee.id)` (`src/chain/ledgerIds.js`).
Without the key, a guessed ID tells you nothing.

- **Set the key** to 32+ random bytes, hex-encoded:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  Any run that writes to the chain refuses to start without a valid
  key; there is deliberately no fallback to a plain hash.
- **Payroll is the system of record for employee IDs, and the key never
  leaves payroll**, even when payroll and the custodian are under the
  same corporate umbrella. After a run, `buildRemittanceInstructions`
  turns the outcomes into one line per on-chain contribution
  (`ledger_employee_id, ledger_pay_period_id, amount_cents, withheld_at`)
  and `toRemittanceCsv` writes the file. It contains no internal
  employee IDs or names. The custodian reads it with
  `parseRemittanceCsv` and records with `recordRemittancesFromInstructions`
  using its own signing key. That records the amount it **actually
  received**, never the instructed amount, so a shortfall is flagged
  `AmountMismatch` for a human instead of being papered over. Crediting
  the right participant account still goes through the existing private
  contribution file; this file only links each payment to its ledger
  entry.
- **Late deposits:** the ledger stores both the reported time
  (`withheldAt` / `remittedAt`, which the LateDeposit flag uses) and the
  chain's own `recordedAt`, so a reported time that doesn't match when
  the entry actually landed is visible to an auditor.
- **Don't rotate the key casually:** a new key gives every employee a
  new ledger ID, so records before and after can't be joined without
  the old key.
- **Amounts stay public, by design.** An employee's ledger ID is the
  same every pay period, so anyone can follow one pseudonym's
  contribution amounts over time and spot-check the reconciliation
  independently, just not attach a name. The keyed ID protects
  identity, not amounts. Keeping amounts visible is a deliberate choice
  for verifiability, not an open gap.

The browser demo uses the same scheme with a public, demo-only key.

## What's not here yet

This is a first slice, not the whole system. Not yet built: the
wallet-gated store for employee PII (the payroll records above hold none),
deployment to any real public testnet (see
`newco-contracts/docs/DEPLOYING_TO_TESTNET.md` for exactly what that
needs), a production frontend (the demo above is a dev proof, not a
product UI), the remaining states and local taxes (see above), and the regulatory RAG
system the sourced limits table should eventually be generated from.
