// SPDX-License-Identifier: MIT
//
// Shared bracket arithmetic for state withholding tables, in cents.

/**
 * Tax from a "base + rate x excess over" table: rows are
 * [overCents, baseCents, rateBasisPoints], ascending. Uses the last row
 * the amount is over (a row starting at 0 always applies). Unrounded.
 */
function fromBaseTable(amountCents, rows) {
  let row = rows[0];
  for (const r of rows) if (amountCents > r[0]) row = r;
  const [over, base, rateBp] = row;
  return base + (Math.max(0, amountCents - over) * rateBp) / 10_000;
}

/**
 * Tax from progressive marginal rates: rows are [overCents, rateBasisPoints],
 * ascending, the first starting at 0. Unrounded.
 */
function progressive(amountCents, rows) {
  let tax = 0;
  for (let i = 0; i < rows.length; i++) {
    const [lo, rateBp] = rows[i];
    const hi = i + 1 < rows.length ? rows[i + 1][0] : Infinity;
    if (amountCents <= lo) break;
    tax += ((Math.min(amountCents, hi) - lo) * rateBp) / 10_000;
  }
  return tax;
}

const roundToDollar = (cents) => Math.round(cents / 100) * 100;

module.exports = { fromBaseTable, progressive, roundToDollar };
