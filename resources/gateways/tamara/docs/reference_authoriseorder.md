> 📘 If an order is not Captured within 21 days from when it is Authorised, Tamara will auto-capture that order and it will be moved to Fully Captured status

## Request Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `order_id` | `uuid` | required | `ff776045-513b-4cd7-8b4f-e60673daad84` | Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint. |

---

## Response Schema

**Root (`object`)**

| Field | Type | Description |
| :--- | :--- | :--- |
| `order_id` | `uuid` | |
| `status` | `string` | |
| `order_expiry_time` | `string` | |
| `payment_type` | `string` (enum) | Values: `PAY_BY_INSTALMENTS`, `PAY_NOW` |
| `auto_captured` | `boolean` | |
| `capture_id` | `uuid` | |
| `authorized_amount` | `array of objects` | |

**`authorized_amount` (`object`)**

| Field | Type | Description |
| :--- | :--- | :--- |
| `amount` | `number` | |
| `currency` | `string` (enum) | Values: `SAR`, `AED`, `KWD`, `BHD`, `OMR` |

---

*Updated about 1 month ago*

### Example Request

```bash
curl --request POST \
  --url https://api-sandbox.tamara.co/orders/ff776045-513b-4cd7-8b4f-e60673daad84/authorise \
  --header 'accept: application/json'
```

Click `Try It!` to start a request and see the response here! Or choose an example:
`application/json`

---
*Updated about 1 month ago*

* [Cancel Order](/reference/cancelorder)
* [Capture Order](/reference/captureorder)