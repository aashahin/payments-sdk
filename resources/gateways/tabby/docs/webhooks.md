# Webhooks

The detailed information on why and how to implement the Webhooks.

## What are the Webhooks

[Tabby Webhooks](https://docs.tabby.ai/api-reference/webhooks) are user-defined HTTPs callbacks. Tabby uses Webhooks as a way to notify you about any payment-related or token-related events. A webhook endpoint is the URL that you use to listen to the callbacks. Once you register a URL as a Webhook endpoint, Tabby will send notifications to that URL whenever an event related to your account occurs.

## How do they work

1. [Registration process](https://docs.tabby.ai/api-reference/webhooks/register-a-webhook) should be done only once for one store country (based on `merchant_code`).  
   Use a `secret_key` with `merchant_code` and define a URL for the Webhooks receiving. The boolean parameter `is_test` helps you to identify the operational environment. An arbitrary auth header can optionally sign the request if you set it up.

2. Once the Webhooks are registered, you will receive notifications from us as soon as [one of the events happens](#supported-events). We notify you when the payment status changes.

3. You need to confirm the reception of a Webhook by returning a 200 HTTP status code. Check the auth header to verify the authenticity of the request. No response or a response other than 200 indicates an error to Tabby.

## Payload

Tabby Webhooks are POST-requests formatted as JSON which we sent to the registered URL. Find the example of the payload that you will receive:

```json
{
  "id": "string",
  "created_at": "2021-09-14T13:08:54Z",
  "expires_at": "2022-09-14T13:08:54Z",
  "closed_at": "2021-09-14T13:09:45Z",
  "status": "closed", 
  "is_test": false,
  "is_expired": false,
  "amount": "100",
  "currency": "SAR",
  "order": {
    "reference_id": "string"
  },
  "captures": [
    {
      "id": "string",
      "amount": "100",
      "created_at": "2021-09-14T13:09:45Z",
      "reference_id": "string"
    }
  ],
  "refunds": [
    {
      "id": "string",
      "amount": "100",
      "created_at": "2021-09-14T14:14:02Z",
      "reference_id": "string",
      "reason": "string"
    }
  ],
  "meta": {
    "order_id": null,
    "customer": null
  },
  "token": "string"
}
```

## Supported Events

It is important to note here that the content of the Webhooks will be based on the event we notify you about.

| Event | Webhook payment status | Webhook payload update |
|-------|------------------------|------------------------|
| Authorize | authorized | "status": "authorized" |
| Capture | authorized | capture info is added to captures.[] array |
| Close | closed | "status": "closed" and "closed_at" updated |
| Reject | rejected | "status": "rejected" |
| Expire (Optional) | expired | "status": "expired", "expired_at" and "is_expired" updated |
| Refund | closed | refund info is added to refunds.[] array |
| Update | the same as before the Update Request | order.reference_id updated |

You can request the Tabby team to configure an "expire" event for your store to get notifications about payment statuses "expired" - in case the customer's payment is canceled or it expires.

## Webhook Order and Actions Required

Assuming that you registered Tabby Webhooks for one URL (**4 URLs is the limit**), you will get three notifications for each payment:

1. When the payment gets authorized by Tabby, you receive the first Webhook, the status in the payload will be sent as `"authorized"`. That's a signal for you to check the order status and process it if it wasn't done yet. Then you can send us a Capture Request.

2. As soon as the capture happens, you will receive the Webhook also in the status `"authorized"`. This notification has the information about your captures. **No actions** from your side are necessary.

3. Another Webhook notification will come as soon as the status of the payment will be changed to `"CLOSED"`. It means that the payment is completed and confirmed from both sides. The payment status in the payload will be also sent as `"closed"`. **No actions** from your side are necessary.

It is an expected behaviour that webhooks return payment status in lower case - e.g., `"authorized"` - while [Retrieve Request](https://docs.tabby.ai/api-reference/payments/retrieve-a-payment) - in upper case: `"AUTHORIZED"`.

Webhooks are asynchronous, their order is not guaranteed, and idempotency might lead to a duplicate notification of the same event type.

### Recommendations

We recommend here:

- **Filter the notifications** and only process the Webhooks that you want. It is important as you automatically receive notifications for all payment events. Whitelist Tabby Server IP-addresses:

  ```
  34.166.36.90
  34.166.35.211
  34.166.34.222
  34.166.37.207
  34.93.76.191
  ```

- **Configure your system to handle the scenario with the asynchronous order**. There is no guarantee the Webhooks will come in any particular order. For example, a capture event might be delivered after an authorization event for some payments. You can use a Finite State Machine or other logic.

- **Configure the system to ignore multiple copies** of the same Webhook notification if the first copy is already processed.

To test and debug the webhooks, you can use a [Webhook.site](https://webhook.site/) tool where you can see the payload and header Tabby sends to your endpoint once webhook is triggered.

## Retry Attempts

We timeout a webhook request after a certain period of time (1 minute) and then attempt to resend it 4 more times.

To avoid this, we recommend asynchronously process the webhooks by responding right away acknowledging the request rather than waiting until the webhook is processed.

If a webhook has no 200 response, we also resend it up to 4 more times. There is an exponential interval between attempts (1-4 minutes).

While we are processing retry attempts, Tabby continues processing and sending the webhook notifications for other payment events as they occur.