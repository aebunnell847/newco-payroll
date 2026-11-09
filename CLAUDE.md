# Context for Claude Code working in this repo

This is `newco-payroll`, one component of the NewCo open-source project
(a blockchain-based HRIS/401(k)/payroll system). Sibling repos:
`newco-contracts` (the Solidity contracts this package calls into) and
`newco-docs` (the research corpus and architecture decisions this
component implements).

## The two tenets everything here must respect

1. **The employee's own wallet controls data access**, not NewCo. Before
   this service reads or acts on any consent-gated employee data, it must
   check `ConsentRegistry.isAccessActive(...)` and refuse to proceed if
   it's not active. See `src/chain/contracts.js::assertConsentActive` and
   how `src/payroll/payrollRun.js` calls it.
2. **The reconciliation ledger only ever flags, never blocks or
   auto-corrects.** `ReconciliationLedger.recordContribution` /
   `recordRemittance` just record facts; any mismatch between what
   payroll withheld and what the custodian confirms gets surfaced for a
   human/ministerial process, never auto-resolved. Do not add any code
   path here that would halt a remittance based on a reconciliation
   mismatch - that would cross from "ministerial recordkeeping" into
   "fiduciary function" under ERISA (see `newco-docs/research/...` for
   the full analysis of why that distinction matters).

## Ground rules

1. Money is always integer cents, never floating-point dollars. This
   matches `ReconciliationLedger.sol`'s convention.
2. Anything that depends on current tax law, withholding tables, or IRS
   contribution limits is either (a) copied from a regulator's primary
   source into a table keyed by tax year, cited per figure, and pinned
   by a test (see `regulatory/irsLimits.js`), or (b) clearly marked
   PLACEHOLDER. Never let an LLM or a hardcoded guess quietly stand in
   for a real regulatory figure, and never fall back to another year's
   figures when a year is missing - throw instead.
3. Keep the layers separated: `payrollEngine.js` (pure math, no I/O),
   `chain/contracts.js` (the only file touching the blockchain),
   `payrollRun.js` (orchestration). This is what makes every unit test
   possible without a running blockchain node.
4. One employee's failure (bad data, revoked consent, a failed chain
   call) must never abort the rest of a payroll batch - see the
   try/catch-per-employee pattern in `runPayrollBatch`. The one
   exception is a missing or invalid `NEWCO_EMPLOYEE_ID_KEY`: that is a
   configuration error for the whole run, so it stops the batch before
   anyone is processed.
5. Employee IDs reach the chain only through `toLedgerEmployeeId` in
   `chain/ledgerIds.js` (a keyed HMAC). Never write `toBytes32Id`, or
   any other unkeyed hash, of an employee identifier to the ledger:
   it is public and a plain hash of a guessable ID is reversible.
6. Payroll is the system of record for employee IDs. The employee-ID key
   never goes to the custodian or any other party; the custodian gets
   ledger IDs through the remittance file (`remittance/instructions.js`)
   and `custodian/` code must never import `chain/ledgerIds.js` or read
   the key (a test enforces this). The custodian records the amount it
   actually received, never payroll's instructed amount.

## Natural next steps

- Add states to `regulatory/state/` one file at a time: generate tables
  from the state agency's own publication with a script in
  `tools/state/` (never hand-type wage-bracket or multi-period tables).
  A formula sheet's handful of constants (a rate, a deduction, a few
  annual brackets) may be transcribed only if a test pins them to the
  agency's worked example or reproduces its printed per-period figures.
  Declare the state's wage basis (does it tax 401(k) deferrals?) and its
  no-certificate default, and say in the file when either is not stated
  by the agency. A state whose figures changed mid-year needs the pay
  date (`requirePayDateFrom`) and throws for earlier dates. Then local
  taxes and reciprocity.
- Add each new tax year to `regulatory/` (401(k) limits, Pub 15-T tables,
  FICA) when the IRS publishes it - payroll for that year refuses to run
  until then.
- Generate `regulatory/irsLimits.js` entries from the regulatory RAG
  system once it exists (same shape, same citations, same tests).
- A wallet-gated store for employee PII (Tenet 1). `data/payrollStore.js`
  holds pay-calc inputs and results only and must stay PII-free; a test
  checks its columns.
