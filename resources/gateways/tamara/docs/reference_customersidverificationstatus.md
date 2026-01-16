## Parameters

| Name | Type | Attributes | Description | Default | Allowed Values |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `phone_number` | string | required | | 966544337766 | |
| `country_code` | string | enum, required | The unique ISO country code for the country that the phone number owner is located in | SA | SA, AE |

***

## Response Schema

**object**

| Name | Type |
| :--- | :--- |
| `is_id_verified` | boolean |

***

*Updated 6 months ago*

---

## Example Request

```bash
curl --request GET \
  --url 'https://api-sandbox.tamara.co/merchants/customer/id-verification-status?phone_number=966544337766&country_code=SA' \
  --header 'accept: application/json'
```

Click `Try It!` to start a request and see the response here! Or choose an example: application/json

***

*Updated 6 months ago*

---

**Related:**
* [Create In-store Checkout Session](/reference/createinstorecheckoutsession)

Did this page help you?