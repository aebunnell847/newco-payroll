// SPDX-License-Identifier: MIT
//
// Small shared checks for state withholding certificates, so each state
// file can validate its own form in a few lines.

function formChecker(formName) {
  const fail = (m) => {
    throw new Error(`${formName}: ${m}`);
  };
  return {
    fail,
    nonNegInt(form, key) {
      const v = form[key] ?? 0;
      if (!Number.isInteger(v) || v < 0) fail(`${key} must be a non-negative integer`);
      return v;
    },
    cents(form, key) {
      const v = form[key] ?? 0;
      if (!Number.isSafeInteger(v) || v < 0) fail(`${key} must be a non-negative integer number of cents`);
      return v;
    },
    oneOf(form, key, allowed, { optional = false } = {}) {
      const v = form[key];
      if (optional && (v === undefined || v === null)) return v;
      if (!allowed.includes(v)) fail(`${key} must be one of ${allowed.join(", ")}`);
      return v;
    },
    bool(form, key) {
      const v = form[key] ?? false;
      if (typeof v !== "boolean") fail(`${key} must be true or false`);
      return v;
    },
  };
}

const onFile = (form) => form !== null && form !== undefined;

/**
 * For a state whose figures changed mid-year: throw unless the pay date is
 * on or after the date this code's figures took effect. Earlier pay dates
 * need the earlier figures, which aren't sourced here - never a guess.
 */
function requirePayDateFrom(payDate, effectiveFrom, stateName) {
  if (typeof payDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
    throw new Error(`${stateName} withholding needs the pay date ("YYYY-MM-DD"): its figures changed on ${effectiveFrom}`);
  }
  if (payDate < effectiveFrom) {
    throw new Error(`no sourced ${stateName} withholding for pay date ${payDate} (these figures apply from ${effectiveFrom})`);
  }
}

const PERIOD_BY_COUNT = Object.freeze({
  260: "daily",
  52: "weekly",
  26: "biweekly",
  24: "semimonthly",
  12: "monthly",
  4: "quarterly",
  2: "semiannual",
  1: "annual",
});

module.exports = { formChecker, onFile, requirePayDateFrom, PERIOD_BY_COUNT };
