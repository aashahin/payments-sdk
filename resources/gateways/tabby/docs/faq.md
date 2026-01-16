# F.A.Q.

This page gives you answers to the most common questions about Tabby operating.

---

## Where can I see if Tabby is working normally?

**Status Page Recommendations.** Associated article: [Technical Requirements → Status Page](https://docs.tabby.ai/introduction/technical-requirements#status-page).

Recommendations for status page maintenance and incidents:

- Tabby sends alerts through <https://www.tabby-status.com/>. Please, subscribe using your preferred channel for updates.
- Tabby posts alerts manually in real-time within 5-10 minutes of identifying and confirming an issue. The alerts provide details about the affected systems.
    - If Checkout or Payments APIs are affected for all countries, we recommend disabling Tabby until the next message confirms the resolution.
    - If only one country is affected, you can disable Tabby for that specific country.
    - If non-real-time systems are affected, no action is required (incident details will still be posted).
    - If you see a Scheduled Technical Maintenance notification, you can plan disabling Tabby for that duration of the maintenance window or mute monitors if the expected timeframe is less than 10 minutes, as it will recover automatically.
- If you suspect an issue with any flow, you can contact Tabby Partner Support `[email protected]` for more details. However, if you observe that Tabby APIs are not working (e.g., consistently returning 5xx or 4xx errors), please contact the Tabby Integrations Team via the integration thread or via your assigned business manager immediately to investigate and resolve the issue. In the meantime, disable Tabby until the issue is resolved.

---

## Does Tabby provide any sandbox environment for testing?

Tabby provides a single environment for both integration and live launch at `api.tabby.ai`. Payments can be created:

- In test mode using **Test API keys** from merchants' DEV and Stage environments
- In live mode using **Live API keys**. Live keys are shared after development is completed and QA by Tabby team is done and confirmed.

Checkout, Payments and Webhooks are available for both test and live payments, while Disputes are supported for live payments only.

---

## Where can I find credentials to use Tabby?

### Live Credentials

Live API keys can be obtained:

- From Tabby Merchant Dashboard for **Self-Hosted plugin** integration listed in the Quick Start section.
- By contacting Tabby account manager after QA testing carried out by Tabby team is completed for **Custom API** integration. Also refer to [Test Credentials](#test-credentials).

If the credentials are missing or wrong, Tabby will respond with `401 Not authorized`. Error codes for a session creation request can be found here: [Session Creation Error Codes](https://docs.tabby.ai/api-reference/checkout/create-a-session).

In this case kindly contact Tabby Partner Support at `[email protected]` or reach out to your assigned Business Manager. When doing so, kindly include:

1. Your store name as registered with Tabby
2. Your integration details:
    - Website URL or app name (for online integrations)
    - Description of offline integration, if applicable

### Test Credentials

To test your custom integration with Tabby you need to use the following:

- Your testing keys, starting with `pk_test / sk_test`
- Download the Postman API Collection from here: [Postman API Collection](https://docs.tabby.ai/testing-guidelines/postman-api-collections)
- Or use Tabby endpoints provided here: [API Playground](https://docs.tabby.ai/api-reference/)

Tabby identifies live or test environment based on the keys used. The endpoints for test are the same as for live.

- Review the [Full Testing Checklist](https://docs.tabby.ai/pay-in-4-custom-integration/full-testing-checklist)
- Check the Testing Scenarios based on your type of integration:
    - Online Custom integration: [Testing Scenarios for Online Custom Integration](https://docs.tabby.ai/testing-guidelines/testing-credentials)
    - Offline Integrations → POS: [Testing Scenarios for POS](https://docs.tabby.ai/offline-payment-methods/pos-integration#testing-scenarios)
    - Offline Integrations → Custom Payment Links: [Testing Scenarios for Custom Payment Links](https://docs.tabby.ai/offline-payment-methods/custom-payment-links#testing-scenarios)

---

## How can I verify Payments via Webhooks?

Main article: [Webhooks](https://docs.tabby.ai/pay-in-4-custom-integration/webhooks).

There are 3 ways to secure the Webhook notifications:

- Whitelist IP-addresses for Webhooks:

```
34.166.36.90
34.166.35.211
34.166.34.222
34.166.37.207
34.93.76.191
```

- Add static `AUTH HEADER` during webhook registration: <https://docs.tabby.ai/api-reference/webhooks/register-a-webhook>
- Webhooks should be treated as notifications only. To verify the payment status, use the `payment_id` from the webhook and call the getPayment API: <https://docs.tabby.ai/api-reference/payments/retrieve-a-payment>

---

## What should I do if Payments remain in status NEW in Tabby Merchant Dashboard?

Associated articles:
- [Payment Statuses](https://docs.tabby.ai/pay-in-4-custom-integration/payment-statuses)
- [Payment Processing](https://docs.tabby.ai/pay-in-4-custom-integration/payment-processing)

### Self-Hosted Platforms

Self-Hosted Platforms are: **WooCommerce, Shopify, Magento 2, OpenCart**.

These payments are likely lost (not linked to any created order). Merchants should select one of the options:

- Either cancel them (i.e., refund the customer): <https://docs.tabby.ai/api-reference/payments/close-a-payment>
- Or manually create an order for such payments, as they are authorized by Tabby, and capture payments: <https://docs.tabby.ai/api-reference/payments/capture-a-payment>
- Or just capture them if the orders exist.

Additionally, merchants should update the plugin to the latest version (following Tabby documentation) and check the plugin settings to prevent similar cases in the future.

### Zid and Salla Platforms

By default, everything is expected to be working successfully when live keys are saved. If you suspect an issue or have lost orders, kindly re-save the keys and contact your platform's support team to verify the situation or register webhooks to prevent such issues.

### Custom (Direct API) Integrations

Merchants may have immediate or delayed captures, meaning `NEW` statuses may simply be waiting for merchant action. However, in many cases, these payments are also lost.

Merchants should select one of the options:

- Either cancel them (i.e., refund the customer): <https://docs.tabby.ai/api-reference/payments/close-a-payment>
- Or manually create an order for such payments, as they are authorized by Tabby, and capture payments: <https://docs.tabby.ai/api-reference/payments/capture-a-payment>
- Or just capture them if the orders exist.

Merchants should also check payment logs and investigate integration issues to determine why the payment wasn't acknowledged or captured in time (following Tabby documentation).

The Integrations team can assist with investigating API calls and webhooks - kindly contact them via the integrations thread or an assigned business manager.

### Tabby Card and Payment Links

These are always expected to be Auto-Captured. If they are not - kindly provide your store name with Tabby to Tabby Partner Support `[email protected]` or to your assigned business manager.

---

## What is the difference between Close and Capture API calls?

The main difference between these API calls is that when the **CLOSE** API call is used - you cancel the payment from your side, and Tabby will not release funds to you.

However, when you use **CAPTURE** API call - you confirm all is good with the order from your side, Tabby will release funds to you.

- **Close API call** cancels the payment without capturing it. The downpayment is returned to the customer, the payment gets status `CANCELLED` on Tabby Merchant Dashboard: <https://docs.tabby.ai/api-reference/payments/close-a-payment>
- **Capture API call** captures the payment, the payment gets status `CAPTURED` on Tabby Merchant Dashboard: <https://docs.tabby.ai/api-reference/payments/capture-a-payment>

---

## How can I know that a customer is not eligible to use Tabby?

In the Tabby Session creation response, you can receive a status like this if a customer is not eligible to use Tabby:

```json
"status": "rejected",
"configuration"."products"."installments"."rejection_reason": "not_available"
```

You need to hide Tabby payment option or show it with the General Rejection message or specific reason message depending on the `"rejection_reason"` value:

| Reason | English | Arabic |
|--------|---------|--------|
| General Rejection (`not_available`) | Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order. | نأسف، تابي غير قادرة على الموافقة على هذه العملية. الرجاء استخدام طريقة دفع أخرى. |
| `order_amount_too_high` | This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method | قيمة الطلب تفوق الحد الأقصى المسموح به حاليًا مع تابي. يُرجى تخفيض قيمة السلة أو استخدام وسيلة دفع أخرى. |
| `order_amount_too_low` | The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method | قيمة الطلب أقل من الحد الأدنى المطلوب لاستخدام خدمة تابي. يُرجى زيادة قيمة الطلب أو استخدام وسيلة دفع أخرى. |

---

## Is it possible to know the rejection reason for payments in status REJECTED?

Unfortunately, due to compliance and regulatory restrictions, Tabby is not permitted to disclose the specific rejection reasons to merchants. Customers, however, typically see a rejection message on the Tabby-hosted payment page at the time of the transaction.

If you suspect a technical issue that may be causing multiple or all transactions to be rejected - please, contact Tabby Partner Support at `[email protected]` or reach out to your assigned Business Manager. When doing so, kindly include:

1. Your store name as registered with Tabby
2. Your integration details:
    - Website URL or app name (for online integrations)
    - Description of offline integration, if applicable

---

## Are there any transaction limits set for my store from Tabby side?

Tabby applies transaction limits based on a combination of factors, including your industry and associated risk levels. Additionally, customer-level limits are dynamically determined based on their historical transaction behaviour with your store and with other merchants using Tabby.

For this reason, we recommend **not setting hardcoded limits** for Tabby transactions on your end, as these may conflict with Tabby's dynamic risk and approval models.

---

## What should I do if a customer is not redirected back to the website?

When customers finish the Tabby session, they are redirected back to your site from the Tabby Payment Page via one of the three `merchant_urls`, with the `payment_id` after the separator, e.g. `https://your-store/success?payment_id=string`:

```json
"merchant_urls": {
  "success": "https://your-store/success",
  "cancel": "https://your-store/cancel",
  "failure": "https://your-store/failure"
}
```

The `merchant_urls` should be included in a [Session Creation request](https://docs.tabby.ai/api-reference/checkout/create-a-session#body-merchant-urls) sent to Tabby from your side.

---

## What should I do if my platform is not present in the list of supported platforms?

In such case the integration is considered an [Online Custom Integration](https://docs.tabby.ai/pay-in-4-custom-integration/quick-start) - kindly follow its integration guidelines.

---

## What should I do if I do not receive fields in a response from Tabby API?

If some fields do not return in the response:

- Check the endpoint used for the request
- Check the fields format in the request - they should match those specified in the [API Reference Documentation](https://docs.tabby.ai/api-reference/overview)
- Check responses in the [API Reference Documentation](https://docs.tabby.ai/api-reference/overview) and that these fields are expected to be returned

---

## General information

For additional support and information, you may also find helpful resources here: [Tabby Support Center](https://support.tabby.ai/l/en).