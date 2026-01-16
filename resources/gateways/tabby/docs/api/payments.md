# Tabby Payments API

## 1. Retrieve a Payment

Retrieves the specified payment. Returns the entire payment object, including the payment Status, Captures, and Refunds objects.

**URL:** `https://api.tabby.ai/api/v2/payments/{id}`  
**Method:** `GET`  
**Auth:** `Bearer <token>`

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string (uuid) | Yes | ID of the payment |

### Response (200 OK)

```json
{
  "amount": "100",
  "currency": "AED",
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
      "amount": "100",
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
      "payment_method": "card",
      "items": [
        {
          "reference_id": "SKU123",
          "title": "Name of the product",
          "quantity": 1,
          "unit_price": "0.00",
          "category": "Clothes",
          "ordered": 0,
          "captured": 0,
          "shipped": 0,
          "refunded": 0
        }
      ]
    }
  ],
  "id": "payment id, uuid format",
  "created_at": "2023-11-07T05:31:56Z",
  "expires_at": "2023-11-07T05:31:56Z",
  "status": "CLOSED",
  "is_test": true,
  "description": "description",
  "captures": [
    {
      "amount": "100",
      "reference_id": "capture idempotency key",
      "id": "capture id, uuid format",
      "created_at": "2023-11-07T05:31:56Z",
      "tax_amount": "0.00",
      "shipping_amount": "0.00",
      "discount_amount": "0.00",
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
      ]
    }
  ],
  "refunds": [
    {
      "amount": "0.00",
      "reference_id": "refund idempotency key",
      "id": "refund id, uuid format",
      "created_at": "2023-11-07T05:31:56Z",
      "reason": "Reason for the refund",
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
}
```

### Error Responses

#### 400 Bad Request
Returned when the request data is invalid (e.g., trying to cancel an authorized payment).

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "session is finalized"
}
```

#### 401 Unauthorized
Returned when the authentication token is missing or invalid.

```json
{
  "status": "error",
  "errorType": "unauthorized",
  "error": "Invalid or missing authentication token"
}
```

#### 404 Not Found
Returned when the specified payment ID does not exist.

```json
{
  "status": "error",
  "errorType": "not_found",
  "error": "Payment not found"
}
```

---

## 2. Update a Payment

Updates the reference_id. You can only use this endpoint to update this 1 field. The payment to be updated can have a status of AUTHORIZED or CLOSED.

**URL:** `https://api.tabby.ai/api/v2/payments/{id}`  
**Method:** `PUT`  
**Auth:** `Bearer <token>`

### Request Body

```json
{
  "order": {
    "reference_id": "1001_updated"
  }
}
```

### Response (200 OK)

```json
{
  "amount": "100",
  "currency": "AED",
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
    "reference_id": "1001_updated",
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
  "buyer_history": {
    "registered_since": "2023-11-07T05:31:56Z",
    "loyalty_level": 0,
    "wishlist_count": 0,
    "is_social_networks_connected": true,
    "is_phone_number_verified": true,
    "is_email_verified": true
  },
  "order_history": [],
  "id": "payment id, uuid format",
  "created_at": "2023-11-07T05:31:56Z",
  "expires_at": "2023-11-07T05:31:56Z",
  "status": "AUTHORIZED",
  "is_test": true,
  "description": "description",
  "captures": [],
  "refunds": [],
  "meta": {
    "customer": "#customer-id",
    "order_id": "#1234"
  }
}
```

### Error Responses

#### 400 Bad Request

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "Invalid request body or parameters"
}
```

#### 403 Forbidden
Returned when the payment status does not allow updates (e.g., payment is not AUTHORIZED or CLOSED).

```json
{
  "status": "error",
  "errorType": "forbidden",
  "error": "Payment cannot be updated in current status"
}
```

---

## 3. Capture a Payment

Send a Capture request for Authorized payments only. If you capture the full payment amount, the payment will be automatically closed.

**URL:** `https://api.tabby.ai/api/v2/payments/{id}/captures`  
**Method:** `POST`  
**Auth:** `Bearer <token>`

### Request Body

```json
{
  "amount": "100",
  "reference_id": "capture idempotency key",
  "tax_amount": "0.00",
  "shipping_amount": "0.00",
  "discount_amount": "0.00",
  "items": [
    {
      "title": "Name of the product",
      "quantity": 1,
      "unit_price": "0.00",
      "category": "Clothes",
      "reference_id": "SKU123",
      "description": "Description of the product",
      "discount_amount": "0.00",
      "image_url": "https://example.com/",
      "product_url": "https://example.com/",
      "gender": "Kids",
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
```

### Response (200 OK)

