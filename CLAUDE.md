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
   contribution limits must be clearly marked PLACEHOLDER until it's
   wired to the regulatory RAG system in `newco-docs` - never let an LLM
   or a hardcoded guess quietly stand in for a real regulatory figure.
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

- Wire a real local Hardhat node + deployed `ConsentRegistry`/
  `ReconciliationLedger` and add an integration test exercising
  `chain/contracts.js` against it for real (currently only tested against
  a hand-written fake).
- Replace the two PLACEHOLDER constants in `payrollEngine.js` with calls
  into the regulatory RAG system once it exists.
- Add a minimal data layer for employee/pay-period records (currently
  these are passed in as plain objects by the caller).
