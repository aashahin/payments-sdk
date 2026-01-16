### Request Parameters

| Name | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **amount** | object | Yes | | Total amount to be charged to consumer. |
| **order\_reference\_id** | string | No | `1231234123-234a-fe21-1234-a324af2` | The unique order id from merchant side, this will be used with the settlement and reports. |
| **order\_number** | string | No | `A1231234123` | Unique order ID from the merchant's side, which will be used for settlement and reporting purposes. Can be modified after the checkout session is created. |
| **locale** | string (enum) | No | `ar_SA` | Display language for Tamara checkout page. Language to be defined by the merchant following RFC 1766, e.g `en_US` or `ar_SA`. Default is set to Arabic if value not passed and customer is new. If customer already exists and locale is not passed then customer's preference will be taken into account. **Allowed:** `ar_SA`, `en_US` |
| **additional\_data** | object | No | | Additional order data information from the merchant side. |

### Request Headers

| Name | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| **X-Device-Id** | string | Yes | This is an identifier of your POS devices, e.g. 123456 |

### Response Schema

(Inferred section based on HTML structure)

| Name | Type |
| :--- | :--- |
| `checkout_id` | uuid |
| `order_id` | uuid |
| `checkout_deeplink` | string |

### Example Request

```bash
curl --request POST \
  --url https://api-sandbox.tamara.co/checkout/in-store \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '
{
 "amount": {
 "amount": 300,
 "currency": "SAR"
 },
 "order_reference_id": "1231234123-234a-fe21-1234-a324af2",
 "order_number": "A1231234123",
 "locale": "ar_SA",
 "additional_data": {
 "store_code": "Branch A"
 }
}
'
```

---
*Updated 6 months ago*