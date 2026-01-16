## Request Body Schema

| Name | Type | Required | Default | Constraints / Description |
| :--- | :--- | :--- | :--- | :--- |
| `total_amount` | object | required | | Total amount to be charged to consumer. |
| `phone_number` | string | required | `534274516` | The customer's phone number, on which the customer will receive an SMS containing a payment link. This will be used to complete the transaction via Tamara. |
| `email` | string | | `customer@emailhere.com` | The customer's email address, designated to receive the payment link. Serves as a backup option in case of mobile coverage issues affecting the phone number. |
| `order_reference_id` | string | required | `1231234123-234a-fe21-1234-a324af2` | The unique order id from merchant side, this will be used with the settlement and reports |
| `order_number` | string | | `A1231234123` | Unique order ID from the merchant's side, which will be used for settlement and reporting purposes. Can be modified after the checkout session is created. |
| `items` | array of objects | required | `[object Object]` | |
| &nbsp;&nbsp;&nbsp;&nbsp;`name` | string | required | | Product name. `<=255 characters`. (Max Length: 255) |
| &nbsp;&nbsp;&nbsp;&nbsp;`quantity` | number | required | | How many of this specific item is being purchased |
| &nbsp;&nbsp;&nbsp;&nbsp;`type` | string | required | `Physical` | |
| &nbsp;&nbsp;&nbsp;&nbsp;`reference_id` | string | required | | The unique id of the item from merchant's side |
| &nbsp;&nbsp;&nbsp;&nbsp;`sku` | string | required | | Product SKU. **`<= 128 characters`** (Max Length: 128) |
| &nbsp;&nbsp;&nbsp;&nbsp;`item_url` | uri | | | URL of the item from merchant's website. **`<= 1024 characters`** (Max Length: 1024) |
| &nbsp;&nbsp;&nbsp;&nbsp;`image_url` | uri | | | URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br> **Size** = 2-3 MB maximum <br> **Resolution** WxH = 1024xY (the Y height of image should be small). (Max Length: 1024) |
| &nbsp;&nbsp;&nbsp;&nbsp;`unit_price` | object | | | |
| &nbsp;&nbsp;&nbsp;&nbsp;`tax_amount` | object | | | |
| &nbsp;&nbsp;&nbsp;&nbsp;`discount_amount` | object | | | |
| &nbsp;&nbsp;&nbsp;&nbsp;`total_amount` | object | required | | |
| `locale` | string (enum) | | `ar_SA` | Display language for Tamara checkout page. Language to be defined by the merchant following RFC 1766, e.g `en_US` or `ar_SA`. Default is set to Arabic if value not passed and customer is new. If customer already exists and locale is not passed then customer's preference will be taken into account. | Allowed: `ar_SA`, `en_US` |
| `payment_type` | string (enum) | | `PAY_BY_INSTALMENTS` | The payment method offered by Tamara that you want to offer to your customer for this checkout session. | Allowed: `PAY_BY_INSTALMENTS`, `PAY_NOW` |
| `expiry_time` | integer | | | Order expiry time in minutes, min 5 minutes, max 1440 (one day). By default this key will be ignored, and default value of 15 mins is used, **Please contact our support team to enable this feature**. (Range: 5 to 1440) |
| `additional_data` | object | | | Additional order data information from the merchant side |

## Response Body Schema

| Name | Type | Description |
| :--- | :--- | :--- |
| `checkout_id` | uuid | |
| `order_id` | uuid | |
| `checkout_deeplink` | string | |

## Example Request (cURL)

```bash
curl --request POST \
 --url https://api-sandbox.tamara.co/checkout/in-store-session \
 --header 'accept: application/json' \
 --header 'content-type: application/json' \
 --data '
{
 "total_amount": {
 "amount": 300,
 "currency": "SAR"
 },
 "phone_number": "534274516",
 "email": "customer@emailhere.com",
 "order_reference_id": "1231234123-234a-fe21-1234-a324af2",
 "order_number": "A1231234123",
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
 "amount": 10,
 "currency": "SAR"
 },
 }
'
```

---
*Updated 6 months ago*

### Related Links
* [Void Checkout Session](/reference/voidcheckoutsession)
* [Get Order Details by Ref ID](/reference/getorderdetailsbyrefid)
* [Get Order Details by Tamara order_id](/reference/getorderdetails)
* [Register Webhook URL](/reference/registerwebhookurl)
* [Simplified Refund](/reference/simplifiedrefund)