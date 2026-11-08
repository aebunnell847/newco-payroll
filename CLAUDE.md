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
   `payrollRun.js` (orchestration). This is what makes 16/16 tests
   possible without a running blockchain node.
4. One employee's failure (bad data, revoked consent, a failed chain
   call) must never abort the rest of a payroll batch - see the
   try/catch-per-employee pattern in `runPayrollBatch`.

## Natural next steps

- Wire a real local Hardhat node + deployed `ConsentRegistry`/
  `ReconciliationLedger` and add an integration test exercising
  `chain/contracts.js` against it for real (currently only tested against
  a hand-written fake).
- Replace the two PLACEHOLDER constants in `payrollEngine.js` with calls
  into the regulatory RAG system once it exists.
- Add a minimal data layer for employee/pay-period records (currently
  these are passed in as plain objects by the caller).
