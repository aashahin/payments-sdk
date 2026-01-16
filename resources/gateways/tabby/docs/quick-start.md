# Quick Start

## Integration Overview

This guide describes how to integrate Tabby Payments into your Website or Mobile App using direct API integration. The integration lets your customers pay online securely via Tabby, while you maintain full control over the checkout and order fulfillment process.

**Typical Integration Flow:**

1. **Eligibility Check:**  
   Your backend checks the customer's eligibility with Tabby using the Tabby API before displaying Tabby as a payment option.

2. **Session Creation:**  
   If eligible, your system creates a Tabby payment session via API and obtains a secure Hosted Payment Page URL.

3. **Customer Redirection:**  
   The customer is redirected to Tabby Hosted Payment Page to complete the payment.

4. **Payment Completion:**  
   Tabby processes the payment and redirects the customer back to your site or app.  
   **Important:** Always verify the payment status on your backend using Tabby API or webhooks. Do not rely solely on redirect URLs or query parameters.

5. **Order Fulfillment:**  
   Upon successful payment authorization, fulfill the order and update your Order Management System (OMS).

---

## Step-by-Step Integration Checklist

1. [Register for a Tabby merchant account](https://merchant.tabby.ai/) and complete your application to obtain access to Tabby Merchant Dashboard

2. Retrieve your test API keys and merchant codes from Tabby Merchant Dashboard or your Tabby account manager

3. Implement the [Checkout Flow for your Website](/pay-in-4-custom-integration/checkout-flow) or [Mobile App](/pay-in-4-custom-integration/mobile-apps/sdk-all) using Tabby API endpoints and follow the eligibility check process

4. Integrate [Payment Processing](/pay-in-4-custom-integration/payment-processing) on your backend to handle payment status updates, order fulfillment and error handling

5. Add [Tabby promotional messaging](/pay-in-4-custom-integration/on-site-messaging) to your store to increase customer awareness and conversion rates

6. [Test your integration](/testing-guidelines/testing-credentials) thoroughly using Tabby's test credentials.  
   Share your staging site or test app with the Tabby Integrations Team for QA and feedback

7. Coordinate your marketing campaign and go-live plan with your Tabby account manager

8. After successful testing and approval, request your live API keys and deploy your integration to production

