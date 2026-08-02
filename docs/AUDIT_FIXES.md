# Audit remediation log — `@abshahin/payments-sdk` v0.8.0

**Date:** 2026-08-02  
**Scope:** Production deep audit (core + Moyasar + PayPal + Paymob + Stripe + docs) → fix → verify → gate  
**Workflow:** `payments-sdk-audit-fix-gate` → `payments-sdk-residual-fix-gate` → deep-audit fix pass → residual deep → **session deep re-audit**  
**Post-gate recheck:** additional logic fixes applied after adversarial gate (see [§ Post-gate recheck](#post-gate-recheck))  
**Residual recheck:** follow-up residual findings (see [§ Residual recheck pass](#residual-recheck-pass)); open gaps remain in [§ Residual / non-blocking](#residual--non-blocking-still-open)  
**Deep audit fix pass:** see [§ Deep audit fix pass](#deep-audit-fix-pass)  
**Residual deep re-audit fix pass:** see [§ Residual deep re-audit fix pass](#residual-deep-re-audit-fix-pass)  
**Session deep re-audit fix pass:** see [§ Session deep re-audit fix pass](#session-deep-re-audit-fix-pass) (supersedes prior residual-deep gate PASS with additional session findings)

---

## Verification snapshot

| Check | Result |
|-------|--------|
| `bun run typecheck` | Pass |
| `bun test` | Pass (516 tests; session deep integrate) |
| `bun run build` | `--target node --format esm --packages external` → `dist/index.js` + declarations |
| Gate verdict | **PASS** (no remaining P0/P1 blockers) |
| Session deep integrate | Freeze snapshot + after-hook identity; ISK/MGA; Stripe partial/trialing; PayPal success/raw embed; Paymob refund base; nextAction exports; docs aligned |

---

## Critical / P0 fixes

### 1. `createPayment` TypeScript overloads no longer default to Stripe

**Problem:** First overload was `createPayment(params: StripeCreatePaymentParams)`, so single-arg calls treated `callbackUrl` as optional even when the default gateway was Moyasar/PayPal.

**Fix (`src/client.ts`):**
- Removed the bare Stripe-only overload.
- Kept gateway-discriminated overloads (`gateway: "stripe" | "moyasar" | "paymob"`).
- General form: `createPayment(params: CreatePaymentParams, gateway?: GatewayName)`.

**Consumer impact:** Single-arg creates require full `CreatePaymentParams` (including `callbackUrl`). Stripe’s optional `callbackUrl` is available only with `gateway: "stripe"` (or `gateway('stripe').createPayment(...)`).

---

### 2. Zod validation now applies `parsed.data` (defaults / transforms)

**Problem:** `BaseGateway.executeWithHooks` only checked `safeParse` success and discarded `result.data`, so schema defaults (e.g. `capture: true`) never applied.

**Fix (`src/gateways/base.gateway.ts`):**
- Assign `validatedParams = parsed.data` before hooks.
- Re-parse after before-hooks and assign `finalParams = parsed.data`.

---

### 3. Publishable package target / unused dependency

**Problem:**
- Build used `--target bun` (not portable for Node consumers).
- `jose` was a dependency with zero imports.

**Fix (`package.json`, CI):**
- Build: `bun build ... --target node --format esm --packages external`.
- Removed `jose`.
- `exports` puts `types` before `import`.
- Added `engines` (`node >= 18`, `bun >= 1.0`).
- Keywords/description include Stripe.
- CI pins Bun `1.2.18`, runs `build`, asserts `dist/index.js` exists.

---

### 4. Paymob capture / refund / void / inquiry auth

**Problem:** Post-pay APIs required legacy `apiKey` → body `auth_token` even when Intention-only merchants had `secretKey`.

**Fix (`src/gateways/paymob/paymob.gateway.ts`, tests, `docs/paymob.md`):**
- Prefer `Authorization: Token ${secretKey}` with body **without** `auth_token`.
- Fall back to legacy `/api/auth/tokens` + body `auth_token` / Bearer inquiry when only `apiKey` is set.
- `assertPostPayCredentials()` accepts either `secretKey` or `apiKey`.
- Redirect HMAC `order.id` field accepts `order_id` alias.

---

### 5. Stripe three-decimal amounts

**Problem:** BHD/JOD/KWD/OMR/TND minor-unit amounts must be divisible by 10; SDK accepted values like `1.234` → `1234`.

**Fix (`src/gateways/stripe/stripe.gateway.ts`):** After conversion, reject non-multiples of 10 with `InvalidRequestError`. Tests updated.

---

### 6. Stripe subscription Checkout `gatewayPaymentId`

**Problem:** Docs said prefer `sub_…`; code preferred `payment_intent` when both present.

**Fix:** When `checkout.session.mode === "subscription"`, prefer `subscription` id over `payment_intent`. Docs + resources aligned; tests cover both-ids case.

---

## High / P1 fixes

### Client error types

| Before | After |
|--------|--------|
| Unsupported `void`/`getPayment`/`getPaymentStatus` → `GatewayNotConfiguredError` | `OperationNotSupportedError` (`OPERATION_NOT_SUPPORTED`) |
| Missing default gateway → bare `Error` | `InvalidRequestError` |
| `defaultGateway` not in configured map | Fail-fast `InvalidRequestError` at construct |

Exported from `src/index.ts`.

### Hooks / webhook pipeline

| Issue | Fix |
|-------|-----|
| After-hook `proceed: false` went through `try` → `onError` | After hooks run **outside** executor try; abort does not fire `onError` |
| `onError` / `onWebhookFailed` throw replaced primary error | Primary error always rethrown; secondary hook errors logged |
| `addHook` overwrote constructor hooks | Compose handlers (before short-circuit, after chain, error/webhook both run) |
| `onWebhookReceived` throw blocked verify | **Post-gate:** isolated — log and continue verification |
| After-compose lost first `modifiedResult` | **Post-gate:** carry forward when second returns `{ proceed: true }` only |

### Retry-After

**Problem:** Provider `Retry-After: 120` was clamped to `maxDelayMs` (default 5s).

**Fix (`src/utils/retry.ts`):**
- Honor Retry-After up to **120s** ceiling (separate from exponential `maxDelayMs`).
- Full-jitter on exponential backoff path only.
- Tests for honor / clamp / jitter.

### Moyasar

| Issue | Fix |
|-------|-----|
| `splits[].amount` passed as minor units while public API uses major | Convert each split with `toMinorUnits` (allows non-zero negatives) |
| DPAN + `capture: false` silently auto-captured | Fail closed with `InvalidRequestError` |
| `sandbox` config unused | Documented as ignored (use `sk_test_` / `sk_live_`) |
| `card_auth_*` webhooks mapped as payments | Reject with `InvalidWebhookError` |
| Empty POST still sent `Content-Type: application/json` | Omit Content-Type when no body |
| Currency case | Uppercase on create |
| Docs: refund `reason`, bad UUID example | Fixed |

### PayPal

| Issue | Fix |
|-------|-----|
| Cert URL not host-restricted | HTTPS + `*.paypal.com` allowlist |
| String/Buffer webhook bodies poorly documented | Accept string \| Buffer \| object; parse for `webhook_event` |
| `CARD_EXPIRED` → `AuthenticationError` | → `CardDeclinedError` |
| Docs assumed parsed body only | Raw-body + settlement-via-status notes |

### Stripe (additional)

| Issue | Fix |
|-------|-----|
| COP max amount too high | Cap aligned to 10 digits |
| `getCheckoutSession` used `"getPayment"` hooks | Operation `"getCheckoutSession"` (+ `OperationType`) |
| `webhookApiVersion` JSDoc claimed default | Corrected: only enforced when set |

### Documentation

| File | Changes |
|------|---------|
| `docs/webhooks.md` | Per-gateway shapes (Stripe raw + `stripe-signature`, PayPal headers, Moyasar `secret_token`, Paymob HMAC) |
| `docs/hooks.md` | After-hook non-rollback; authorize hooks primarily PayPal; op matrix |
| `docs/custom-gateways.md` | Honest: closed `GatewayName`, no `registerGateway` yet; example not named `StripeGateway` |
| `docs/stripe.md` / `paypal.md` / `paymob.md` / `moyasar.md` | Aligned with behavior above |
| `README.md` | Package path, multi-gateway caveats (refund IDs / `capture: false`) |
| `src/index.ts` banner | Mentions Stripe; safer examples |

---

## Post-gate recheck

Independent re-read of the remediation found residual issues; these were fixed in the same working tree:

1. **`onWebhookReceived` isolation** — a throwing metrics/logging hook no longer skips signature verification (`src/client.ts` + test).
2. **After-hook composition `modifiedResult` carry** — second handler without `modifiedResult` no longer drops the first handler’s transform (`src/hooks/hooks.manager.ts`).
3. **Comment accuracy** — `onWebhookVerified` intentionally **rethrows** (so HTTP handlers return 5xx / provider retries); comment no longer claims the event “still surfaces” when the hook fails.

Re-ran typecheck and client/utils tests after these fixes.

---

## Residual recheck pass

Follow-up workflow `payments-sdk-residual-fix-gate` addressed residual production findings that remained after the main audit pass.

### Integrate recheck (this pass)

Cross-stream integration verified on the working tree (no commit):

| Check | Result |
|-------|--------|
| Overlapping edit / conflict markers | None |
| `PaymentStatus` / `PaymentStatusSchema` | Include `partially_refunded`, `partially_captured`, `refunded` (plus refund lifecycle + `setup_completed`) |
| `WebhookEvent.livemode` | Optional `boolean \| undefined`; Moyasar sets from envelope `live` when boolean; Stripe sets from payload `livemode` |
| `bun run typecheck` | Pass |
| `bun test` | Pass (see deep-audit integrate for latest count) |
| Docs alignment | `is_auth` (Paymob dual model), refund `GatewayRefundResult.status === 'completed'` (Moyasar full/partial), `onWebhookFailed` = verification only (hooks + webhooks) |

### What landed (by residual checklist)

| ID | Finding | Landed |
|----|---------|--------|
| **S1** | Stripe `getPayment` ignored refunds on still-`succeeded` PIs | `amount_refunded` → `refunded` / `partially_refunded` (overrides capture) |
| **S2** | Invoice webhook ID / Basil+ fields | Prefer Basil+ `parent.subscription_details.subscription` / `payments.data` when needed |
| **S3** | Settled amount | Prefer `amount_received` when present for succeeded PIs |
| **S4** | Checkout `customerId` + `customerEmail` | Rejected together |
| **S5** | Unmapped PI status → pending | Fail-closed `failed` + warn |
| **P1** | Intention missing `is_auth` on auth-only | `is_auth: true` when `capture === false` (+ `authIntegrationId` swap) |
| **P2** | `region: "pk"` | Left open/experimental (non-blocking) |
| **P3** | Post-pay `transaction_id` as string | Sent as `Number(...)` |
| **M1** | Partial statuses missing | `resolvePaymentStatus` from `refunded` / `captured` amounts |
| **M2** | Refund result only `completed` if status===refunded | `completed` when payment reflects full/partial refund |
| **M3** | STC + `capture: false` | Fail-closed `InvalidRequestError` |
| **M4** | Webhook `livemode` | From `raw.live` when boolean |
| **C1** | `onWebhookFailed` on parse too | Separate verify vs parse; failed hook = verification only |
| **C2** | Amount allows Infinity | `.finite()` on amount schemas |
| **C3** | Empty secrets at construct | Fail-fast `InvalidRequestError` |
| **C4** | Package hygiene | `zod` pinned; build `--target node`; `jose` removed |
| **PP1** | PayPal field max lengths | Client-enforced (description 127, orderId 256, refund note 255, …) |
| **PP2** | Sandbox docs | `PAYPAL_SANDBOX === 'true'` |

See stream-owned docs (`docs/stripe.md`, `docs/paymob.md`, `docs/moyasar.md`, `docs/paypal.md`, `docs/webhooks.md`, `docs/hooks.md`) for behavior details.

---

## Deep audit fix pass

Follow-on deep audit (beyond residual recheck) targeted production correctness edge cases. **Integrate recheck (this pass)** reconciled stream-owned implementations with docs and verification.

### Verification (integrate)

| Check | Result |
|-------|--------|
| Overlapping edit / conflict markers | None (streams non-overlapping by design) |
| `PaymentStatus` / `PaymentStatusSchema` | Include `setup_completed`, `partially_captured`, `partially_refunded` (+ refund lifecycle) |
| `bun run typecheck` | Pass |
| `bun test` | Pass after client PayPal webhook transmission-time fix (fresh ISO time; 15‑min replay guard) |
| Docs alignment | PayPal raw postback, after-hook no-abort (log + return success), Moyasar `verified` → `setup_completed` |

### What landed vs intended

| Priority | Finding | Landed status | Actual behavior |
|----------|---------|---------------|-----------------|
| **P0** | PayPal webhook verify postback | **Landed** | Raw `string` / `Buffer` / `Uint8Array` embedded as `webhook_event` **without** re-serialization (`buildWebhookVerifyBody`). Parsed objects re-serialize + warn (may fail). Cert URL allowlisted HTTPS `*.paypal.com`. Sync `verifyWebhook` **throws** `InvalidRequestError` (not “returns false”) — use `verifyWebhookAsync` / `handleWebhook`. Transmission age ≤ 15 min. Docs: `paypal.md`, `webhooks.md`. |
| **P0 / P1** | Stripe partial-capture **refund math** | **Landed** | Refund completeness uses settled base (`amount_received` / `amount_captured` when present) so full refund of a partial capture maps to `refunded`; refunds override `partially_captured`. Settled amount prefers `amount_received` on succeeded PIs. Tests in `stripe.gateway.test.ts`. |
| **P1** | After-hooks after successful money ops | **Landed (stricter than early draft)** | After hooks run **after** the gateway side effect, outside executor try. `proceed: false` → **warn + ignore** (return success). After-hook **throw** → **log + return success**. Does **not** surface `PaymentAbortedError` or rethrow for after-hooks (early AUDIT draft was wrong). Docs: `hooks.md`, README integrator caveats. |
| **P1** | Webhook pipeline isolation | **Landed** | `onWebhookReceived` throw does not skip verify; after-compose preserves first `modifiedResult`; `onWebhookFailed` = verification failures only (not parse). |
| **P1** | Core amount / secrets hygiene | **Landed** | Finite positive amounts; empty gateway secrets fail-fast at construct. |
| **P1** | Moyasar `verified` | **Landed** | Provider `verified` maps to SDK `setup_completed` (card setup / zero-amount verification — **not** an auth hold). Docs: `moyasar.md`. |
| **Docs** | Integrator caveats | **Landed** | README + residual table: webhook **`event.id` dedupe is app-level**; float money risk; no `registerGateway` yet. |

### Docs contradictions resolved in integrate

| Topic | Was | Now |
|-------|-----|-----|
| PayPal raw postback | `webhooks.md` said String/Buffer are “JSON-parsed for `webhook_event`” | Embed original JSON text without re-serialization; prefer raw body |
| After-hook abort | Some notes implied `PaymentAbortedError` / failure to caller | Log + return successful gateway result; no reverse, no abort |
| Moyasar `verified` | Risk of reading as authorized hold | Explicit `setup_completed` (not auth hold) in status table + notes |

Cross-check stream-owned gateway docs for behavioral detail. Package-level consumer notes: [README](../README.md).

---

## Residual deep re-audit fix pass

**Date:** 2026-08-02  
**Workflow:** residual deep re-audit (multi-stream) after deep-audit integrate  
**Scope:** code + docs residuals that remained after [§ Deep audit fix pass](#deep-audit-fix-pass); package-level README / this log owned by stream F

Prior streams already landed (do not re-fix unless recheck fails): after-hook no-abort money, PayPal raw postback, Stripe refund math, Moyasar `verified` → `setup_completed`, webhook isolation, finite amounts, empty-secret fail-fast, etc.

### Workflow targets (by area)

| Area | Target findings (this re-audit) | Notes |
|------|----------------------------------|-------|
| **Stripe** | Unpaid / unpaid-status mapping residuals; Checkout field surface gaps; refund/settled amount edge cases | Stream-owned `stripe.gateway` + `docs/stripe.md` — not rewritten here |
| **Core / hooks** | After-hook chain integrity (compose + money no-abort); money-field freeze after gateway success | Hooks/base/client — after-hooks cannot abort or reverse money |
| **Money** | Major-unit float inputs remain; conversion/freeze at provider boundary | No decimal money type yet — see residual open table |
| **PayPal** | `webhookId` loud fail when missing; `ORDER.COMPLETED` mapping; `finalCapture` JSDoc accuracy | Stream-owned `paypal.gateway` + `docs/paypal.md` |
| **Paymob** | TOKEN webhook / saved-card docs | Stream-owned `docs/paymob.md` |
| **Moyasar** | `voidPayment` + callback URL docs | Stream-owned `docs/moyasar.md` |
| **README (this stream)** | Stripe sample uses `client.handleWebhook('stripe', rawBody, signature)` (not bare `verifyWebhook`); secret vs publishable keys (publishable = browser SDKs only; this package uses secret keys server-side) | [README](../README.md) |
| **AUDIT_FIXES (this stream)** | This section + residual open table refresh | This file |

### Package-level docs landed (stream F)

| Item | Change |
|------|--------|
| Stripe webhook sample | Prefer `await client.handleWebhook('stripe', rawBody, signature)` over gateway-only `verifyWebhook` |
| Keys note | Explicit: publishable/public keys are for browser SDKs; `PaymentClient` is server-side with secret keys |
| Residual open table | Still-open set refreshed below (dedupe store, float money, `registerGateway`, PayPal local CRC32, Node CI smoke, full Checkout surface) |

### Integrate recheck (residual deep streams)

Cross-stream wire-up after multi-agent residual deep fix. **No conflict markers** (streams mostly non-overlapping; `config.types` JSDoc-only).

| Item | Landed status | Evidence |
|------|---------------|----------|
| **C4 PayPal create schema wire** | **Landed (integrate)** | Stream A added `PayPalCreatePaymentParamsSchema` + client overload + unit tests; integrate wired `PayPalGateway.createPayment` to use it (was still on base `CreatePaymentParamsSchema`). `callbackUrl` optional; refine requires success return (`callbackUrl`\|`returnUrl`) and cancel fallback (`cancelUrl`\|`callbackUrl`\|`returnUrl`). |
| **C1 After-hook compose** | **Landed** | `proceed: false` does **not** short-circuit later after-handlers; `modifiedResult` carry-forward; throws isolated per handler (`hooks.manager.ts`). Docs: `hooks.md` composition section. |
| **C2/C3 After money integrity** | **Landed** | `runAfter` always `{proceed:true}`; base restores money identity fields; after throw/proceed:false → success (`base.gateway.ts`). |
| **S1 Stripe `unpaid`** | **Landed** | Subscription `unpaid` → `pending` (not `cancelled`). Docs: `docs/stripe.md`, `resources/gateways/stripe/README.md`. |
| **PP1 `paypalFinalCapture`** | **Landed** | Amount-dependent defaults: no amount → `true`; amount set → `false` unless `paypalFinalCapture === true`. JSDoc + `docs/paypal.md` aligned. |
| **PM1 TOKEN / `notification_url`** | **Landed (docs)** | TOKEN (saved-card) → dashboard Integration Transaction Processed Callback; not typically Intention `notification_url`. TRANSACTION may use per-payment `notification_url` for card. |
| **preferLastCapture typing** | **Landed (integrate)** | `noUncheckedIndexedAccess`-safe iteration; webhook capture type includes optional `create_time`/`update_time`. |
| **Exports** | **Already present** | `PayPalCreatePaymentParams`, `OperationNotSupportedError`; no extra public helpers required. |
| **`bun run typecheck`** | **Pass** | After integrate wire-up |
| **`bun test`** | **Pass** | 490 pass / 0 fail |

### Docs contradictions reconciled (integrate)

| Topic | Canonical behavior |
|-------|--------------------|
| Stripe subscription `unpaid` | → SDK `pending` (collect/reactivate); only `canceled` / `incomplete_expired` → `cancelled` |
| After-hook composition | Chain continues after `proceed: false` / throw; money identity frozen; never `PaymentAbortedError` post-success |
| Paymob TOKEN callbacks | Dashboard integration callback, not Intention `notification_url` (keep TOKEN HMAC) |
| `paypalFinalCapture` | Amount-dependent product defaults (not blanket `true`) |

Gateway behavioral docs remain owned by their streams; integrate only aligned residual contradictions above.

---

## Session deep re-audit fix pass

**Date:** 2026-08-02  
**Workflow:** `payments-sdk-session-audit-fix-gate` (multi-stream) after residual-deep gate  
**Scope:** Session multi-agent re-audit of freeze/hooks/currency, Stripe status edges, PayPal success/raw body, Paymob refund base, Moyasar success on unmapped status, package README production checklist  
**Note:** Prior [RESIDUAL_DEEP_AUDIT_GATE](./RESIDUAL_DEEP_AUDIT_GATE.md) **PASS** covered residual-deep P1s only; this session re-audit found additional items and applies a further fix pass. Package-level docs (README / this log / residual gate note) owned by stream F — gateway behavioral docs remain stream-owned.

### Workflow targets (by area)

| Area | Target findings (session re-audit) | Notes |
|------|-------------------------------------|-------|
| **Core freeze / hooks** | Snapshot before `runAfter` (in-place mutation must not poison restore); non-object `modifiedResult` ignored; extend `MONEY_IDENTITY_KEYS` (`fee`, `capturedAmount`, `refundedAmount`, `clientSecret`); after-hook throw / `proceed:false` logged; shallow-copy hooks config | Stream A — `base.gateway.ts`, `hooks.manager.ts` |
| **Currency** | ISO helper: **ISK** exponent `0`; **MGA** exponent `2` (remove from zero-decimal). Stripe keeps its own ISK/UGX special table | Stream A — `currency.ts` |
| **Validation** | Empty `idempotencyKey` rejected; Moyasar create schema excludes raw `creditcard` source | Stream A — `validation.ts` |
| **Stripe** | `capturePayment` → `partially_captured` when `amount_received < amount`; non-PI webhook default not mapped via PI `mapStatus`; `no_payment_required` gated to setup; `trialing` → `pending`; dual sub/PI IDs; Checkout `priceData` charge limits; `authentication_required` not `AuthenticationError` | Stream B — `stripe.gateway` + `docs/stripe.md` |
| **PayPal** | returnUrl-only cancel fallback; authorize/refund `success: status !== 'failed'`; raw webhook embed **without** trim of embedded bytes; docs fulfill-on-status | Stream C — `paypal.gateway` + `docs/paypal.md` |
| **Paymob** | Refund completeness vs **captured** amount when `captured_amount > 0` (not auth `amount_cents`); TOKEN id/merchant_id string coerce | Stream D — `paymob.gateway` + `docs/paymob.md` |
| **Moyasar** | Unmapped provider status → `success: false`; invalid Apple Pay → `InvalidRequestError`; multi-worker `idempotencyStore` callout | Stream E — `moyasar.gateway` + `docs/moyasar.md` |
| **README / AUDIT (this stream)** | Production checklist (`webhookId`, `idempotencyStore`, raw body, fulfill on status, float risk); npm/pnpm + ESM-only; this section + residual open refresh | [README](../README.md), this file, [RESIDUAL_DEEP_AUDIT_GATE](./RESIDUAL_DEEP_AUDIT_GATE.md) |

### What actually landed (integrate recheck)

Cross-stream integration verified on the working tree (**no commit**):

| Check | Result |
|-------|--------|
| Overlapping edit / conflict markers | None |
| `HooksManager` logger | Constructor accepts optional `Logger`; `PaymentClient` passes redacting logger (`new HooksManager(config.hooks, this.logger)`) |
| `PaymentNextAction` exports | `PaymentNextAction`, `MoyasarStcPayOtpNextAction`, `RedirectPaymentNextAction`, `MoyasarNextAction` exported from `src/index.ts` |
| Money freeze snapshot | `BaseGateway.executeWithHooks` shallow-clones before `runAfter`; `MONEY_IDENTITY_KEYS` includes `fee` / `capturedAmount` / `refundedAmount` / `clientSecret`; non-object `modifiedResult` ignored |
| After-hook result identity | `runAfter` / after-compose only set `modifiedResult` when a handler explicitly provides one — preserves gateway result reference (Paymob in-memory idempotent returns stay `===`) |
| Currency ISO | `getCurrencyExponent('ISK') === 0`; `getCurrencyExponent('MGA') === 2` |
| Stripe | `capturePayment` partial → `partially_captured`; `trialing` → `pending`; `authentication_required` → `CardDeclinedError` |
| PayPal | authorize/capture/refund `success: status !== 'failed'`; raw webhook embed without trim of embedded bytes; returnUrl-only cancel fallback |
| Paymob | Refund remaining base uses `captured_amount` when `> 0`; TOKEN numeric field string coerce |
| Moyasar | Unmapped status → `success: false`; invalid Apple Pay → `InvalidRequestError` |
| Validation | Empty `idempotencyKey` rejected; Moyasar create rejects raw `creditcard` |
| `bun run typecheck` | Pass |
| `bun test` | Pass (**516** tests, 0 fail) |

### Docs contradictions reconciled (session)

| Topic | Alignment |
|-------|-----------|
| **Freeze snapshot** | `docs/hooks.md` + `GatewayPaymentResult` JSDoc: hooks receive shallow clone; money identity restored; non-object `modifiedResult` ignored |
| **Stripe `trialing`** | `docs/stripe.md`: `trialing` → `pending` (not paid); unpaid remains pending |
| **PayPal success** | `docs/paypal.md`: fulfill on `status === 'paid'`; terminal failed → `success: false`; pending keeps `success: true` |
| **Paymob refund base** | `docs/paymob.md`: remaining refundable / webhook completeness use `captured_amount` when present (`> 0`), not auth `amount_cents` alone |

### Package-level docs landed (stream F)

| Item | Change |
|------|--------|
| Production checklist | README table: PayPal `webhookId`; Moyasar/Paymob multi-worker `idempotencyStore`; raw-body webhooks; fulfill on `status` not `success`; float major units; `event.id` app dedupe; secrets server-side |
| Install | `npm` / `pnpm` alternatives + **ESM-only** package note (`"type": "module"`, no CJS `require`) |
| Residual open table | Still-open set refreshed below (float money, event.id store, `registerGateway`, Node multi-runtime CI, Checkout surface, OMR live confirm, `defaultGateway` generics) |
| Residual gate doc | Supersession note: session re-audit followed residual-deep PASS |

---

## Residual / non-blocking (still open)

These remain known gaps; not treated as ship blockers. **Still open after session deep re-audit** (product / deferred — not session P1 blockers):

| Item | Status | Notes |
|------|--------|--------|
| Float money major units | **Open** | Public amounts are JS `number` major units (e.g. `10.5` SAR); no decimal money type — pass clean decimals only; avoid `0.1 + 0.2`-style float arithmetic as inputs |
| SDK `event.id` dedupe store | **Open (app-level)** | SDK normalizes provider event identity when available but does **not** persist or reject duplicate deliveries; handlers must be idempotent on `event.id` (or equivalent) |
| No `registerGateway` / open `GatewayName` | **Open** | Custom gateways require wrapping outside `PaymentClient`; closed `GatewayName` union — see `docs/custom-gateways.md` |
| Node multi-runtime CI | **Open** | CI builds with `--target node` and asserts `dist/index.js`; tests run under Bun — no separate Node runtime smoke matrix |
| Full Checkout field surface | **Open** | Stripe Checkout maps a practical subset of session fields; full Stripe Checkout API surface not mirrored 1:1 |
| OMR live confirm | **Open (ops)** | ISO exponent 3 implemented for OMR; live merchant-account confirmation remains ops-side |
| `PaymentClient` `defaultGateway` typing generics | **Open** | Runtime fail-fast if default not configured; not generic-constrained to configured gateways at the type level |
| PayPal local CRC32 / cert crypto verify | **Open** | Still API postback-only (`verifyWebhookAsync`); raw-body embed path landed; no offline CRC32/local cert verify |
| Vault / recurring / wallet standardization | **Open** | Roadmap (`tasks.md`) |
| MockProvider | **Open** | Not implemented |
| Stripe Connect / marketplace accounts | **Open** | Not modeled in the unified client |
| Moyasar `livemode` on `WebhookEvent` | **Done** | Set from envelope `live` in residual pass |
| Unknown gateway statuses → `pending` | **Done** | Residual pass: Moyasar (and aligned gateways) fail-closed / warn instead of silent pending fulfillment |
| Paymob intention `is_auth` flag | **Done** | Residual pass: `is_auth: true` when `capture === false`, plus `authIntegrationId` swap |
| `region: "pk"` | **Open (experimental)** | Kept for existing users; not on official Accept host list — prefer documented regions or explicit `baseUrl` |
| `AuthenticationError` HTTP 401 for card/3DS | **Open** | Can confuse middleware; left as-is (session targets map Stripe `authentication_required` away from this class where applicable) |
| Logger message-string redaction | **Open** | Key-based context redaction only — do not interpolate secrets into message strings (`docs/logging.md`) |
| Extra gateways (Tap, Noon, APS, …) | **Open** | Out of scope |
| Official provider SDK dependencies | **Open** | Gateways use `fetch` directly; no Stripe/PayPal official SDK dep |

---

## Files touched (remediation set)

```
.github/workflows/ci.yml
README.md
bun.lock
package.json
docs/custom-gateways.md
docs/hooks.md
docs/logging.md
docs/moyasar.md
docs/paymob.md
docs/paypal.md
docs/stripe.md
docs/webhooks.md
docs/AUDIT_FIXES.md          ← this file (session re-audit section + residual table)
docs/RESIDUAL_DEEP_AUDIT_GATE.md
resources/gateways/stripe/README.md
src/client.ts
src/client.test.ts
src/errors.ts
src/index.ts
src/gateways/base.gateway.ts
src/gateways/moyasar/*
src/gateways/paymob/*
src/gateways/paypal/*
src/gateways/stripe/*
src/hooks/hooks.manager.ts
src/hooks/hooks.types.ts
src/types/config.types.ts
src/types/moyasar-source.types.ts
src/types/payment.types.ts
src/types/validation.ts
src/types/webhook.types.ts
src/utils/currency.ts
src/utils/currency.test.ts
src/utils/idempotency.ts
src/utils/logger.ts
src/utils/retry.ts
src/utils/utils.test.ts
```

---

## How to re-verify locally

```bash
bun install
bun run typecheck
bun test
bun run build
test -f dist/index.js
```

---

## Suggested commit message (if committing)

```
fix: remediate production audit findings across core and gateways

Apply P0/P1 audit fixes: createPayment overload typing, Zod parsed.data,
Node-target publish build, Paymob secretKey post-pay auth, Stripe 3-decimal
and subscription webhook IDs, client OperationNotSupportedError, hook/webhook
isolation, Retry-After ceiling, Moyasar split major units, PayPal cert allowlist,
and docs parity. Post-gate: isolate onWebhookReceived; preserve composed after-hook
modifiedResult.
```
