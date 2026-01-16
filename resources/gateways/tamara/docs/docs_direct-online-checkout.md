> 🚧 **This page is a high-level explanation only.**
>
> Consult the **[API References](/reference)** for further details on how to use our APIs properly.

The **Tamara** online payment journey will always start with a customer adding items to their cart and heading to the checkout page to choose a payment method to use.

---

# **[Step 1. Create Checkout Session API](/reference/createcheckoutsession)**

Customer now sees Tamara as an available payment method on your store, and proceeds to choose it to checkout with.

When a customer decides to pay using **Tamara** and proceeds to checkout, your server needs to create a checkout session request to send the details of the purchase, such as the total amount to be paid using **Tamara**, currency, consumer information, item details and your unique order reference ID.

### Endpoint
`post /checkout`

### Sample Request

```json
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
    "amount": 0,
    "currency": "SAR"
  },
  "order_reference_id": "1231234123-abda-fdfe--afd31241",
  "order_number": "S12356",
  "discount": {
    "amount": {
      "amount": 200,
      "currency": "SAR"
    },
    "name": "Christmas 2020"
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
  "consumer": {
    "email": "customer@email.com",
    "first_name": "Mona",
    "last_name": "Lisa",
    "phone_number": "566027755"
  },
  "country_code": "SA",
  "description": "lorem ipsum dolor",
  "merchant_url": {
    "cancel": "http://awesome-qa-tools.s3-website.me-south-1.amazonaws.com/#/cancel",
    "failure": "http://awesome-qa-tools.s3-website.me-south-1.amazonaws.com/#/fail",
    "success": "http://awesome-qa-tools.s3-website.me-south-1.amazonaws.com/#/success",
    "notification": "https://store-demo.com/payments/tamarapay"
  },
  "payment_type": "PAY_BY_INSTALMENTS",
  "instalments": 3,
  "billing_address": {
    "city": "Riyadh",
    "country_code": "SA",
    "first_name": "Mona",
    "last_name": "Lisa",
    "line1": "3764 Al Urubah Rd",
    "line2": "string",
    "phone_number": "532298658",
    "region": "As Sulimaniyah"
  },
  "shipping_address": {
    "city": "Riyadh",
    "country_code": "SA",
    "first_name": "Mona",
    "last_name": "Lisa",
    "line1": "3764 Al Urubah Rd",
    "line2": "string",
    "phone_number": "532298658",
    "region": "As Sulimaniyah"
  },
  "platform": "platform name here",
  "is_mobile": false,
  "locale": "en_US",
  "risk_assessment": {
    "customer_age": 22,
    "customer_dob": "31-01-2000",
    "customer_gender": "Male",
    "customer_nationality": "SA",
    "is_premium_customer": true,
    "is_existing_customer": true,
    "is_guest_user": true,
    "account_creation_date": "31-01-2019",
    "platform_account_creation_date": "string",
    "date_of_first_transaction": "31-01-2019",
    "is_card_on_file": true,
    "is_COD_customer": true,
    "has_delivered_order": true,
    "is_phone_verified": true,
    "is_fraudulent_customer": true,
    "total_ltv": 501.5,
    "total_order_count": 12,
    "order_amount_last3months": 301.5,
    "order_count_last3months": 2,
    "last_order_date": "31-01-2021",
    "last_order_amount": 301.5,
    "reward_program_enrolled": true,
    "reward_program_points": 300,
    "phone_verified": false
  },
  "additional_data": {
    "delivery_method": "home delivery",
    "pickup_store": "Store A",
    "store_code": "Store code A",
    "vendor_amount": 0,
    "merchant_settlement_amount": 0,
    "vendor_reference_code": "AZ1234"
  }
}
```

The response of this API returns a unique **Tamara** `order_id`, `checkout_id`, `status` and a `checkout_url` that the user should be redirected to, to complete their transaction with **Tamara**.

### Sample Response

```json
{
  "order_id": "f56a3123-9e23-45e4-87a2-95366d3b0bca",
  "checkout_id": "5ccbe4b1-890d-40b3-8a88-0b489ba8ed01",
  "checkout_url": "https://checkout.tamara.co/checkout/5ccbe4b1-890d-40b3-8a88-0b489ba8ed01?locale=en_US&orderId=f56a3123-9e23-45e4-87a2-95366d3b0bca",
  "status": "new"
}
```

> 📘 **Save the `order_id` and `checkout_id` in your DBs**

---

# **Step 2. Customer Journey**

Your server will then redirect the customer to the `checkout_url` received in the above step to complete their **Tamara** checkout experience.

(Sample Customer Journey, Click to expand)

The customer will then be redirected to your website via the respective redirect URLs that were provided under the `merchant_url` object in your checkout session request.

**Tamara** will also send a notification payload for *`approved`* status change by **POST** method, to the **[Webhook URL that you registered on our partner portal](/docs/transaction-authorisation)** or via our **[Webhook Management APIs](/reference/getting-started-with-webhooks)**

If you'd like to check the order status while or after the customer completes the payment at **Tamara**, we have 2 APIs that can help you out to verify the current status of any **Tamara** order, called the **[Get Order Details APIs](#optional-get-order-details-apis)**.

# [Step 3. Authorise Order API](/reference/authoriseorder)

After receiving the *`approved`* webhook notification in the previous step, i.e., once the order status is on *`approved`* state in the checkout flow, your server would need to call back **Tamara** to confirm the receipt of the *`approved`* notification by authorising the order/transaction, by replacing `{order_id}` in the endpoint path with the **Tamara** `order_id` you got from response of the **[1. Create Checkout Session API](/reference/createcheckoutsession)**

