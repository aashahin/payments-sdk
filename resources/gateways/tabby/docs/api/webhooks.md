# Tabby Webhooks API

Webhooks are user-defined HTTP callbacks. Tabby uses them to notify you about payment-related events (Authorize, Capture, Close, Refund, etc.).

---

## 1. Webhook Event Payload

When an event occurs, Tabby sends a `POST` request to your registered URL with the following JSON payload.

### Request Body (Sent by Tabby to your Server)

```json
{
  "id": "payment_id",
  "created_at": "2021-09-14T13:08:54Z",
  "expires_at": "2022-09-14T13:08:54Z",
  "closed_at": "2021-09-14T13:09:45Z",
  "status": "closed", 
  "is_test": false,
  "is_expired": false,
  "amount": "100",
  "currency": "SAR",
  "order": {
    "reference_id": "your_order_ref_123"
  },
  "captures": [
    {
      "id": "capture_id",
      "amount": "100",
      "created_at": "2021-09-14T13:09:45Z",
      "reference_id": "capture_ref_123"
    }
  ],
  "refunds": [
    {
      "id": "refund_id",
      "amount": "100",
      "created_at": "2021-09-14T14:14:02Z",
      "reference_id": "refund_ref_123",
      "reason": "Customer return"
    }
  ],
  "meta": {
    "order_id": null,
    "customer": null
  },
  "token": "string"
}
```

### Supported Events & Status Changes

- **`authorized`**: Payment authorized
- **`closed`**: Payment completed/captured fully
- **`rejected`**: Payment rejected
- **`expired`**: Payment expired (optional configuration)

---

## 2. Register a Webhook

Creates a new webhook endpoint configuration.

**URL:** `https://api.tabby.ai/api/v1/webhooks`  
**Method:** `POST`  
**Auth:** `Bearer <secret_key>`

### Headers

| Key | Value | Description |
|-----|-------|-------------|
| `X-Merchant-Code` | `string` | Required. Code provided to you by Tabby |

### Request Body

```json
{
  "url": "https://example.com/webhooks/tabby",
  "header": {
    "title": "X-Custom-Auth",
    "value": "my_secret_signing_key"
  }
}
```

### Response (200 OK)

```json
{
  "is_test": false,
  "url": "https://example.com/webhooks/tabby",
  "header": {
    "title": "X-Custom-Auth",
    "value": "my_secret_signing_key"
  },
  "id": "unique_webhook_id"
}
```

### Error Responses

#### 400 Bad Request

```json
{
  "status": "error",
  "errorType": "invalid_request_error",
  "error": "Invalid URL format"
}
```

---

## 3. Retrieve All Webhooks

Retrieves a list of all registered webhooks.

**URL:** `https://api.tabby.ai/api/v1/webhooks`  
**Method:** `GET`  
**Auth:** `Bearer <secret_key>`  
**Headers:** `X-Merchant-Code` (Required)

### Response (200 OK)

Returns an array of webhook objects.

```json
[
  {
    "id": "unique_webhook_id",
    "is_test": true,
    "url": "https://example.com/webhooks/tabby",
    "header": {
      "title": "X-Custom-Auth",
      "value": "my_secret_signing_key"
    }
  }
]
```

---

## 4. Retrieve a Webhook

Retrieves a specific webhook configuration by ID.

**URL:** `https://api.tabby.ai/api/v1/webhooks/{id}`  
**Method:** `GET`  
**Auth:** `Bearer <secret_key>`  
**Headers:** `X-Merchant-Code` (Required)

### Response (200 OK)

```json
{
  "id": "unique_webhook_id",
  "is_test": true,
  "url": "https://example.com/webhooks/tabby",
  "header": {
    "title": "X-Custom-Auth",
    "value": "my_secret_signing_key"
  }
}
```

### Error Responses

#### 404 Not Found

```json
{
  "status": "error",
  "errorType": "not_found",
  "error": "Webhook not found"
}
```

---

## 5. Update a Webhook

Updates an existing webhook configuration.

**URL:** `https://api.tabby.ai/api/v1/webhooks/{id}`  
**Method:** `PUT`  
**Auth:** `Bearer <secret_key>`  
**Headers:** `X-Merchant-Code` (Required)

### Request Body

```json
{
  "url": "https://example-updated.com/webhooks/tabby",
  "header": {
    "title": "X-Custom-Auth-Updated",
    "value": "new_secret_key"
  }
}
```

### Response (200 OK)

```json
{
  "id": "unique_webhook_id",
  "url": "https://example-updated.com/webhooks/tabby",
  "header": {
    "title": "X-Custom-Auth-Updated",
    "value": "new_secret_key"
  }
}
```

---

## 6. Remove a Webhook

Deletes a webhook configuration.

**URL:** `https://api.tabby.ai/api/v1/webhooks/{id}`  
**Method:** `DELETE`  
**Auth:** `Bearer <secret_key>`  
**Headers:** `X-Merchant-Code` (Required)

### Response (200 OK)

```json
{
  "status": "ok"
}
```

### Error Responses

#### 404 Not Found

```json
{
  "status": "error",
  "errorType": "not_found",
  "error": "Webhook not found"
}
```