> 📘 If an order is not Captured within 21 days from when it is Authorised, Tamara will auto-capture that order and it will be moved to Fully Captured status

## Request Body Schema

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **order_id** | `uuid` | Yes | `8fe4cce9-d0aa-4020-a863-c708547795e9` | Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint. |
| **total_amount** | `object` | Yes | | Total amount to be captured out of the original order total. |
| **shipping_info** | `object` | Yes | | |
| **items** | `array of objects` | No | `[object Object]` | |
| **discount_amount** | `object` | No | | |
| **shipping_amount** | `object` | No | | Total amount for the shipping of the order. |
| **tax_amount** | `object` | No | | Total amount of taxes, if additionally applied. |

### items (Array of objects)

| Parameter | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| **name** | `string` | Yes | ≤ 255 | Product name. `<=255 characters`. |
| **quantity** | `number` | Yes | | The quantity being fulfilled for this specific item. |
| **reference_id** | `string` | Yes | | The unique id of the item from merchant's side |
| **sku** | `string` | Yes | ≤ 128 | Product SKU. **`<= 128 characters`** |
| **item_url** | `uri` | No | ≤ 1024 | URL of the item from merchant's website. **`<= 1024 characters`** |
| **image_url** | `uri` | No | ≤ 1024 | URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br> **Size** = 2-3 MB maximum <br> **Resolution** WxH = 1024xY (the Y height of image should be small). |
| **unit_price** | `object` | No | | |
| **tax_amount** | `object` | No | | |
| **discount_amount** | `object` | No | | |
| **total_amount** | `object` | Yes | | |
| **type** | `string` | Yes | | |

---

## Response Schema

(Root Object)

| Parameter | Type | Description |
| :--- | :--- | :--- |
| **capture_id** | `uuid` | |
| **order_id** | `uuid` | |
| **status** | `string` (enum) | `fully_captured`, `partially_captured` |
| **captured_amount** | `array of objects` | |

### captured_amount (Array of objects)

| Parameter | Type | Description |
| :--- | :--- | :--- |
| **amount** | `number` | |
| **currency** | `string` (enum) | `SAR`, `AED`, `KWD`, `BHD`, `OMR` |

---

## Example Request

```bash
curl --request POST \
  --url https://api-sandbox.tamara.co/payments/capture \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '
{
  "order_id": "8fe4cce9-d0aa-4020-a863-c708547795e9",
  "total_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "shipping_info": {
    "shipped_at": "2020-03-31T19:19:52.677Z",
    "shipping_company": "DHL",
    "tracking_number": "100",
    "tracking_url": "https://shipping.com/tracking?id=123456"
  },
  "items": [
    {
      "name": "Lego City 8601",
      "type": "Digital",
      "reference_id": "123",
      "sku": "SA-12436",
      "quantity": 1,
      "discount_amount": {
        "amount": 100,
        "currency": "SAR"
      },
      "tax_amount": {
'
```

---

*Updated about 2 months ago*

*Related:*
* [Simplified Refund](/reference/simplifiedrefund)