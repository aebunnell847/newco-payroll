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
  payroll/payrollRun.js    - orchestrates a batch: consent check -> payroll
                            math -> record to the ledger
  chain/contracts.js       - the only file that talks to the blockchain
                            (ConsentRegistry + ReconciliationLedger)
  config/index.js          - reads RPC URL / addresses / signer key from env
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

## What's a placeholder, and why

Two things in `payrollEngine.js` are explicitly marked as placeholders,
not real figures:

1. **Tax withholding** is a flat 12% federal / 5% state rate. Real
   withholding depends on filing status, W-4 elections, and current IRS
   tables - this is exactly the kind of fact that should come from the
   regulatory RAG system described in
   `research/regulatory-rag-architecture.md` (in `newco-docs`), not a
   number typed into this file.
2. **The annual 401(k) elective deferral limit** is hardcoded to a
   placeholder value. The real IRS limit changes most years and should be
   pulled from the same RAG system, not hardcoded here.

Both are called out loudly in code comments so nobody mistakes this
scaffold for something ready to run real payroll.

## The one guardrail that matters

`payrollRun.js` checks consent and will hard-stop (skip or error) an
individual employee if their wallet hasn't granted active consent. That's
intentional and different from the reconciliation side: per the project's
single non-negotiable rule, nothing in this codebase is allowed to
automatically block or "correct" a remittance based on a reconciliation
mismatch - mismatches only ever get flagged (in `ReconciliationLedger.sol`)
for a human/ministerial process to resolve. Consent is the one place a
hard stop is correct; reconciliation is not.

## What's not here yet

This is a first slice, not the whole system. Not yet built: a real HRIS
data layer/database, deployment to any real public testnet (see
`newco-contracts/docs/DEPLOYING_TO_TESTNET.md` for exactly what that
needs), a production frontend (the demo above is a dev proof, not a
product UI), and the wiring to the regulatory RAG system that the two
placeholder values above should eventually come from.
