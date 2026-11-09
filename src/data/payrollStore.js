// SPDX-License-Identifier: MIT
//
// Plain-English overview: the payroll data layer. It keeps employees, pay
// periods, hours, and every payroll result in a SQLite database (Node's
// built-in node:sqlite, so no extra dependency), and answers the questions
// a payroll run needs answered from records rather than from the caller:
//   - which employees are active, and what their pay-calc inputs are
//   - how many hours each hourly employee worked this period
//   - how much each employee has already deferred this tax year
//   - what last year's FICA wages were (for the Roth catch-up rule)
//   - which employees were already paid for this period
//
// What this store deliberately does NOT hold: names, SSNs, addresses, bank
// accounts, or any other identifying PII. Per Tenet 1 those belong in an
// access-controlled store the employee's own wallet gates, not in a payroll
// database. Rows are keyed by the same opaque employee ID payroll already
// uses; birth year (not date of birth) is kept only because the IRS
// catch-up test needs it.
//
// Every write is validated here, and the schema repeats the important
// checks (CHECK constraints, foreign keys), so a bad row can't get in
// through a different code path either.

const { DatabaseSync } = require("node:sqlite");
const { validateW4 } = require("../regulatory/federalWithholding");

// Bump when the schema changes. An existing file at an older version is
// refused rather than silently used with missing columns.
const SCHEMA_VERSION = 2;

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
  id                    TEXT PRIMARY KEY,
  pay_type              TEXT NOT NULL CHECK (pay_type IN ('salary', 'hourly')),
  annual_salary_cents   INTEGER CHECK (annual_salary_cents IS NULL OR annual_salary_cents >= 0),
  pay_periods_per_year  INTEGER CHECK (pay_periods_per_year IS NULL OR pay_periods_per_year > 0),
  hourly_rate_cents     INTEGER CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  deferral_election_pct REAL NOT NULL DEFAULT 0 CHECK (deferral_election_pct BETWEEN 0 AND 100),
  birth_year            INTEGER,
  -- Form W-4 elections as JSON (validated on write); NULL = none on file.
  -- Filing status and dollar elections only: no name, SSN or address.
  w4_json               TEXT,
  consent_attestation_id TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  CHECK (pay_type <> 'salary' OR (annual_salary_cents IS NOT NULL AND pay_periods_per_year IS NOT NULL)),
  CHECK (pay_type <> 'hourly' OR hourly_rate_cents IS NOT NULL)
);

-- FICA wages per employee per year (e.g. W-2 box 3). Kept per year rather
-- than as one employee field, because "prior year" moves every January.
CREATE TABLE IF NOT EXISTS fica_wages (
  employee_id TEXT NOT NULL REFERENCES employees(id),
  tax_year    INTEGER NOT NULL,
  wages_cents INTEGER NOT NULL CHECK (wages_cents >= 0),
  PRIMARY KEY (employee_id, tax_year)
);

-- The tax year is derived from the pay date and stored, never typed in
-- separately, so the two can't disagree.
CREATE TABLE IF NOT EXISTS pay_periods (
  id           TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  pay_date     TEXT NOT NULL,
  tax_year     INTEGER NOT NULL,
  CHECK (period_start <= period_end),
  CHECK (tax_year = CAST(substr(pay_date, 1, 4) AS INTEGER))
);

CREATE TABLE IF NOT EXISTS timesheets (
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  pay_period_id  TEXT NOT NULL REFERENCES pay_periods(id),
  regular_hours  REAL NOT NULL CHECK (regular_hours >= 0),
  overtime_hours REAL NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  PRIMARY KEY (employee_id, pay_period_id)
);

-- One row per employee per pay period. outcome = 'paid' rows are final;
-- 'skipped' and 'error' rows are replaced when the period is retried.
CREATE TABLE IF NOT EXISTS payroll_results (
  employee_id             TEXT NOT NULL REFERENCES employees(id),
  pay_period_id           TEXT NOT NULL REFERENCES pay_periods(id),
  tax_year                INTEGER NOT NULL,
  outcome                 TEXT NOT NULL CHECK (outcome IN ('paid', 'skipped', 'error')),
  gross_pay_cents         INTEGER,
  federal_withholding_cents INTEGER,
  social_security_cents   INTEGER,
  medicare_cents          INTEGER,
  additional_medicare_cents INTEGER,
  state_withholding_cents INTEGER,
  deferral_requested_cents INTEGER,
  deferral_cents          INTEGER,
  catch_up_portion_cents  INTEGER,
  roth_catch_up_required  INTEGER CHECK (roth_catch_up_required IS NULL OR roth_catch_up_required IN (0, 1)),
  net_pay_cents           INTEGER,
  ledger_employee_id      TEXT,
  ledger_pay_period_id    TEXT,
  withheld_at             INTEGER,
  reason                  TEXT,
  PRIMARY KEY (employee_id, pay_period_id),
  CHECK (outcome <> 'paid' OR (gross_pay_cents IS NOT NULL AND deferral_cents IS NOT NULL AND net_pay_cents IS NOT NULL))
);
`;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value, name) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) {
    throw new Error(`${name} must be an ISO date (YYYY-MM-DD)`);
  }
  // Date.parse accepts 2026-02-30; round-trip to catch impossible dates.
  if (new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} is not a real calendar date: ${value}`);
  }
}

