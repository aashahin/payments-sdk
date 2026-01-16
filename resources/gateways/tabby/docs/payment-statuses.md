# Payment Statuses

This is the payment flow which describes the whole payment process for the customer and your OMS.

![Payment Statuses Flow](https://mintcdn.com/tabby-5f40add6/Mdf68_F2fROQ9Weu/images/payment-statuses.avif?fit=max&auto=format&n=Mdf68_F2fROQ9Weu&q=85&s=e27279a101bc47246b22a3710aeed986)

## 1. Payment Creation

When a customer opens our Hosted Payment Page, Tabby creates a payment.

**Payment status:** `"CREATED"`

*Payments in this status are not shown on Merchant Dashboard.*

## 2. Payment Authorization

After successful order placement, a payment gets authorized.

**Payment status:** `"AUTHORIZED"`

*Payments in this status are shown on Merchant Dashboard as `NEW`.*

Payment status can also be `"REJECTED"` or `"EXPIRED"`. These statuses are terminal and cannot be changed, no actions are required from your end.

*Payments in these statuses are not shown on Merchant Dashboard.*

## 3. Payment Capture

Send Capture Request as soon as the payment is authorized. Payment gets closed automatically if you send the full amount in the request.

**Payment status:** `"CLOSED"`

*Payments in this status are shown on Merchant Dashboard as `CAPTURED`.*

**Optional:** A partial Capture is supported. Thus the order will stay in the `"AUTHORIZED"` status till the full Capture or Close Request.

*On Merchant Dashboard such payments will have status `NEW`.*

## 4. Close (Optional)

If a part of the order is not going to be delivered and you need to cancel a payment after partial Capture Request, use Close Request. Please note that this request refunds and cancels all the amount which stays not captured after authorization.

*Payments closed this way are shown on Merchant Dashboard as `CAPTURED`.*

You can also cancel the payment completely, if Close Request is sent after authorization without Capture Request.

**Payment status:** `"CLOSED"`

*Payments closed this way are shown on Merchant Dashboard as `CANCELLED`.*

## 5. Refund

Full and multiple partial refunds are supported. Only a `"CLOSED"` payment can be refunded and a refund amount should not exceed the captured amount.

**Payment status:** `"CLOSED"`

*On Merchant Dashboard such payments will be shown as `REFUNDED` or `PARTIALLY REFUNDED`.*

---

**Important:** To ensure that any text sent in JSON is transmitted correctly and displayed correctly at Tabby's user interfaces, make sure it is **UTF-8** encoded.