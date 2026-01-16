> ❗️ **If you are integrating with us in the UAE region, please ensure to review the documentation here:** [UAE ID Verification](/docs/uae-id-verification)
>
> 📘 **For critical lines of businesses, please ensure to review the documentation here:** [Specific details for risk assessment](/docs/additional-customer-details-for-risk-assessment#/)

## Request Body Parameters

| Parameter | Type | Required | Description | Default | Constraints |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `total_amount` | object | required | Total amount to be charged to consumer. | | |
| `shipping_amount` | object | required | Total amount for the shipping of the order. | | |
| `tax_amount` | object | required | Total amount of taxes, if additionally applied. | | |
| `order_reference_id` | string | required | Unique order ID from the merchant's side, which will be used for settlement and reporting purposes. Can be modified after the checkout session is created. | `abd12331-a123-1234-4567-fbde34ae` | |
| `order_number` | string | optional | The order number from the merchant side, this will be used for communication with the customer. If this value is not passed, the order_number will take the order_reference_id value. | `A123125` | |
| `discount` | object | optional | This object is used to mention any customer-specific discount/voucher code being used for this specific order, but not to be used for site-wide discounts. | | |
| `items` | array of objects | required | | `[object Object]` | |
| `consumer` | object | required | The customer's identifying details. | | |
| `country_code` | string (enum) | required | The two-character ISO 3166-1 country code | `SA` | Allowed: `SA`, `AE`, `BH`, `KW`, `OM` |
| `description` | string | required | The order description. | `Enter order description here.` | ≤ 256 |
| `merchant_url` | object | required | This object includes all the redirect URLs that the customer will be redirected to from the Tamara checkout page in different cases. | | |
| `billing_address` | object | optional | The customer's billing address, if any. | | |
| `shipping_address` | object | required | | | |
| `platform` | string | optional | Mentions the platform where the Tamara order is being initiated from (Mostly used by our e-commerce plugins) but can also be used by direct integrations. | `platform name here` | |
| `is_mobile` | boolean | optional | To identify mobile users of your store. | `false` | Allowed: `true`, `false` |
| `locale` | string (enum) | optional | Display language for Tamara checkout page. Language to be defined by the merchant following RFC 1766, e.g en\_US or ar\_SA. Default is set to Arabic if not passed and customer is new. If customer already exists and locale is not passed then customer's preference will be taken into account. | `ar_SA` | Allowed: `ar_SA`, `en_US` |
| `risk_assessment` | object | optional | Risk assessment info from the merchant side | | |
| `expires_in_minutes` | integer | optional | Order expiry time in minutes, min 5 minutes, max 1440 (one day). By default this key will be ignored, and default value of 30 mins is used, **Please contact our support team to enable this feature**. | | 5 to 1440 |
| `additional_data` | object | optional | Any additional order data information from the merchant side | | |

### Items (Array of Objects)

| Parameter | Type | Required | Description | Default | Constraints |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `name` | string | required | Product name. `<span class="inline-code">&lt;=255 characters</span>`. | `Lego City 8601` | ≤ 255 |
| `quantity` | number | required | The quantity being purchased for this specific item. | `1` | |
| `reference_id` | string | required | The unique id of the item from merchant's side | `123` | |
| `type` | string | required | | `Physical` | |
| `sku` | string | required | Product SKU. **`<= 128 characters`** | `SA-12345` | ≤ 128 |
| `item_url` | uri | optional | URL of the item from merchant's website. **`<= 1024 characters`** | `https://item-url.com/1234` | ≤ 1024 |
| `image_url` | uri | optional | URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br> **Size** = 2-3 MB maximum <br> **Resolution** WxH = 1024xY (the Y height of image should be small). | `https://image-url.com/1234` | ≤ 1024 |
| `unit_price` | object | optional | | | |
| `tax_amount` | object | optional | | | |
| `discount_amount` | object | optional | | | |
| `total_amount` | object | required | | | |

---

## Example Request

```bash
curl --request POST \
  --url https://api-sandbox.tamara.co/checkout \
  --header 'accept: application/json' \
  --header 'content-type: application/json' \
  --data '{
 "total_amount": {
 "amount": 300,
 "currency": "SAR"
 },
 "shipping_amount": {
 "amount": 1,
 "currency": "SAR"
 },
 "tax_amount": {
 "amount": 1,
 "currency": "SAR"
 },
 "order_reference_id": "abd12331-a123-1234-4567-fbde34ae",
 "order_number": "A123125",
 "discount": {
 "name": "Voucher A",
 "amount": {
 "amount": 0,
 "currency": "SAR"
 }
 },
 "items": [
 {
'
# ... Request body truncated
```

---

*Updated 17 days ago*

---
Wondering about next steps? Check the APIs below to continue your journey

* [Authorise Order](/reference/authoriseorder)
* [Cancel Order](/reference/cancel_order)
* [Capture Order](/reference/captureorder)
* [Get Order Details APIs](/reference/get-order-details-apis)
* [Update order\_reference\_id](/reference/updateorderreferenceid)
* [Simplified Refund](/reference/simplifiedrefund)

Did this page help you?