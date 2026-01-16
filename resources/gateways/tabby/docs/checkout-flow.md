# Checkout Flow

The first part of the journey begins with the customer arriving at your checkout.

Pay in **installments** with Tabby provides your customers with the possibility to split the purchase price into several payments with the downpayment and monthly repayments.

Here are [the design](#tabby-on-checkout) and the steps to implement Tabby payment method:

1. Enable [Background Pre-scoring](#background-pre-scoring-check)
2. Create [Checkout Session](#checkout-session-initiation) and redirect a customer to the Tabby Payment Page
3. Redirect the customer [back to your store](#redirection-to-the-store)

> **Make sure everything is implemented correctly with a few test cases before requesting live keys.**  
> [Testing Credentials](/testing-guidelines/testing-credentials)

---

## Tabby on Checkout

Use the standard Tabby naming and Logo (the text description is optional) to present Tabby method at your checkout.

|  | English | Arabic |
|---|---------|--------|
| **Payment Method Name** | Pay later with Tabby | ادفع لاحقًا عبر تابي |
| **Checkout Text Description** | Use any card. | استخدم أي بطاقة |

![Tabby payment method](https://mintcdn.com/tabby-5f40add6/P693KbtvGHftcJLw/images/checkout-upd-0725.png?fit=max&auto=format&n=P693KbtvGHftcJLw&q=85&s=eb6ca9a5e85a97c93d35634499dc4a07)

---

## Background Pre-scoring Check

The first step to build a successful journey is a background pre-scoring check which takes place at your checkout when total amount, contact and shipping details are already known to you. Initiate background pre-scoring session by calling [Checkout API](https://docs.tabby.ai/api-reference/checkout/create-a-session). In the response you receive one of two session statuses: "created" and "rejected".

If a customer is eligible during this checking, you will receive the following parameters and can show Tabby payment method safely:

```json
"status": "created"
```

If a customer is not eligible, you will receive the following parameters and should hide/mark unavailable Tabby payment method:

```json
"status": "rejected",
"configuration"."products"."installments"."rejection_reason": "not_available"
```

You need to hide Tabby payment option or show it with the General Rejection message or specific reason message depending on the `"rejection_reason"` value:

| Reason | English | Arabic |
|--------|---------|--------|
| General Rejection (`not_available`) | Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order. | نأسف، تابي غير قادرة على الموافقة على هذه العملية. الرجاء استخدام طريقة دفع أخرى. |
| `order_amount_too_high` | This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method | قيمة الطلب تفوق الحد الأقصى المسموح به حاليًا مع تابي. يُرجى تخفيض قيمة السلة أو استخدام وسيلة دفع أخرى. |
| `order_amount_too_low` | The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method | قيمة الطلب أقل من الحد الأدنى المطلوب لاستخدام خدمة تابي. يُرجى زيادة قيمة الطلب أو استخدام وسيلة دفع أخرى. |

![Background pre-scoring rejection message](https://mintcdn.com/tabby-5f40add6/Mdf68_F2fROQ9Weu/images/pre-scoring-upd-0725.png?fit=max&auto=format&n=Mdf68_F2fROQ9Weu&q=85&s=be374494af83fe2e4a1b347e013f0898)

*Show the rejection message for not eligible customers or hide Tabby*

---

## Checkout Session Initiation

Call [Checkout API](https://docs.tabby.ai/api-reference/checkout/create-a-session) for the second time with the full payload as soon as the approved customer clicks "Place order" and redirect this customer via "web_url" link received in the response from Checkout API. Thus the customer will land at Tabby Hosted Payment Page.

```json
"status": "created"
"configuration"."available_products"."installments".[0]."web_url": "string"
"payment"."id": "string"
```

**Save `"payment"."id"` from Checkout API response**, it will be used to verify, capture and refund the payment on the next steps.

At Tabby Checkout your customers will be asked:

- To verify the phone number by OTP (each transaction)
- To link Apple Pay or regular card (only for new Tabby customers)
- Additional data may be asked during customer's flow for some new customers

If your store checkout allows to change the customer or cart details (as applying discount codes), there is a chance that updated amount or customer details may cause a rejection, so you need to show the Rejection message as on [Background Pre-Scoring](#background-pre-scoring-check) step.

---

## Redirection to the Store

When customers finish Tabby session, they are redirected back to your site via one of the three `merchant_urls` from the Tabby Payment Page, with the payment_id after the separator, e.g. `https://your-store/success?payment_id=string`:

```json
"merchant_urls": {
  "success": "https://your-store/success",
  "cancel": "https://your-store/cancel",
  "failure": "https://your-store/failure"
}
```

**Allowed characters in redirect URLs ("success", "cancel", "failure")**

1. Latin letters (a-z, A-Z)
2. Arabic letters (ء-ي)
3. Digits (0-9)
4. Special characters - `\ | / : ;., + {}? & @ = # %`

- **`Success URL`** redirection usually leads to the store "Success order" page with the order details. Payment status is `"AUTHORIZED"`. You need to perform the steps described in [Payment Processing](/pay-in-4-custom-integration/payment-processing).

- **`Cancel URL`** redirection may lead back to the checkout or cart page and show the message below as customers cancel Tabby session willingly. The payment status for such abandoned sessions is `"EXPIRED"`.

- **`Failure URL`** Redirection also often leads to the checkout or cart page, but **requires the additional banner/note with the General Rejection Message shown below.** Payment status after this is `"REJECTED"`.

| Reason | English message | Arabic message |
|--------|----------------|----------------|
| `Cancellation` | You aborted the payment. Please retry or choose another payment method. | لقد ألغيت الدفعة. فضلاً حاول مجددًا أو اختر طريقة دفع أخرى. |
| `Failure` | Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order | نأسف، تابي غير قادرة على الموافقة على هذه العملية. الرجاء استخدام طريقة دفع أخرى. |

> **Please, redirect your customers to "Thank you" page immediately as soon as you receive one of the redirection callback. Backend payment status verification should be performed separately from the customer's frontend journey.**