```json
{
  "amount": "100",
  "currency": "AED",
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
    "items": [],
    "updated_at": "2023-11-07T05:31:56Z",
    "tax_amount": "0.00",
    "shipping_amount": "0.00",
    "discount_amount": "0.00"
  },
  "id": "payment id, uuid format",
  "created_at": "2023-11-07T05:31:56Z",
  "status": "CLOSED",
  "is_test": true,
  "captures": [
    {
      "amount": "100",
      "reference_id": "capture idempotency key",
      "id": "capture id, uuid format",
      "created_at": "2023-11-07T05:31:56Z",
      "tax_amount": "0.00",
      "shipping_amount": "0.00",
      "discount_amount": "0.00",
      "items": [
        {
          "title": "Name of the product",
          "quantity": 1,
          "unit_price": "0.00",
          "category": "Clothes",
          "reference_id": "SKU123"
        }
      ]
    }
  ],
  "refunds": [],
  "meta": {
    "customer": "#customer-id",
    "order_id": "#1234"
  }
}
```

### Error Responses

#### 400 Bad Request

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "Capture amount exceeds authorized amount"
}
```

#### 409 Conflict
Returned if the capture is already processed or conflicts with current state.

```json
{
  "status": "error",
  "errorType": "conflict",
  "error": "Payment already captured"
}
```

---

## 4. Refund a Payment

Send a full or partial refund amount request. You can only refund payments that have CLOSED status.

**URL:** `https://api.tabby.ai/api/v2/payments/{id}/refunds`  
**Method:** `POST`  
**Auth:** `Bearer <token>`

### Request Body

```json
{
  "amount": "0.00",
  "reference_id": "refund idempotency key",
  "reason": "Reason for the refund",
  "items": [
    {
      "title": "Name of the product",
      "quantity": 1,
      "unit_price": "0.00",
      "category": "Clothes",
      "reference_id": "SKU123",
      "description": "Description of the product",
      "discount_amount": "0.00",
      "image_url": "https://example.com/",
      "product_url": "https://example.com/",
      "gender": "Kids",
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
```

### Response (200 OK)

```json
{
  "amount": "100",
  "currency": "AED",
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
    "items": [],
    "updated_at": "2023-11-07T05:31:56Z"
  },
  "id": "payment id, uuid format",
  "created_at": "2023-11-07T05:31:56Z",
  "status": "CLOSED",
  "is_test": true,
  "captures": [],
  "refunds": [
    {
      "amount": "0.00",
      "reference_id": "refund idempotency key",
      "id": "refund id, uuid format",
      "created_at": "2023-11-07T05:31:56Z",
      "reason": "Reason for the refund",
      "items": [
        {
          "title": "Name of the product",
          "quantity": 1,
          "unit_price": "0.00",
          "category": "Clothes",
          "reference_id": "SKU123"
        }
      ]
    }
  ],
  "meta": {
    "customer": "#customer-id",
    "order_id": "#1234"
  }
}
```

### Error Responses

#### 400 Bad Request

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "Refund amount greater than captured amount"
}
```

#### 403 Forbidden
Returned if the payment is not in CLOSED status.

```json
{
  "status": "error",
  "errorType": "forbidden",
  "error": "Payment is not in CLOSED state"
}
```

#### 409 Conflict

```json
{
  "status": "error",
  "errorType": "conflict",
  "error": "Refund already processed with this reference_id"
}
```

---

## 5. Close a Payment

Closed is the final status of the payment. Use this if you want to close a payment manually.

**URL:** `https://api.tabby.ai/api/v2/payments/{id}/close`  
**Method:** `POST`  
**Auth:** `Bearer <token>`

### Request Body

No request body is required.

### Example Request

```bash
curl --request POST \
  --url https://api.tabby.ai/api/v2/payments/{id}/close \
  --header 'Authorization: Bearer <token>'
```

### Response (200 OK)

```json
{
  "amount": "100",
  "currency": "AED",
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
    "items": [],
    "updated_at": "2023-11-07T05:31:56Z"
  },
  "id": "payment id, uuid format",
  "created_at": "2023-11-07T05:31:56Z",
  "status": "CLOSED",
  "is_test": true,
  "captures": [],
  "refunds": [],
  "meta": {
    "customer": "#customer-id",
    "order_id": "#1234"
  }
}
```

### Error Responses

#### 400 Bad Request

```json
{
  "status": "error",
  "errorType": "bad_data",
  "error": "Payment already closed"
}
```

#### 403 Forbidden

```json
{
  "status": "error",
  "errorType": "forbidden",
  "error": "Payment cannot be closed manually in current status"
}
```