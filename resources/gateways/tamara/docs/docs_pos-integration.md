*Screenshots and flow above are for demonstration purposes only.*

Your POS/ERP software should be updated to add **Tamara** as a payment option for your customers.

> 🚧 **This page is a high-level explanation only.**
>
> Consult the [API References](/reference) for further details on how to use our APIs properly.

# Step 1: Add items to cart and choose Tamara as a payment method

When a customer decides to pay through **Tamara**, your server would need to create an in-store checkout session by using the **[Create In-store Checkout Session API](/reference/createinstorecheckoutsession)** that sends customer an SMS with checkout URL/payment link.

### Endpoint

```
post      /checkout/in-store-session
```

### Sample Request

```json
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
      "unit_price": {
        "amount": 490,
        "currency": "SAR"
      },
      "total_amount": {
        "amount": 100,
        "currency": "SAR"
      }
    }
  ],
  "locale": "ar_SA",
  "payment_type": "PAY_BY_INSTALMENTS",
  "additional_data": {
    "store_code": "Branch A"
  }
}
```

The response of this API returns a unique `order_id` and a `checkout_id` for completing the transaction. Please store them as they are required for the subsequent steps.

### Sample Response

```json
{
  "checkout_id": "34c4d9db-d56a-4155-8750-9281ac0f9ec3",
  "order_id": "3e318d93-0cbc-4689-9e6c-873daeb158de"
}
```

# Step 2: SMS is sent to the customer and opened by customer on their phone

Order is now in the *`new`* state at **Tamara**, this checkout session expires in 15 mins by default or can be manually voided using our **[Void Checkout Session API](/reference/voidcheckoutsession)**, if needed.

# Step 3: Check status of the order via Push or Pull methods

To identify and confirm that the customer has paid their first installment successfully, you will need to use any of the following methods to check:

### [Get Order Details APIs (Pull Method)](/reference/get-order-details-apis)

You will need to call **Tamara** via our Get order details API to check the status of the order if it has moved from *`new`* to *`fully_captured`*.

> 👍 **Check the order status via the API every 5-10 seconds until you get *`fully_captured`***

#### [Using Tamara unique order_id](/reference/getorderdetails)

by replacing `{order_Id}` with the **Tamara** `order_id` you got from response of the **[2. Create Checkout Session API](/reference/createcheckoutsession) **

##### Endpoint

```
get       /merchants/orders/{order_id}
```

> 📘 The response will detail all of the order details we have on our side which relies heavily on the information we got from your side in the **[2. Create Checkout Session API](/reference/createcheckoutsession)** and we'll also return all the information from our side about the order `status`, amounts paid, captured, refunded, etc.

##### Sample Response

```json
{
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "order_reference_id": "1231234123",
  "order_number": "1231234123",
  "description": "lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor",
  "consumer": {
    "first_name": "Mona",
    "last_name": "Lisa",
    "email": "customer@email.com",
    "phone_number": "966532298658",
    "national_id": "",
    "date_of_birth": "2023-07-10T00:00:00.000Z",
    "is_first_order": null
  },
  "status": "new",
  "shipping_address": {
    "first_name": "Mona",
    "last_name": "Lisa",
    "line1": "3764 Al Urubah Rd",
    "line2": "string",
    "region": "As Sulimaniyah",
    "postal_code": "",
    "city": "Riyadh",
    "country_code": "SA",
    "phone_number": "966532298658"
  },
  "billing_address": {
    "first_name": "Mona",
    "last_name": "Lisa",
    "line1": "3764 Al Urubah Rd",
    "line2": "string",
    "region": "As Sulimaniyah",
    "postal_code": "",
    "city": "Riyadh",
    "country_code": "SA",
    "phone_number": "966532298658"
  },
  "items": [
    {
      "reference_id": "123",
      "type": "Digital",
      "name": "Lego City 8601",
      "sku": "SA-12436",
      "quantity": 1,
      "tax_amount": {
        "amount": 10,
        "currency": "SAR"
      },
      "total_amount": {
        "amount": 100,
        "currency": "SAR"
      },
      "unit_price": {
        "amount": 490,
        "currency": "SAR"
      },
      "discount_amount": {
        "amount": 100,
        "currency": "SAR"
      },
      "image_url": "",
      "item_url": ""
    }
  ],
  "payment_type": "PAY_BY_INSTALMENTS",
  "instalments": 3,
  "total_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "shipping_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "tax_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "discount_amount": {
    "name": "Christmas 2020",
    "amount": {
      "amount": 200,
      "currency": "SAR"
    }
  },
  "captured_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "refunded_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "canceled_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "paid_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "settlement_status": "",
  "settlement_date": null,
  "created_at": "2023-07-10T08:05:59.000Z",
  "wallet_prepaid_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "transactions": {
    "cancels": [],
    "captures": [],
    "refunds": []
  },
  "processing": false,
  "store_code": "",
  "additional_data": {
    "single_checkout": false,
    "from_in_store_payment_link": false
  }
}
```

