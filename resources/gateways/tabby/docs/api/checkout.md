# Tabby Checkout API – Create a Session

Creates a Checkout session. Creates Session and Payment, returns Pre-Scoring result (status), and IDs of Payment and Session.

---

## Endpoint

* **URL:** `https://api.tabby.ai/api/v2/checkout`
* **Method:** `POST`
* **Auth:** Bearer Token

---

## Headers

| Key           | Value                 | Description               |
| ------------- | --------------------- | ------------------------- |
| Authorization | `Bearer <secret_key>` | Required. Your secret key |
| Content-Type  | `application/json`    | Required                  |

---

## Request Body

### Full Payload Model

```json
{
  "payment": {
    "amount": "100.00",
    "currency": "AED",
    "description": "test payload",
    "buyer": {
      "name": "John Doe",
      "email": "john.doe@example.com",
      "phone": "500000001",
      "dob": "2000-01-20"
    },
    "shipping_address": {
      "city": "Dubai",
      "address": "Dubai",
      "zip": "1111"
    },
    "order": {
      "reference_id": "1001",
      "updated_at": "2023-11-07T05:31:56Z",
      "tax_amount": "0.00",
      "shipping_amount": "0.00",
      "discount_amount": "0.00",
      "items": [
        {
          "reference_id": "SKU123",
          "title": "Name of the product",
          "description": "Description of the product",
          "quantity": 1,
          "unit_price": "0.00",
          "discount_amount": "0.00",
          "image_url": "https://example.com/",
          "product_url": "https://example.com/",
          "gender": "Kids",
          "category": "Clothes",
          "color": "white",
          "product_material": "cotton",
          "size_type": "EU",
          "size": "M",
          "brand": "Name of the Brand",
          "is_refundable": true,
          "barcode": "12345678",
          "ppn": "MNXT2ZM/A",
          "seller": "Name of the Seller"
        }
      ]
    },
    "buyer_history": {
      "registered_since": "2023-11-07T05:31:56Z",
      "loyalty_level": 0,
      "wishlist_count": 0,
      "is_social_networks_connected": true,
      "is_phone_number_verified": true,
      "is_email_verified": true
    },
    "order_history": [
      {
        "purchased_at": "2023-11-07T05:31:56Z",
        "amount": "100.00",
        "payment_method": "card",
        "status": "new",
        "buyer": {
          "name": "John Doe",
          "email": "john.doe@example.com",
          "phone": "500000001",
          "dob": "2000-01-20"
        },
        "shipping_address": {
          "city": "Dubai",
          "address": "Dubai",
          "zip": "1111"
        },
        "items": [
          {
            "reference_id": "SKU123",
            "title": "Name of the product",
            "description": "Description of the product",
            "quantity": 1,
            "unit_price": "0.00",
            "discount_amount": "0.00",
            "image_url": "https://example.com/",
            "product_url": "https://example.com/",
            "gender": "Kids",
            "category": "Clothes",
            "color": "white",
            "product_material": "cotton",
            "size_type": "EU",
            "size": "M",
            "brand": "Name of the Brand",
            "is_refundable": true,
            "barcode": "12345678",
            "ppn": "MNXT2ZM/A",
            "seller": "Name of the Seller"
          }
        ]
      }
    ],
    "meta": {
      "customer": "#customer-id",
      "order_id": "#1234"
    },
    "attachment": {
      "body": "{\"flight_reservation_details\": {\"pnr\": \"TR9088999\",\"itinerary\": [...],\"insurance\": [...],\"passengers\": [...],\"affiliate_name\": \"some affiliate\"}}",
      "content_type": "application/vnd.tabby.v1+json"
    }
  },
  "lang": "en",
  "merchant_code": "code provided to you from Tabby side",
  "merchant_urls": {
    "success": "https://your-store/success",
    "cancel": "https://your-store/cancel",
    "failure": "https://your-store/failure"
  },
  "token": null
}
```

---

## Response

### Success – 200 OK

```json
{
  "id": "session id, uuid format",
  "configuration": {
    "available_products": {
      "installments": [
        {
          "web_url": "https://checkout.tabby.ai/",
          "qr_code": "https://api.tabby.ai/api/v2/checkout/{id}/hpp_link_qr"
        }
      ]
    },
    "products": {
      "installments": {
        "type": "installments",
        "is_available": true,
        "rejection_reason": null
      }
    }
  },
  "token": null,
  "payment": {
    "amount": "100",
    "currency": "AED",
    "order": {
      "reference_id": "1001",
      "items": [
        {
          "title": "Name of the product",
          "quantity": 1,
          "unit_price": "0.00",
          "category": "Clothes",
          "reference_id": "SKU123",
          "description": "Description of the product",
          "image_url": "https://example.com/",
          "product_url": "https://example.com/",
          "gender": "Kids",
          "color": "white",
          "product_material": "cotton",
          "size_type": "EU",
          "size": "M",
          "brand": "Name of the Brand",
          "is_refundable": true
        }
      ],
      "updated_at": "2023-11-07T05:31:56Z",
      "tax_amount": "0.00",
      "shipping_amount": "0.00",
      "discount_amount": "0.00"
    },
    "id": "payment id, uuid format",
    "created_at": "2023-11-07T05:31:56Z",
    "status": "CREATED",
    "is_test": true,
    "description": "test payload",
    "meta": {
      "customer": "#customer-id",
      "order_id": "#1234"
    },
    "attachment": {
      "body": "{\"flight_reservation_details\": {\"pnr\": \"TR9088999\",\"itinerary\": [...],\"insurance\": [...],\"passengers\": [...],\"affiliate_name\": \"some affiliate\"}}",
      "content_type": "application/vnd.tabby.v1+json"
    }
  },
  "status": "created",
  "merchant_urls": {
    "success": "https://your-store/success",
    "cancel": "https://your-store/cancel",
    "failure": "https://your-store/failure"
  }
}
```

---

### Possible `status` Values (200 OK)

* **created** – Request approved, customer eligible
* **rejected** – No available products for customer
* **expired** – Used for specific integrations
* **approved** – Used for specific integrations

---

## Error Responses

### 400 – Bad Request

Returned when required fields are missing or invalid.

```json
{
  "status": "error",
  "errorType": "invalid_request_error",
  "error": "Missing required parameter: payment.amount"
}
```

---

### 401 – Unauthorized

Returned when authentication token is missing or invalid.

```json
{
  "status": "error",
  "errorType": "unauthorized",
  "error": "Invalid or missing authentication token"
}
```

---

### 403 – Forbidden

Returned when the merchant account is inactive or not allowed to create sessions.

```json
{
  "status": "error",
  "errorType": "forbidden",
  "error": "Merchant account is inactive"
}
```
