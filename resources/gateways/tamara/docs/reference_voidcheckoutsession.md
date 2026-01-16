| Name | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `checkout_id` | string | Yes | `ff776045-513b-4cd7-8b4f-e60673daad84` | Unique Tamara `checkout_id`, obtained from the response of create checkout/in-store checkout session endpoint. |
| `order_id` | uuid | Yes | `2aa3d561-40a7-4150-a669-5e5852b04d5e` | Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint. |
| `store_code` | string | No | `Branch A` | The unique store code/name from which request is called |

## Response Schema

The response is an `object`.

*   `order_was_voided` (boolean)
*   `captured_amount` (array of objects)
    *   **captured_amount object:**
        *   `amount` (number)
        *   `currency` (string, enum)
            *   **Values:** `SAR`, `AED`, `KWD`, `BHD`, `OMR`
        *   `message` (string)
        *   `store_code` (string)

***

*Updated 6 months ago*

*   [Create Checkout Session](/reference/createcheckoutsession)
*   [Create In-store Checkout Session](/reference/createinstorecheckoutsession)

***

Did this page help you?

```bash
curl --request POST \
  --url 'https://api-sandbox.tamara.co/checkout/ff776045-513b-4cd7-8b4f-e60673daad84/void?order_id=2aa3d561-40a7-4150-a669-5e5852b04d5e&store_code=Branch%20A' \
  --header 'accept: application/json'
```

Click `Try It!` to start a request and see the response here! Or choose an example:

application/json

*Updated 6 months ago*

***

*   [Create Checkout Session](/reference/createcheckoutsession)
*   [Create In-store Checkout Session](/reference/createinstorecheckoutsession)

Did this page help you?