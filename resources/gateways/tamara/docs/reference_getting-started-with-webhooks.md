# Introduction

You can also manage webhooks URLs from our **[Tamara Partners Portal](https://partners.tamara.co/)** as well as using our APIs that you will find in this section

In order to test the payload, we recommend using an online tool like **[https://webhook.site](https://webhook.site)** where you can setup a test Webhook URL and can check the payload we send to your endpoint whenever an event(status change) happens on your order.

The webhook payload will be sent via HTTP POST method to your registered notification webhook URL.

# Webhook Structure

All notification webhooks sent by Tamara will follow a standard structure as laid out below.

## Attributes

**order_id** `string`

This is **Tamara's** unique order identifier that was created at the moment the checkout session was requested by the merchant.

**order_reference_id** `string`

The main merchant order identifier that was sent by merchant to **Tamara** to store in the created order's details.

**order_number** `string`

Optional: Another order identifier sent by merchant to **Tamara** in cases where merchant has 2 separate sets of identifiers, the **order_number** is the simpler version of the merchant's order identifier that is shown to customers on their invoices

**event_type** `string`

The event string that identifies the status change that the order has undergone, it is comprised of a specific set of strings enums, t

| event\_type | Status |
| :--- | :--- |
| order\_approved | `approved` |
| order\_declined | `declined` |
| order\_authorised | `authorised` |
| order\_canceled | `canceled` |
| order\_captured | `fully_captured` `partially_captured` |
| order\_refunded | `fully_refunded` `partially_refunded` |
| order\_expired | `expired` |

**data** `object`

An objects that includes, in some cases, more information about the status change, such as amount refunded, or amount captured, amount canceled, as well as, respective refund ID or Capture ID or Cancel ID.

## Example Notification Payloads

```json
{
  "order_id": "4fdb781f-5e13-4ae2-9dc6-3ee49e3878a3",
  "order_reference_id": "4464602579098",
  "order_number": "90001860",
  "event_type": "order_approved",
  "data": []
}
```

```json
{
  "order_id": "4fdb781f-5e13-4ae2-9dc6-3ee49e3878a3",
  "order_reference_id": "4464602579098",
  "order_number": "90001860",
  "event_type": "order_authorised",
  "data": []
}
```

```json
{
  "order_id": "769c861d-d2d0-41bb-8932-3fc3cb78b445",
  "order_reference_id": "4464606544026",
  "order_number": "90001861",
  "event_type": "order_canceled",
  "data": {
    "cancel_id": "a1d769af-f8a0-4353-a3c5-8b68b23d1f8b",
    "canceled_amount": {
      "amount": 300.00,
      "currency": "SAR"
    }
  }
}
```

```json
{
  "order_id": "4fdb781f-5e13-4ae2-9dc6-3ee49e3878a3",
  "order_reference_id": "4464602579098",
  "order_number": "90001860",
  "event_type": "order_captured",
  "data": {
    "capture_id": "14c594f8-84ec-4f45-8fec-6ef1e2fde2ff",
    "captured_amount": {
      "amount": 300.00,
      "currency": "SAR"
    }
  }
}
```

```json
{
  "order_id": "4fdb781f-5e13-4ae2-9dc6-3ee49e3878a3",
  "order_reference_id": "4464602579098",
  "order_number": "90001860",
  "event_type": "order_refunded",
  "data": {
    "refund_id": "c172e227-903a-4091-b57f-695b6a5a3681",
    "capture_id": "14c594f8-84ec-4f45-8fec-6ef1e2fde2ff",
    "refunded_amount": {
      "amount": 300.00,
      "currency": "SAR"
    },
    "comment": "Refund Test"
  }
}
```

```json
{
  "order_id": "64fb76a4-ee5f-4ed9-87f4-8a85218315e9",
  "order_reference_id": "4464601989274",
  "order_number": "90001859",
  "event_type": "order_expired",
  "data": []
}
```

```json
{
  "order_id": "b190e5b7-9da7-4e7a-9aa7-fd568eb76c46",
  "order_reference_id": "abd12331-a123-1234-4567-fbde34ae",
  "order_number": "A123125",
  "event_type": "order_declined",
  "data": {
    "declined_reason": "DECLINE REASON HERE",
    "declined_code": "DECLINE CODE HERE",
    "decline_type": "DECLINE TYPE HERE"
  }
}
```