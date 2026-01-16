```curl
curl --request POST \
 --url https://api-sandbox.tamara.co/webhooks \
 --header 'accept: application/json' \
 --header 'content-type: application/json' \
 --data '
{
 "type": "order",
 "events": [
 "order_approved",
 "order_authorised",
 "order_canceled",
 "order_updated",
 "order_captured",
 "order_refunded"
 ],
 "url": "https://www.enteryoursitehere.com/webhooks",
 "headers": {
 "authorization": "123344-1231-abcd-adfe-123456"
 }
}
'
```

Click `Try It!` to start a request and see the response here! Or choose an example:
application/json

***

*Updated 6 months ago*

---
* [Retrieve Webhook URL using Webhook ID](/reference/retrievewebhookurlusingwebhookid)
* [Update Webhook URL using Webhook ID](/reference/updatewebhookurlusingwebhookid)
* [Delete Webhook URL using Webhook ID](/reference/deletewebhookurlusingwebhookid)
* [Retrieve List of registered Webhook URLs](/reference/retrievelistofregisteredwebhookurls)

Did this page help you?