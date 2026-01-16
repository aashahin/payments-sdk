### Parameters

#### order\_id (`uuid`, required)
Defaults to `ff776045-513b-4cd7-8b4f-e60673daad84`

Unique Tamara `order_id` from the response of the creation of the checkout session whether online or in-store.

#### order\_reference\_id (`string`, required)
Defaults to `A1234`

---

### Response Schema

object

| Name | Type | Description |
| :--- | :--- | :--- |
| message | string | |

---

### Example Request

```bash
curl --request PUT \
 --url https://api-sandbox.tamara.co/orders/ff776045-513b-4cd7-8b4f-e60673daad84/reference-id \
 --header 'accept: application/json' \
 --header 'content-type: application/json' \
 --data '
{
 "order_reference_id": "A1234"
}
'
```

Click `Try It!` to start a request and see the response here! Or choose an example: `application/json`

---

*Updated 6 months ago*

Did this page help you?
---

*Updated 6 months ago*

Did this page help you?