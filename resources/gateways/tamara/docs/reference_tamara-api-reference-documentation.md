# Welcome to our API Explorer!

We're happy that you've decided to team with us and explore our Integration.

To proceed with the setup, you would need access to a sandbox account from **Tamara** that will include the authentication tokens and your **Tamara** Partners Portal account access credentials.

Once the integration and testing is completed on the sandbox environment, please inform us, so that we can verify it and proceed to share the production credentials with you to go live with **Tamara**.

Kindly check our detailed guide before starting the technical integration process: **[Tamara Integration Documentation and Guides](/docs/)**

# Getting a merchant account

When merchants sign up for a **Tamara** merchant account, merchants will be provided with an **API token**, **Notification token** and **Public Key**\*(to display widgets on online integrations only)\*. Merchants authenticate yourself with Tamara's API token by providing the bearer API token in the request Authorization header.

## Base URLs

During integration, **Tamara** provides merchants with a sandbox endpoint to use while integrating, make sure to use it during integration and testing.

```
https://api-sandbox.tamara.co
```

```
https://api.tamara.co
```

> 📘 Make sure to use the correct base URL for sandbox/production environment

## API Token

Merchant can authenticate with Tamara's APIs by providing their API token in the request's Authorization header as a bearer token.

> Authorization: Bearer {API Token}

## Notification token

**Tamara** will notify merchant's webhook endpoint URL with a notification payload using the (HTTP POST request) method when order status is updated at Tamara's end with the events(status changes) you registered in Step [[3]](/docs/transaction-authorisation#3-enter-the-following-information-then-click-on-create-webhook)

**Tamara** provides a Notification Token to merchants to authenticate the notifications received from **Tamara**. This JWT token will be attached to the webhook/notification endpoint as a query parameter called *tamaraToken* as well as having that *tamaraToken* in the authorization header as Bearer *tamaraToken* (Check examples below for more info).

*tamaraToken* is an encoded JWT token using HS256 algorithm, and merchants can use the Notification Token provided by **Tamara**, to decode it, to ensure that the payload sent to your Webhook URL endpoint is sent from **Tamara** without any modifications (security aspect).

## Public Key

**Tamara's** Public Key is required to generate the Tamara Product Widget, Cart Widget, and Checkout Widget.

For more info check out our [Widgets - Promotional Messaging page](/docs/direct-widgets).

> 🚧 Please keep your tokens securely guarded and don’t share them.