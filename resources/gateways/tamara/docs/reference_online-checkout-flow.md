# Online Order Status Flow

# Online Order Status Description

## new

Customer has initiated the checkout session with **Tamara** as a payment method.

## declined

Customer was declined to continue the payment with **Tamara**.

## expired

* Customer did not complete the payment with **Tamara** within 30 minutes of checkout session being created, or
* Order was not `authorised` within 72 hours, or the `authorised` order was not `captured` or `canceled` within 90 days(our team will contact you in this case to fix this issue).

> 📘 **Important Note**
>
> Incomplete orders such as (`declined`/`expired`) won't be listed on **Tamara's** partner portal.

## approved

Customer placed a new order, and completed the 1st payment successfully.

## authorised

**Tamara** verified the customer’s payment and merchant authorised the order to be valid. You can consider the order paid at this stage and proceed to capturing the order once shipped or fulfilled.

> 📘 **Important Notes**
>
> 1. Orders should **NOT** be left pending at `approved` status, as it would usually indicate a technical/status sync issue and must be addressed immediately by:
>     1. Authorising it, then canceling it or capturing it depending on the intended status at your end.
>     2. Double-checking the implemented method for authorisation.
> 2. Authorisation acts as an order acknowledgement, and it is mandatory for the order to proceed to the next statuses.

## fully_captured

Order has been fully shipped/fulfilled by the merchant to the customer.

> 📘 If an order is not Captured within 21 days from when it is Authorised, Tamara will auto-capture that order and it will be moved to Fully Captured status

## partially_captured

Part of the order has been shipped/fulfilled by the merchant to the customer.

> 📘 **Important Notes**
>
> 1. Capturing acts as a confirmation that the order amount will be added to the merchant's next settlement.
> 2. Capture could map to ‘shipping’ or ‘fulfilling’, depending on the merchant use-case and setup.

## fully_refunded

The order amount has been fully refunded by **Tamara** to the customer at the merchant's request.

## partially_refunded

Part of the order amount has been refunded by **Tamara** to the customer at the merchant's request.

## canceled

Order has been completely canceled before shipping (capturing) while on the `authorised` status.

## updated (Partially Canceled)

Part of the order has been canceled before shipping (capturing) while on the `authorised` status.

---