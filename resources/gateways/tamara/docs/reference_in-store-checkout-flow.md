# In-Store Order Status Flow

# In-store Order Status Description

## *new*
Merchant has initiated the checkout session with **Tamara** as a payment method for the customer and payment link sent to customer via SMS/Email by **Tamara**.

## *declined*
Customer was declined to continue the payment with **Tamara**.

## *expired*
Customer did not complete the payment with **Tamara** within 15 minutes of checkout session being created, and payment link URL opened on their phones.

> 📘 **Important Note**
> Incomplete orders such as (`declined`/`expired`) won't be listed on **Tamara's** partner portal.

## fully_captured
Customer completed the 1st payment successfully and order has been `fully_captured` by the merchant(no interaction needed from Merchant to capture, this is automatic) and customer is eligible to leave with their products.

## fully_refunded
The order amount has been fully refunded by **Tamara** to the customer at the merchant's request.

## partially_refunded
Part of the order amount has been refunded by **Tamara** to the customer at the merchant's request.