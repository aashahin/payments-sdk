// file: packages/payments-sdk/src/utils/currency.ts

/**
 * Shared ISO 4217 currency minor-unit (exponent) helper.
 *
 * All SDK public APIs accept and return amounts in MAJOR currency units
 * (e.g. 100.50 SAR). Gateways convert to/from minor units at the SDK
 * boundary using this helper so 0-decimal (JPY, KRW, ...) and
 * 3-decimal (KWD, BHD, OMR, ...) currencies are handled correctly.
 *
 * Gateways whose provider documents currency rules that deviate from
 * ISO 4217 (e.g. Stripe's ISK/UGX two-decimal special cases, PayPal's
 * HUF/JPY/TWD no-decimal list) keep their own gateway-specific tables.
 */

/**
 * ISO 4217 currencies with a minor-unit exponent of 0.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK", // ISO 4217 exponent 0 (Stripe may treat ISK specially — keep gateway tables separate)
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  // MGA is ISO 4217 exponent 2 (not zero-decimal); do not list here
]);

/**
 * ISO 4217 currencies with a minor-unit exponent of 3.
 */
const THREE_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

/**
 * Returns the ISO 4217 minor-unit exponent for a currency code
 * (case-insensitive). Defaults to 2 for unknown/standard currencies.
 */
export function getCurrencyExponent(currency: string): number {
  const normalizedCurrency = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return 0;
  }
  if (THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return 3;
  }
  return 2;
}
