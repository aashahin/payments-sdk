import { describe, expect, it } from "bun:test";

import { getCurrencyExponent } from "./currency";

describe("getCurrencyExponent", () => {
  it.each([
    // Zero-decimal currencies
    ["JPY", 0],
    ["KRW", 0],
    ["VND", 0],
    ["XOF", 0],
    ["ISK", 0], // ISO 4217 exponent 0
    // Three-decimal currencies
    ["KWD", 3],
    ["BHD", 3],
    ["OMR", 3],
    ["JOD", 3],
    // Standard two-decimal currencies
    ["SAR", 2],
    ["USD", 2],
    ["EUR", 2],
    ["MGA", 2], // ISO 4217 exponent 2 (not zero-decimal)
    // Unknown currency codes fall back to 2
    ["XXX", 2],
    // Case-insensitive
    ["jpy", 0],
    ["isk", 0],
    ["mga", 2],
    ["kwd", 3],
    ["sar", 2],
  ])("getCurrencyExponent(%s) returns %i", (currency, expected) => {
    expect(getCurrencyExponent(currency)).toBe(expected);
  });
});