### Endpoint
`post /orders/{order_id}/authorise`

### Sample Response

```json
{
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "status": "authorised",
  "order_expiry_time": "2023-06-04T15:07:47+00:00",
  "payment_type": "PAY_BY_INSTALMENTS",
  "auto_captured": false,
  "authorized_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "capture_id": ""
}
```

```json
{
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "status": "fully_captured",
  "order_expiry_time": "2023-07-04T12:07:43+00:00",
  "payment_type": "PAY_BY_INSTALMENTS",
  "auto_captured": true,
  "authorized_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "capture_id": "bd10fc2c-4db8-426e-a1fd-b16388d42c01"
}
```

Once the *`authorised`* stage is reached, you can consider the order as paid, and proceed further.

## [Step 3.a Cancel API](/reference/cancelorder)

If, for any valid reason, the customer wishes to not continue with receiving his order after order has been paid using **Tamara** and authorized by the merchant, **OR** wishes to remove some items from his order, then you can initiate a Cancel Order Request which works to do exactly the 2 scenarios mentioned.

Either completely cancel the order **OR** update the order and remove the items that are no longer needed by the customer from the original order.

> 🚧 **Order must be in `authorized` state only to be able to use the Cancel API, otherwise the Cancel API will return an error.**

### Endpoint
`post /orders/{order_id}/cancel`

### Sample Request

```json
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
  ]
}
```

### Sample Responses

```json
{
  "order_id": "870e3e2e-e88a-4933-9ec0-7f7b8ed65e0c",
  "cancel_id": "2c58ce01-04af-4387-9450-269ff822b558",
  "status": "canceled",
  "canceled_amount": {
    "amount": 300,
    "currency": "SAR"
  }
}
```

```json
{
  "order_id": "870e3e2e-e88a-4933-9ec0-7f7b8ed65e0c",
  "cancel_id": "fecc5fce-2079-4292-8761-40726253f0bf",
  "status": "updated",
  "canceled_amount": {
    "amount": 100,
    "currency": "SAR"
  }
}
```

# [Step 4. Capture Order API](/reference/captureorder)

After authorising, and once the order is shipped/fulfilled, your server would then need to send a capture request for the payment,

> ❗️ **NOTICE: Orders NOT captured are NOT settled to your account!**

> 📘 If an order is not Captured within 21 days from when it is Authorised, Tamara will auto-capture that order and it will be moved to Fully Captured status

### Endpoint
`post /payments/capture`

### Sample Request

```json
{
  "order_id": "8fe4cce9-d0aa-4020-a863-c708547795e9",
  "total_amount": {
    "amount": 300,
    "currency": "SAR"
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
  "discount_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "shipping_amount": {
    "amount": 0,
    "currency": "SAR"
  },
  "shipping_info": {
    "shipped_at": "2020-03-31T19:19:52.677Z",
    "shipping_company": "DHL",
    "tracking_number": 100,
    "tracking_url": "https://shipping.com/tracking?id=123456"
  },
  "tax_amount": {
    "amount": 100,
    "currency": "SAR"
  }
}
```

Once the *`partially_captured`* or *`fully_captured`* state is reached, you can consider the amounts captured to be added to your next settlement cycle.

### Sample Response

```json
{
  "capture_id": "bd10fc2c-4db8-426e-a1fd-b16388d42c01",
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "status": "fully_captured",
  "captured_amount": {
    "amount": 300,
    "currency": "SAR"
  }
}
```

```json
{
  "capture_id": "bd10fc2c-4db8-426e-a1fd-b16388d42c01",
  "order_id": "0ac038ef-de4a-491c-828e-b02ec0d4582d",
  "status": "partially_captured",
  "captured_amount": {
    "amount": 230,
    "currency": "SAR"
  }
}
```

# **Optional Steps**

## [Optional: Simplified Refund API](/reference/simplifiedrefund)

Based on your returns and refunds policies, after shipping/capturing, if a customer wishes to return the items or requests a refund, your server would need to send a refund request to **Tamara**

### Endpoint
`post /payments/simplified-refund/{orderId}`

### Sample Request

```json
{
  "total_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "comment": "Refund for the order A123"
}
```

### Sample Response

```json
{
  "total_amount": {
    "amount": 300,
    "currency": "SAR"
  },
  "comment": "Refund for the order A123"
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

Once the *`fully_refunded`* or *`partially_refunded`* state is reached, you can consider the amount to have been refunded by **Tamara** to the customer's card right away, and the refunded amount will be deducted from your next settlement.

> ⚠️ **Refund transactions are processed in realtime on Tamara's end but,**
>
> Refunds might take several hours to several days to reflect on the customer's bank account depending on the customer's bank's processing time.

## Optional: [Get Order Details API](/reference/get-order-details-apis)

You may also check the order status for an order, in case your server did not receive any update/notification from our side, for any unforeseen reason.

### [Using Tamara unique order\_id](/reference/getorderdetails)

#### Endpoint
`get /merchants/orders/{order_id}`

by replacing `{order_Id}` with the **Tamara** `order_id` you got from response of the **[1. Create Checkout Session API](/reference/createcheckoutsession)**

## [Optional: Update order\_reference\_id](/reference/updateorderreferenceid)

If you have the need to update your order's `order_reference_id` that is stored at our side since the creation of checkout session you can do so by using our API for updating such info.

### Endpoint
`put /orders/{order_id}/reference-id`

by replacing `{order_Id}` with the **Tamara** `order_id` you got from response of the **[1. Create Checkout Session API](/reference/createcheckoutsession)** and sending the new `order_reference_id` in the request body.

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