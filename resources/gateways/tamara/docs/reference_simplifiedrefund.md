## Request Parameters

| Name | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **order_id** | uuid | Yes | `ff776045-513b-4cd7-8b4f-e60673daad84` | Unique Tamara `order_id` from the response of the creation of the checkout session whether online or in-store. |
| **total_amount** | object | Yes | | Total amount to be refunded to consumer, not including any discount amount. |
| **comment** | string | Yes | `Refund for the order A123` | Notes or comments as a reference point that will be added to this order's transaction history. |
| **merchant_refund_id** | string | No | | Used to input the merchant's own internal refund ID, if any, to be stored on the refund request and order details. |

***

## Response Schema

```object
{
  "order_id": "uuid",
  "comment": "string",
  "refund_id": "uuid",
  "capture_id": "uuid",
  "status": "string",
  // Enum values: fully_refunded, partially_refunded
  "refunded_amount": [
    {
      "amount": "number",
      "currency": "string"
      // Enum values: SAR, AED, KWD, BHD, OMR
    }
  ]
}
```

***

## Example Request

```bash
curl --request POST \
 --url https://api-sandbox.tamara.co/payments/simplified-refund/ff776045-513b-4cd7-8b4f-e60673daad84 \
 --header 'accept: application/json' \
 --header 'content-type: application/json' \
 --data '
{
 "total_amount": {
 "amount": 300,
 "currency": "SAR"
 },
 "comment": "Refund for the order A123"
}
'
```

***

*Updated 6 months ago*

### Related Pages
* [Create In-store Checkout Session](/reference/createinstorecheckoutsession)
* [Create Checkout Session](/reference/createcheckoutsession)