# Payment Processing

The second part of the journey supposes the further payment processing in your OMS.

1. **Payment status Verification**  
   Verify the payment status after the customer's redirection with the [Retrieve Request](https://docs.tabby.ai/api-reference/payments/retrieve-a-payment).  
   Use the [Webhooks](/pay-in-4-custom-integration/webhooks) or set up Cron job to avoid missing payments.

2. **Payment Capture**  
   Use [Capture Request](https://docs.tabby.ai/api-reference/payments/capture-a-payment) to acknowledge the payment authorization from your end. Only captured payments are settled to the merchants.

3. **Payment Refund**  
   Send [Refund Request](https://docs.tabby.ai/api-reference/payments/refund-a-payment) to initiate refunds.

## Payment Verification

Tabby requires payment verification from your side using [Retrieve Request](https://docs.tabby.ai/api-reference/payments/retrieve-a-payment) and [Webhooks](/pay-in-4-custom-integration/webhooks). Server-to-server verification makes payment processing reliable and safe.

Once the customer is redirected via the `Success URL`, call [Retrieve Request](https://docs.tabby.ai/api-reference/payments/retrieve-a-payment) using the `payment_id` received at [the previous step](/pay-in-4-custom-integration/checkout-flow#session-initiation). In the response you need to receive `"status": "AUTHORIZED"` to proceed with the order. In case of receiving any other status, an investigation is required.

Other Redirection URLs have the statuses `"REJECTED"` for `Failure URL` and `"EXPIRED"` for `Cancel URL` accordingly. If none of these events happen, the payment status also changes to `"EXPIRED"` after some timeout (30 minutes since creation).

[Webhooks](/pay-in-4-custom-integration/webhooks) are required for Corner Case support which means payment status change to `"AUTHORIZED"` without successful redirection or Webview event. This may happen due to network issues, early Checkout closing (browser page or mobile Webview), or other reasons. Once Tabby receives a downpayment confirmation, Tabby considers the payment successful and marks it as `"AUTHORIZED"`. Another way is to set up a Cron Job for retrieving non-completed payment statuses. Here are the usage tips:

### Webhooks

> Webhooks are sent based on the events regardless of the redirection: even when customer is not redirected to the Success URL, you will still receive a notification from Tabby.
>
> Once Webhook with the `"authorized"` status is received:
>
> - check if order is still pending and process it in your OMS;
> - make sure to complete the payment by Capturing it.
>
> If the order was already completed (e.g., after success redirection) or other status is received in the Webhook - no action is required. Do not forget to **notify customers** about successful order processing.  
> Customers also receive a payment confirmation from Tabby.

It is an expected behaviour that webhooks return `"authorized"` in lower case while [Retrieve Request](https://docs.tabby.ai/api-reference/payments/retrieve-a-payment) - in upper case: `"AUTHORIZED"`.

### Retrieve Request

> Alternative of the Webhooks is setting up a cron job for calling Retrieve request till the moment you receive status `Authorized` or one of the terminal statuses - `Rejected` or `Expired`. Status change can happen after customer's action or by timeout.

### Session Expiration and Status Changes

By default, Tabby session expires after **20 minutes** since creation and customer is not able to continue the session. This **session expiry timeout** can be reduced by the request from the Merchant side to your assigned business manager in the Integrations thread.

A payment status may change to `"EXPIRED"` after **session expiry timeout + 10 minutes** (20 + 10 by default). After that the payment will remain in status `"EXPIRED"`, no need to check it further.

The status should be checked every couple of minutes until receiving one of these statuses in the response:

- If the status is `"AUTHORIZED"`, you should process the order in your OMS and capture the payment.  
  Do not forget to **notify customers** about successful order processing even though customers receive a payment confirmation from Tabby and their bank.
- If the status is `"EXPIRED"` or `"REJECTED"`, you can cancel or delete the order in your OMS.

## Payment Capture

After you verify the status of the payment, you need to send a [Capture Request](https://docs.tabby.ai/api-reference/payments/capture-a-payment) from your OMS to acknowledge the order status to Tabby. We also verify the order amount in Capture request matches the payment amount.

You can't capture the order in any other status rather than `"AUTHORIZED"`. If you try to capture payment in status `"CREATED"`, `"EXPIRED"`, `"CLOSED"` or `"REJECTED"`, you will get a `400 error`.

[Capture Request](https://docs.tabby.ai/api-reference/payments/capture-a-payment) has no impact or charges on the customers loans. Once payment is captured, your order is considered successful. The amount in Capture Request should be equal to the total amount of the payment. Always check the Capture Request brings the 200 response and "CLOSED" as the payment status. If Capture Request doesn't respond with 200, please debug the issue reason.

Tabby Payments also support partial captures, however the best practice flow requires full capture after payment verification.

### Capture Idempotent Request

The API supports idempotency for safe retry requests without accidentally performing the same operation twice. When creating or updating an object, use an idempotency key. Then, if a connection error occurs, you can safely repeat the request without risk of creating a second object or performing the update twice.

To perform an idempotent request, add an additional parameter to the request:

```json
{
  "reference_id": "some_key"
}
```

### Capture Absence and Missing Payments Resolving

By default, Tabby requires immediate Capture after payment receives status `"AUTHORIZED"`. However, in some cases it may be delayed or not happen at all due to tech issues.

**Tabby tracks non-Captured payments**. If a payment isn't captured or isn't canceled within 21 days since authorization, Tabby automatically fully captures it, as in most cases capture is absent due to tech issues. Customers dispute and payment settlements to the merchants are allowed only for Captured payments.

All `"AUTHORIZED"` payments can be found in the Merchant Dashboard via filtering by the order status `"NEW"`. These payments must be resolved manually or by exporting as a CSV file with all payments. Tabby also notifies merchants if we observe any regular tech issues with the captures as non-Captured orders are considered missed until the status update.

## Payment Refund

Use a refund to return a payment to a customer. Refunds can be made by using [Refund Request](https://docs.tabby.ai/api-reference/payments/refund-a-payment) or in the [Merchant Dashboard](https://merchant.tabby.ai/).

There are two types of refunds you might need to process:

- **Full refund**. A full refund returns the total amount of the payment to the customer - it can only be performed once.
- **Partial refund**. A partial refund returns a sum less than the captured amount. A payment can be refunded multiple times, but cannot exceed the original captured amount.

Refunds are always processed in the same currency as the captured payment. To process a refund successfully, you must provide the amount and payment ID of the original payment. The requests are the same for partial and full refunds. Any refunds for less than the original captured amount will be considered partial refunds.

You cannot cancel a refund after it has been processed.

Refunds can be initiated within 45 days from the payment creation.

### Refund Idempotent Request

The API supports idempotency for safe retry requests without accidentally performing the same operation twice. When creating or updating an object, use an idempotency key. Then, if a connection error occurs, you can safely repeat the request without risk of creating a second object or performing the update twice.

To perform an idempotent request, add an additional parameter to the request:

```json
{
  "reference_id": "some_key"
}
```

### Refunds Troubleshooting

If your refund request was unsuccessful (didn't respond with 200), please debug this case, the checklist below may help you identify the problem:

- If the payment status `"CLOSED"`?
- Is the refund amount higher than the original payment amount?
- Is the refund amount higher than the captured amount?
- Has the payment already been refunded?
- Does the amount format follow the [requirements](/introduction/technical-requirements#amount)?