```json
{
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "order_reference_id": "1231234123",
  "order_number": "1231234123",
  "description": "lorem ipsum dolor lorem ipsum dolor lorem ipsum dolor",
  "consumer": {
    "first_name": "Mona",
    "last_name": "Lisa",
    "email": "customer@email.com",
    "phone_number": "966532298658",
    "national_id": "",
    "date_of_birth": "2023-06-22T00:00:00.000Z",
    "is_first_order": null
  },
  "status": "fully_captured",
  "shipping_address": {
    "first_name": "Mona",
    "last_name": "Lisa",
    "line1": "3764 Al Urubah Rd",
    "line2": "string",
    "region": "As Sulimaniyah",
    "postal_code": "",
    "city": "Riyadh",
    "country_code": "SA",
    "phone_number": "966532298658"
  },
  "billing_address": {
    "first_name": "Mona",
    "last_name": "Lisa",
    "line1": "3764 Al Urubah Rd",
    "line2": "string",
    "region": "As Sulimaniyah",
    "postal_code": "",
    "city": "Riyadh",
    "country_code": "SA",
    "phone_number": "966532298658"
  },
  "items": [
    {
      "reference_id": "123",
      "type": "Digital",
      "name": "Lego City 8601",
      "sku": "SA-12436",
      "quantity": 1,
      "tax_amount": {
        "amount": 10,
        "currency": "SAR"
      },
      "total_amount": {
        "amount": 100,
        "currency": "SAR"
      },
      "unit_price": {
        "amount": 490,
        "currency": "SAR"
      },
      "discount_amount": {
        "amount": 100,
        "currency": "SAR"
      },
      "image_url": "",
      "item_url": ""
    }
  ],
  "payment_type": "PAY_BY_INSTALMENTS",
  "instalments": 3,
  "total_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "shipping_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "tax_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "discount_amount": {
    "name": "Christmas 2020",
    "amount": {
      "amount": 200,
      "currency": "SAR"
    }
  },
  "captured_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "refunded_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "canceled_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "paid_amount": {
    "amount": 100,
    "currency": "SAR"
  },
  "settlement_status": "",
  "settlement_date": null,
  "created_at": "2023-06-22T10:21:22.000Z",
  "wallet_prepaid_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "transactions": {
    "cancels": [],
    "captures": [
      {
        "capture_id": "d5a4be96-30de-4df1-a93f-43bb7b85a60a",
        "order_id": "4187f2ee-4b5e-40b7-8244-9cb7d5e54674",
        "merchant_id": "6d9f752e-0bbc-47eb-bcf7-be13adf6f04d",
        "total_amount": {
          "amount": 300,
          "currency": "SAR"
        },
        "refunded_amount": {
          "amount": 0,
          "currency": "SAR"
        },
        "shipping_info": {
          "shipped_at": "2023-06-22T00:00:00.000Z",
          "shipping_company": "N/A",
          "tracking_number": null,
          "tracking_url": null
        },
        "items": [],
        "shipping_amount": {
          "amount": 0,
          "currency": "SAR"
        },
        "tax_amount": {
          "amount": 0,
          "currency": "SAR"
        },
        "discount_amount": {
          "amount": 200,
          "currency": "SAR"
        },
        "created_at": "2023-07-10T08:08:52.000Z"
      }
    ],
    "refunds": []
  },
  "processing": false,
  "store_code": "",
  "additional_data": {
    "single_checkout": false,
    "from_in_store_payment_link": false
  }
}
```

