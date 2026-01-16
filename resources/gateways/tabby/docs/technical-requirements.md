# Technical Requirements

This page gives you the common knowledge about Tabby operating.

---

## Status Page

[Tabby Status Page](https://www.tabby-status.com/) offers live status, maintenance alerts and incident history reports for Tabby Services. Please subscribe to our Status Page to stay informed about all changes and maintenance works and be able to manage your sales according to it.

---

## Security Protocol

**TLS** is an industry-standard protocol for encrypting network communications and establishing the identity of websites over the Internet. Tabby API supports TLS version 1.2 and higher. Additionally, we rely on **HTTPS** to ensure all data is transmitted securely.

Strongly restricted cipher suites for compliance with the Payment Card Industry Data Security Standard. Enhances payment card data security:

```
TLSv1.3:
TLS_AES_128_GCM_SHA256
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256

TLSv1.2:
TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256
TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384
TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256
TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256
TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
```

---

## Whitelists

Tabby uses several IP addresses when sending webhook requests and new IPs may be utilized as our systems scale and new resources are brought online. Please allow this list of IP addresses to prevent webhook calls from failing:

```
34.166.36.90
34.166.35.211
34.166.34.222
34.166.37.207
34.93.76.191
```

---

## Data Format

Request and response data are formatted as **JSON**. The following data formats are used across all Tabby APIs:

### Currency

We use the [ISO 4217](https://en.wikipedia.org/wiki/ISO_4217) standard for defining currencies.

```json
{
  "currency": "AED"
}
```

### Amount

We expect amounts in minor units according to the [ISO 4217](https://en.wikipedia.org/wiki/ISO_4217) standard. That means they are formatted in the smallest unit of currency.

Tabby allows to send:
- Up to **2 decimals** for *AED* and *SAR*
- Up to **3 decimals** for *KWD*

```json
{
  "amount": "100.00"
}
```

### Phone

The following mobile phone formats are accepted, using the UAE +971 mask and phone number as an example:

```json
{
  "phone": "+971500000001" // OR "971500000001", "500000001", "0500000001"
}
```

### Merchant Code

Merchant code is a unique store identifier under one brand and should be sent as a string value. Usually `merchant_code` represents a merchant country or a specific store within the country.

### Dates

The [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) standard with combined Date and Time in UTC for all API dates. The exceptions to this are `dob` fields where we accept values in the **YYYY-MM-DD** format.

```json
{
  "registered_since": "2019-08-24T14:15:22Z",
  "dob": "2019-08-24"
}
```

### Locale

Operating in the GCC region, Tabby supports the English and Arabic languages and refers to the [RFC 1766](https://en.wikipedia.org/wiki/IETF_language_tag#List_of_common_primary_language_subtags) standard.

```json
{
  "lang": "en"
}
```

### String Length Validation

We are processing a maximum of 255 symbols in the **"string"** field.

### Allowed characters in redirect URLs ("success", "cancel", "failure")

1. Latin letters (a-z, A-Z)
2. Arabic letters (ء-ي)
3. Digits (0-9)
4. Special characters - `\ | / : ;., + {}? & @ = # %`

---

## Rate Limit

API rate limiting is implemented to maintain stable operations for Tabby services. If an excessive number of requests are sent in a short time, rate limiting may be applied to your requests.

The response will include an HTTP status code `429 error` when rate limiting is triggered.

Rate limits are enforced per API Key and are measured on a per-operation basis. Operations are categorized into **Create Session** and **Payment** operations.

- **Live API Keys**: The rate limit is 200 Create Session operations per 10 seconds, while other operations are limited to 100 requests per second.
- **Testing API Keys**: The rate limit is 10 requests per 10 seconds for Create Session operations and 50 requests per second for other operations.

> **Note:** Tabby doesn't allow any Performance testing with the Production APIs involved. Kindly exclude Tabby method from checkout when executing load or stress testing. These Keys and IP addresses might be automatically limited by a firewall. Also such Test or Live API keys payments might be limited manually upon detection.

---

## Authentication

To authenticate with Tabby you will use your API credentials and HTTP basic auth.

These credentials consist of two elements:

- **Secret Key**: Associated with your merchant account, this key is used to authorize requests to Tabby's Checkout and Payments APIs. Include the Secret key as an authorization header with every request.
- **Public Key**: Associated with your merchant account, this key is used for promo snippets, plans, and customization support.

Live API keys can be obtained:
- From Tabby Merchant Dashboard for **Self-Hosted plugin** integration
- By contacting Tabby account manager after QA testing carried out by Tabby team is completed for **Custom API** integration

If the credentials are missing or wrong, Tabby will respond with `401 Not authorized`. More information on HTTP Basic auth can be found in the API Reference article.

---

## Errors

Tabby APIs use HTTP status codes alongside the error objects to handle errors. When an API call fails, Tabby will respond with a 4xx status code and a response body containing an error object with the error code, an array of error messages and a unique correlation ID to identify the request.

The error object contains an `error_code` and an `errorType` value (or `errors`).

The `error` object is a human-readable English message to aid in debugging. The `message` is not meant to be displayable to end-users, nor it is meant to be machine-readable. It should be seen as something that the client would log to assist in debugging, but it's never meant to be in any way parsed by the client.

---

## Supported Browsers & Devices

We support all common-spread desktop and mobile browsers and mobile devices.

As part of our development process, we test among all major browsers and across different versions of browsers. However, we do not support browsers that no longer receive security updates. Please, contact us if you have an issue with Tabby Checkout on a specific browser so we can improve its support.

### Browsers & Versions

Chrome, Firefox, Safari and Microsoft Edge are supported on all platforms for three years from the version release. We also test across different mobile platforms: iOS 12 and above and Android 7 and above.