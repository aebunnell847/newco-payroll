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
store.upsertEmployee({ id: "emp-001", payType: "salary", annualSalaryCents: 104_000_00,
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

## What's still a placeholder

**State withholding** is a flat 5% of gross. Each state has its own method
and tables, which belong in a sourced table like the federal ones (or the
regulatory RAG system described in `research/regulatory-rag-architecture.md`
in `newco-docs`), not a number typed in. Every result says
`stateIsPlaceholder: true`.

Also not modeled yet:
- supplemental-wage (bonus) flat rates;
- Section 125 cafeteria-plan deductions, which would reduce both income-tax
  and FICA wages;
- local income taxes;
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
product UI), state withholding (see above), and the regulatory RAG
system the sourced limits table should eventually be generated from.
