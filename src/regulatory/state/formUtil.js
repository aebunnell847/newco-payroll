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

module.exports = { formChecker, onFile };
