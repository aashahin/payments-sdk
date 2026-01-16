🚀 Unified Payments SDK Roadmap

1. Core Architecture & Standardization

[x] Unified Interface Design: Finalize a standardized Request/Response schema across all providers.

[x] Error Normalization: Create a mapping system to convert gateway-specific codes into unified Error Classes (e.g., InsufficientFundsError).

[x] Webhook Engine: Implement a unified verifySignature utility for all integrated gateways.

[x] Idempotency Support: Add support for idempotency headers/keys to prevent duplicate transactions.

[x] Validation Layer: Implement Zod or similar validation for all input payloads before API dispatch.

2. Payment Gateway Integrations

Current Progress

[x] Research popular payment gateways

[x] Select gateways to integrate

[x] Implement integration for Moyasar

[x] Implement integration for Paymob

[x] Implement integration for Paypal

High Priority (Market Essentials)

[x] Stripe Implementation: PaymentIntents and Checkout Sessions implemented. Apple Pay connected via automatic methods.

[x] Tabby: Implement BNPL flow (requires itemized cart support).

[x] Tamara: Implement BNPL flow (requires itemized cart support).

[ ] Apple Pay & Google Pay: Standardize token handling for digital wallets across all MENA gateways.


Mid Priority

[ ] Tap Payments

[ ] Noon Pay

[ ] Amazon Payment Services (APS)

[ ] Fawry

Low Priority / Niche

[ ] Cryptomus (Crypto-specific flow)

[ ] Stc Pay (Direct integration or via existing aggregators)

3. Review & Quality Assurance

[x] Moyasar

[x] Paymob

[x] Paypal

[x] Stripe (Core & Checkout Verified)

[x] Tabby (Unit tests verified)

[x] Tamara

[ ] Cross-Gateway Consistency Check: Ensure all methods return identical data structures.

4. Testing & Reliability

[x] Moyasar (Sandbox testing)

[x] Paymob (Sandbox testing)

[x] Paypal (Sandbox testing)

[ ] Mocking Suite: Build a MockProvider for developers to test locally without API keys.

[ ] Integration Tests: Automated CI/CD tests against gateway sandbox environments.

[ ] Retry Logic: Implement exponential backoff for transient network errors.

5. Developer Experience (DX)

[ ] TSDoc Documentation: Add comprehensive inline documentation for all public methods.

[ ] Discriminated Unions: Refine types so that payment_method dictates required fields (e.g., card vs. bank_transfer).

[ ] Logging & Debug Mode: Add a configurable logger that redacts PII/Card data.

[ ] Example Projects: Create a examples/ directory for Express and Next.js integrations.

6. Maintenance & Ops

[ ] Rate Limit Handling (429 errors).

[ ] Multi-currency conversion logic (optional/internal).