function assertCents(value, name, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer number of cents`);
  }
}

function rowToEmployee(row) {
  return {
    id: row.id,
    payType: row.pay_type,
    annualSalaryCents: row.annual_salary_cents ?? undefined,
    payPeriodsPerYear: row.pay_periods_per_year ?? undefined,
    hourlyRateCents: row.hourly_rate_cents ?? undefined,
    deferralElectionPct: row.deferral_election_pct,
    birthYear: row.birth_year ?? undefined,
    w4: row.w4_json ? JSON.parse(row.w4_json) : null,
    consentAttestationId: row.consent_attestation_id ?? null,
    status: row.status,
  };
}

function rowToPayPeriod(row) {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    payDate: row.pay_date,
    taxYear: row.tax_year,
  };
}

function rowToResult(row) {
  return {
    employeeId: row.employee_id,
    payPeriodId: row.pay_period_id,
    taxYear: row.tax_year,
    outcome: row.outcome,
    grossPayCents: row.gross_pay_cents,
    federalWithholdingCents: row.federal_withholding_cents,
    socialSecurityCents: row.social_security_cents,
    medicareCents: row.medicare_cents,
    additionalMedicareCents: row.additional_medicare_cents,
    stateWithholdingCents: row.state_withholding_cents,
    deferralRequestedCents: row.deferral_requested_cents,
    deferralCents: row.deferral_cents,
    catchUpPortionCents: row.catch_up_portion_cents,
    rothCatchUpRequired: row.roth_catch_up_required === null ? null : row.roth_catch_up_required === 1,
    netPayCents: row.net_pay_cents,
    ledgerEmployeeId: row.ledger_employee_id,
    ledgerPayPeriodId: row.ledger_pay_period_id,
    withheldAt: row.withheld_at,
    reason: row.reason,
  };
}

/**
 * openPayrollStore(path)
 * ------------------------
 * path: a file path, or ":memory:" (the default) for tests and previews.
 * Returns an object with the methods below; call close() when done.
 */
function openPayrollStore(path = ":memory:") {
  const db = new DatabaseSync(path);
  const existingVersion = db.prepare("PRAGMA user_version").get().user_version;
  const hasTables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n > 0;
  if (hasTables && existingVersion !== SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `payroll database is at schema version ${existingVersion}, this code needs ${SCHEMA_VERSION}; migrate it first`
    );
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const tx = (fn) => {
    db.exec("BEGIN");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  const store = {
    close: () => db.close(),

    /** { table: [column names] } for every table, for audits and tests. */
    describeSchema() {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((r) => r.name);
      return Object.fromEntries(
        tables.map((t) => [t, db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name)])
      );
    },

    // ---- employees -------------------------------------------------------

    /** Insert or update an employee's pay-calc inputs. */
    upsertEmployee(employee) {
      const {
        id,
        payType,
        annualSalaryCents = null,
        payPeriodsPerYear = null,
        hourlyRateCents = null,
        deferralElectionPct = 0,
        birthYear = null,
        w4 = null,
        consentAttestationId = null,
        status = "active",
      } = employee;
      if (typeof id !== "string" || !id) throw new Error("employee id must be a non-empty string");
      assertCents(annualSalaryCents, "annualSalaryCents", { optional: true });
      assertCents(hourlyRateCents, "hourlyRateCents", { optional: true });
      if (birthYear !== null && !Number.isInteger(birthYear)) throw new Error("birthYear must be an integer year");
      validateW4(w4);
      db.prepare(
        `INSERT INTO employees (id, pay_type, annual_salary_cents, pay_periods_per_year, hourly_rate_cents,
                                deferral_election_pct, birth_year, w4_json, consent_attestation_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           pay_type = excluded.pay_type,
           annual_salary_cents = excluded.annual_salary_cents,
           pay_periods_per_year = excluded.pay_periods_per_year,
           hourly_rate_cents = excluded.hourly_rate_cents,
           deferral_election_pct = excluded.deferral_election_pct,
           birth_year = excluded.birth_year,
           w4_json = excluded.w4_json,
           consent_attestation_id = excluded.consent_attestation_id,
           status = excluded.status`
      ).run(
        id,
        payType,
        annualSalaryCents,
        payPeriodsPerYear,
        hourlyRateCents,
        deferralElectionPct,
        birthYear,
        w4 === null ? null : JSON.stringify(w4),
        consentAttestationId,
        status
      );
      return store.getEmployee(id);
    },

    getEmployee(id) {
      const row = db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
      return row ? rowToEmployee(row) : null;
    },

    listActiveEmployees() {
      return db
        .prepare("SELECT * FROM employees WHERE status = 'active' ORDER BY id")
        .all()
        .map(rowToEmployee);
    },

    /** Record an employee's FICA wages for a year (e.g. W-2 box 3). */
    setFicaWages(employeeId, taxYear, wagesCents) {
      if (!Number.isInteger(taxYear)) throw new Error("taxYear must be an integer year");
      assertCents(wagesCents, "wagesCents");
      db.prepare(
        `INSERT INTO fica_wages (employee_id, tax_year, wages_cents) VALUES (?, ?, ?)
         ON CONFLICT(employee_id, tax_year) DO UPDATE SET wages_cents = excluded.wages_cents`
      ).run(employeeId, taxYear, wagesCents);
    },

    /** FICA wages for a year, or null if none are on file (never zero by default). */
    getFicaWages(employeeId, taxYear) {
      const row = db
        .prepare("SELECT wages_cents FROM fica_wages WHERE employee_id = ? AND tax_year = ?")
        .get(employeeId, taxYear);
      return row ? row.wages_cents : null;
    },

    // ---- pay periods and hours ------------------------------------------

    /** Create a pay period. Its tax year is the pay date's year. */
    createPayPeriod({ id, periodStart, periodEnd, payDate }) {
      if (typeof id !== "string" || !id) throw new Error("pay period id must be a non-empty string");
      assertIsoDate(periodStart, "periodStart");
      assertIsoDate(periodEnd, "periodEnd");
      assertIsoDate(payDate, "payDate");
      if (periodStart > periodEnd) throw new Error("periodStart must be on or before periodEnd");
      const taxYear = Number(payDate.slice(0, 4));
      db.prepare(
        "INSERT INTO pay_periods (id, period_start, period_end, pay_date, tax_year) VALUES (?, ?, ?, ?, ?)"
      ).run(id, periodStart, periodEnd, payDate, taxYear);
      return store.getPayPeriod(id);
    },

    getPayPeriod(id) {
      const row = db.prepare("SELECT * FROM pay_periods WHERE id = ?").get(id);
      return row ? rowToPayPeriod(row) : null;
    },

    /** Record (or correct) an employee's hours for a pay period. */
    setHours(employeeId, payPeriodId, { regularHours, overtimeHours = 0 }) {
      for (const [name, v] of [
        ["regularHours", regularHours],
        ["overtimeHours", overtimeHours],
      ]) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          throw new Error(`${name} must be a non-negative number`);
        }
      }
      if (store.getResult(employeeId, payPeriodId)?.outcome === "paid") {
        throw new Error(`${employeeId} was already paid for ${payPeriodId}; hours can't change after payment`);
      }
      db.prepare(
        `INSERT INTO timesheets (employee_id, pay_period_id, regular_hours, overtime_hours) VALUES (?, ?, ?, ?)
         ON CONFLICT(employee_id, pay_period_id) DO UPDATE SET
           regular_hours = excluded.regular_hours, overtime_hours = excluded.overtime_hours`
      ).run(employeeId, payPeriodId, regularHours, overtimeHours);
    },

    /** Hours for one employee and period, or null if no timesheet is on file. */
    getHours(employeeId, payPeriodId) {
      const row = db
        .prepare("SELECT regular_hours, overtime_hours FROM timesheets WHERE employee_id = ? AND pay_period_id = ?")
        .get(employeeId, payPeriodId);
      return row ? { regularHours: row.regular_hours, overtimeHours: row.overtime_hours } : null;
    },

    // ---- results ---------------------------------------------------------

    /**
     * Year-to-date 401(k) deferrals: the sum of what was actually deferred
     * in paid results for this tax year. Computed from records, never
     * passed in, so the IRS limit check can't be fed a wrong running total.
     */
    yearToDateDeferralCents(employeeId, taxYear) {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(deferral_cents), 0) AS total FROM payroll_results
           WHERE employee_id = ? AND tax_year = ? AND outcome = 'paid'`
        )
        .get(employeeId, taxYear);
      return row.total;
    },

    /**
     * Year-to-date FICA wages: gross pay in paid results for this tax year
     * (calendar year), for the Social Security wage base and the Additional
     * Medicare threshold.
     */
    yearToDateFicaWagesCents(employeeId, taxYear) {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(gross_pay_cents), 0) AS total FROM payroll_results
           WHERE employee_id = ? AND tax_year = ? AND outcome = 'paid'`
        )
        .get(employeeId, taxYear);
      return row.total;
    },

    getResult(employeeId, payPeriodId) {
      const row = db
        .prepare("SELECT * FROM payroll_results WHERE employee_id = ? AND pay_period_id = ?")
        .get(employeeId, payPeriodId);
      return row ? rowToResult(row) : null;
    },

    listResults(payPeriodId) {
      return db
        .prepare("SELECT * FROM payroll_results WHERE pay_period_id = ? ORDER BY employee_id")
        .all(payPeriodId)
        .map(rowToResult);
    },

    /**
     * Save the outcomes of one runPayrollBatch call for a pay period, in a
     * single transaction. A 'paid' row is final: saving over it throws and
     * nothing from the batch is written.
     */
    saveOutcomes(payPeriod, outcomes) {
      const insert = db.prepare(
        `INSERT INTO payroll_results (
           employee_id, pay_period_id, tax_year, outcome, gross_pay_cents, federal_withholding_cents,
           social_security_cents, medicare_cents, additional_medicare_cents,
           state_withholding_cents, deferral_requested_cents, deferral_cents, catch_up_portion_cents,
           roth_catch_up_required, net_pay_cents, ledger_employee_id, ledger_pay_period_id, withheld_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(employee_id, pay_period_id) DO UPDATE SET
           outcome = excluded.outcome, gross_pay_cents = excluded.gross_pay_cents,
           federal_withholding_cents = excluded.federal_withholding_cents,
           social_security_cents = excluded.social_security_cents,
           medicare_cents = excluded.medicare_cents,
           additional_medicare_cents = excluded.additional_medicare_cents,
           state_withholding_cents = excluded.state_withholding_cents,
           deferral_requested_cents = excluded.deferral_requested_cents,
           deferral_cents = excluded.deferral_cents, catch_up_portion_cents = excluded.catch_up_portion_cents,
           roth_catch_up_required = excluded.roth_catch_up_required, net_pay_cents = excluded.net_pay_cents,
           ledger_employee_id = excluded.ledger_employee_id, ledger_pay_period_id = excluded.ledger_pay_period_id,
           withheld_at = excluded.withheld_at, reason = excluded.reason
         WHERE payroll_results.outcome <> 'paid'`
      );

      tx(() => {
        for (const o of outcomes) {
          const employeeId = o.employee.id;
          const r = o.result;
          const d = r?.contribution401k;
          const outcome = o.skipped ? "skipped" : o.error ? "error" : "paid";
          const roth = d?.rothCatchUpRequired;
          const info = insert.run(
            employeeId,
            payPeriod.id,
            payPeriod.taxYear,
            outcome,
            r?.grossPayCents ?? null,
            r?.taxWithholding.federalCents ?? null,
            r?.taxWithholding.socialSecurityCents ?? null,
            r?.taxWithholding.medicareCents ?? null,
            r?.taxWithholding.additionalMedicareCents ?? null,
            r?.taxWithholding.stateCents ?? null,
            d?.requestedCents ?? null,
            d?.actualCents ?? null,
            d?.catchUpPortionCents ?? null,
            roth === undefined || roth === null ? null : roth ? 1 : 0,
            r?.netPayCents ?? null,
            o.ledgerEntry?.ledgerEmployeeId ?? null,
            o.ledgerEntry?.ledgerPayPeriodId ?? null,
            o.ledgerEntry?.withheldAt ?? null,
            o.skipReason ?? o.error ?? null
          );
          if (info.changes === 0) {
            throw new Error(`${employeeId} was already paid for ${payPeriod.id}; refusing to overwrite`);
          }
        }
      });
    },
  };

  return store;
}

module.exports = { openPayrollStore };