### [Registering a Webhook URL (Push Method)](/reference/getting-started-with-webhooks)

In order to receive real-time updates from **Tamara** for every status change that happens on your orders, you are encouraged to register a notification webhook URL with **Tamara** either using our **[Register Webhook URL API](/reference/registerwebhookurl) ** or via our **[Partners Portal Webhooks management](/docs/transaction-authorisation) ** section.

# Step 4. Customer wants to return items or requested a refund

Based on your store policy, if the customer requests for return, you can fully/partially refund the order using the **[Refund API](/reference/simplifiedrefund) **

### Endpoint

```
post      /payments/simplified-refund/{order_id}
```

Replace the `order_id` with the unique **Tamara** `order_id` from the **[response](#sample-response-1)** of the creation of the **[in-store checkout session](#step-1-add-items-to-cart-and-choose-tamara-as-a-payment-method)** and the amount that needs to be refunded as well as a comment for future reference.

### Sample Request

```json
{
  "total_amount": {
    "amount": 100,
    "currency": "SAR"
  },
  "comment": "Refund for the order 123"
}
```

### Sample Response

In response you will receive the unique `refund_id` for this specific refund request, as well as the `capture_id` that was issued when the customer paid their first installment on checkout.

> 🚧 **Be Careful**
>
> You may have multiple `refund_id` if you perform multiple partial refunds for the same `order_id`, please try to store them all in your DBs.

```json
{
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "comment": "Refund for the order 123",
  "refund_id": "a04390d4-5690-45cd-9086-6980d8a86f72",
  "capture_id": "bd10fc2c-4db8-426e-a1fd-b16388d42c01",
  "status": "fully_refunded",
  "refunded_amount": {
    "amount": 300,
    "currency": "SAR"
  }
}
```

```json
{
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "comment": "Refund for the order 123",
  "refund_id": "924001dc-0e25-463e-82f2-1848aca95542",
  "capture_id": "bd10fc2c-4db8-426e-a1fd-b16388d42c01",
  "status": "partially_refunded",
  "refunded_amount": {
    "amount": 100,
    "currency": "SAR"
  }
}
```

# Optional Steps

## Optional: Check customer ID verification/onboarding status

To further optimise the checkout time, you can the implement **[Customer's ID Verification Status API](/reference/customersidverificationstatus)** , to determine whether or not the customer has completed the onboarding previously

### Endpoint

```
post      /merchants/customer/id-verification-status
```

While sending `phone_number` and `country_code` as query parameters.

### Sample Response

```json
{
  "is_id_verified": true
}
```

```json
{
  "is_id_verified": false
}
```

## Optional: [Update order_reference_id](/reference/updateorderreferenceid)

If you have the need to update your order's `order_reference_id` that is stored at our side since the creation of checkout session you can do so by using our API for updating such info.

### Endpoint

```
put       /orders/{order_id}/reference-id
```

by replacing `{order_Id}` with the **Tamara** `order_id` you got from response of the **[Create In-store Checkout Session API](/reference/createinstorecheckoutsession)** and sending the new `order_reference_id` in the request body.

### Sample Request

```json
{
  "order_reference_id": "New Reference ID Here"
}
```

and **Tamara** will respond back with a success message as follows,

### Sample Response

```json
{
  "message": "Order reference id was updated successfully"
}
```

---
*Updated 28 days ago*

*   [Create In-store Checkout Session](/reference/createinstorecheckoutsession)
*   [Get Order Details APIs](/reference/get-order-details-apis)
*   [Simplified Refund](/reference/simplifiedrefund)
*   [Getting Started with Webhooks](/reference/getting-started-with-webhooks)