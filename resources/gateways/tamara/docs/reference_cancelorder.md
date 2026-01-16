| Parameter | Type | Required | Constraints/Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `order_id` | `uuid` | Yes | Defaults to `ff776045-513b-4cd7-8b4f-e60673daad84` | Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint. |
| `total_amount` | `object` | Yes | | Total amount to be charged back to consumer. |
| `shipping_amount` | `object` | No | | Total amount for the shipping of the order. |
| `tax_amount` | `object` | No | | Total amount of taxes, if additionally applied. |
| `discount_amount` | `object` | No | | |
| `items` | `array of objects` | No | Defaults to `[object Object]` | List of items being canceled. |

### `items` object properties

| Parameter | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `string` | Yes | ≤ 255 | Product name. `<=255 characters` |
| `quantity` | `number` | Yes | | How many of this specific item is being purchased |
| `reference_id` | `string` | Yes | | The unique id of the item from merchant's side |
| `sku` | `string` | Yes | ≤ 128 | Product SKU. **`<= 128 characters`** |
| `item_url` | `uri` | No | ≤ 1024 | URL of the item from merchant's website. **`<= 1024 characters`** |
| `image_url` | `uri` | No | ≤ 1024 | URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`**. <br> **Size** = 2-3 MB maximum. <br> **Resolution** WxH = 1024xY (the Y height of image should be small). |
| `unit_price` | `object` | No | | |
| `tax_amount` | `object` | No | | |
| `discount_amount` | `object` | No | | |
| `total_amount` | `object` | Yes | | |
| `type` | `string` | Yes | | |

***

### Response Body (object)

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `cancel_id` | `uuid` | |
| `order_id` | `uuid` | |
| `status` | `string` (enum) | `updated`, `canceled` |
| `canceled_amount` | `array of objects` | |

**`canceled_amount` properties (object)**

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `amount` | `number` | |
| `currency` | `string` (enum) | `SAR`, `AED`, `KWD`, `BHD`, `OMR` |

***

### Example Request

```bash
curl --request POST \
 --url https://api-sandbox.tamara.co/orders/ff776045-513b-4cd7-8b4f-e60673daad84/cancel \
 --header 'accept: application/json' \
 --header 'content-type: application/json' \
 --data '
{
 "total_amount": {
 "amount": 300,
 "currency": "SAR"
 },
 "shipping_amount": {
 "amount": 0,
 "currency": "SAR"
 },
 "tax_amount": {
 "amount": 100,
 "currency": "SAR"
 },
 "discount_amount": {
 "amount": 10,
 "currency": "SAR"
 },
 "items": [
 {
 "name": "Lego City 8601",
 "type": "Digital",
 "reference_id": "123",
 "sku": "SA-12436",
 "quantity": 1,
```

***

*Updated 6 months ago*

---
- [Capture Order](/reference/captureorder)

Did this page help you?

***

*Updated 6 months ago*

---
- [Capture Order](/reference/captureorder)

Did this page help you?