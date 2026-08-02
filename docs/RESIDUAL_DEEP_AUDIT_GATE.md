# Residual deep-audit gate (adversarial)

**Date:** 2026-08-02  
**Workspace:** `/home/shahin/Documents/projects/personal/packages/payments-sdk`  
**Method:** Read/grep source + run typecheck/tests. Implementer summaries (`docs/AUDIT_FIXES.md`) not trusted.

## Supersession note (session deep re-audit)

This document records the **residual deep re-audit** gate result (PASS for the six residual-deep P1s below). A later **session deep re-audit** (`payments-sdk-session-audit-fix-gate`) found additional issues beyond that scope (money freeze snapshot, ISK/MGA currency table, Stripe `capturePayment` partial status, PayPal success/raw-embed trim, Paymob refund base vs captured amount, package production checklist, etc.). Those session findings are tracked and remediated under [AUDIT_FIXES.md § Session deep re-audit fix pass](./AUDIT_FIXES.md#session-deep-re-audit-fix-pass) and the package [README](../README.md) production checklist — **this residual-deep PASS does not claim session items were clear.**

Non-blocking residuals refreshed after the session pass: float money type, webhook `event.id` SDK store, `registerGateway`, Node multi-runtime CI, full Checkout field surface, OMR live confirm, `PaymentClient` `defaultGateway` generics.

## Verdict (residual-deep scope only)

**PASS** — no blocking residual-deep P1s remaining at gate time (session re-audit is a separate subsequent pass).

| Check | Result |
| --- | --- |
| Typecheck (`bun run typecheck` / `tsc --noEmit`) | exit 0 |
| Tests (`bun test`) | 490 pass, 0 fail, 7 files |

---

## Blocking P1 rechecks

### P1: Stripe `unpaid` still maps to `cancelled` — **CLEAR**

Source: `src/gateways/stripe/stripe.gateway.ts` `stripeSubscriptionStatus`:

- `unpaid` → `pending` (with comment: invoices failed / retries exhausted, not cancelled)
- only `canceled` / `incomplete_expired` → `cancelled`

Test: `stripe.gateway.test.ts` — `"should map unpaid subscription status to pending (not cancelled)"` expects `pending`.

Checkout Session `payment_status: "unpaid"` on open sessions is a different Stripe field (session not paid yet); not subscription status mapping.

### P1: typecheck or tests red — **CLEAR**

- `bun run typecheck` → exit 0  
- `bun test` → 490 pass / 0 fail

### P1: after-hook compose short-circuits on `proceed: false` — **CLEAR**

`src/hooks/hooks.manager.ts` `composeHandlers` after-branch:

- ignores `proceed: false` on both handlers
- isolates throws per handler
- always returns `{ proceed: true, modifiedResult: carried }`
- second handler always runs with last good `carried`

`runAfter` same isolation for specific → global chain.

Test: `client.test.ts` — `"composed after-hooks continue after proceed:false (no short-circuit)"` expects order `['first','second']`.

### P1: `paypalFinalCapture` JSDoc only “Defaults to true” — **CLEAR**

`src/types/payment.types.ts` `CaptureParams.paypalFinalCapture` documents amount-dependent defaults:

- omit `amount` → `true`
- set `amount` (partial) → `false` unless `paypalFinalCapture === true`

Implementation in `paypal.gateway.ts` matches. Docs: `docs/paypal.md`.

### P1: `paymob.md` claims Intention `notification_url` primarily receives TOKEN — **CLEAR**

`docs/paymob.md` (callback / Intention section):

- card **TRANSACTION** may hit Intention `notification_url`
- **TOKEN** (saved-card) → dashboard **Integration Transaction Processed Callback**, not typically Intention `notification_url`

### P1: after-hook can change status failed→paid without restore — **CLEAR**

`src/gateways/base.gateway.ts`:

- `MONEY_IDENTITY_KEYS` includes `status`, `success`, `amount`, `gatewayId`, capture/refund IDs, etc.
- `restoreMoneyIdentityFields` restores any listed key present on original gateway result after after-hooks
- `executeWithHooks` always applies restore on the returned modified result

Test: `client.test.ts` — `"restores money identity fields if after-hook tries to change them"` (hook sets `status: 'paid'`, result stays `cancelled` from gateway).

Note: freeze is identity restore from original result, not a status-transition FSM; failed→paid is blocked the same way as cancelled→paid.

---

## Non-blocking residuals (open / deferred)

These do **not** fail the residual-deep gate; still open after the later **session** re-audit pass (product / deferred):

1. **Float money type** — `amount: number` with documented float caveats (`payment.types.ts` / README); no minor-units/decimal type yet.
2. **Webhook `event.id` SDK store** — dedupe remains app-level (README production checklist / AUDIT residuals); no first-class SDK event-id store.
3. **`registerGateway` / open `GatewayName`** — closed union; custom gateways wrap outside `PaymentClient` (`docs/custom-gateways.md`).
4. **Node multi-runtime CI** — package engines list Node ≥18; CI builds for Node target; tests run under Bun — no multi-runtime smoke matrix.
5. **Full Stripe Checkout field surface** — partial passthrough; unsupported fields rejected rather than full Stripe Checkout API mirror.
6. **OMR live confirm** — ISO exponent 3 implemented; live merchant-account confirmation remains ops-side.
7. **`PaymentClient` `defaultGateway` typing generics** — runtime fail-fast if default not configured; not generic-constrained to configured gateways at the type level.
8. **PayPal local CRC32 / cert offline verify** — still API postback-oriented (`verifyWebhookAsync`); no offline CRC32/local cert path.

---

## Summary

All six blocking **residual-deep** P1s were fixed in source and covered by tests/typecheck for that gate. Remaining items are intentional product/deferred non-blocking residuals. **Session deep re-audit** is a separate subsequent fix pass — see [AUDIT_FIXES.md § Session deep re-audit fix pass](./AUDIT_FIXES.md#session-deep-re-audit-fix-pass).
