# Usage on Desktop / Mobile Web
If you are integrating Tamara only on your website, then please be assured that our UAE KYC IDV flow works seamlessly on desktop or mobile web mode.

# Usage on Mobile Application via WebView
If you are integrating Tamara on your Mobile applications, then you need to enable permissions for UAE KYC'S ID verification Web SDK into your application via WebView. To make this work effectively, your app needs to grant camera permissions properly.

## Why do you need to Enable Camera Permissions?
The camera is the backbone of Tamara’s ID verification process. It allows your customers to scan their IDs quickly and securely within your app.

> ❗️ ### Without proper camera access:
> * Your customers might face delays or errors, leading to frustration and potential drop-offs.
> * The verification process could fail, affecting your ability to onboard users or process transactions efficiently.
> * You risk losing trust from customers who expect a fast, reliable, and modern experience.

By enabling camera permissions correctly, you ensure:

*   **Faster onboarding:** Customers can complete verification in seconds, boosting conversion rates.
*   **Enhanced security:** Proper camera integration supports accurate ID scans, reducing fraud risks.
*   **Better user experience:** A seamless process keeps customers happy and engaged with your services.

## Tips for WebView usage
1.  **Enable JavaScript in WebView**
    *   UAE KYC'S SDK relies on JavaScript to function. Without it, the verification process won’t even start.
    *   *What to do:* Ensure JavaScript is turned on in your WebView settings.
2.  **Enable allowsInlineMediaPlayback (iOS)**
    *   This setting lets the camera work directly within the WebView, avoiding pop-ups or redirects that confuse users.
    *   *What to do:* Add this to your iOS WebView configuration.
3.  **Use WebChromeClient (Android)**
    *   Android’s default WebView doesn’t handle camera permissions well on its own. WebChromeClient bridges that gap, ensuring smooth camera access.
    *   *What to do:* Implement WebChromeClient in your Android setup.

---

## How to Implement Camera Permissions?

> 📘 ### **Platform Compatibility**
> The implementation should be compatible with both iOS and Android platforms.

**For Android:**
[How to access the camera from within a Webview?](https://stackoverflow.com/questions/40659198/how-to-access-the-camera-from-within-a-webview)

[Android Webview (default) with Runtime Permissions via k0shk0sh PermissionsHelper](https://gist.github.com/digitalprecision/735820df14f696fc2c6c8b251b2b05d6)

**For iOS:**
[iOS WKWebview: Always allow camera permission](https://stackoverflow.com/a/72729381)

[Access camera and microphone in WKWebView](https://forums.developer.apple.com/forums/thread/134216)

## How to test whether the UAE KYC flow is working properly for your setup?
We have added the new ID verification flow on our sandbox and you can test the flow to ensure camera permissions are granted on Android and iOS. To test, please follow the instructions here: [For 🇦🇪 UAE KYC ID verification process](/docs/testing-scenarios#/for--uae-uqudo-id-verification-process)

## Common Troubleshooting steps
If something goes wrong (for e.g., if the camera loads as a video player or if the scan box doesn’t show up), here’s how to fix it:

**For Android:**
Ensure to implement the below to manage camera permissions effectively:

```
WebChromeClient
```

**For IOS:**
Try to enable allowsInlineMediaPlayback:

```
webConfiguration.allowsInlineMediaPlayback = true
```

or

```
webView.configuration.allowsInlineMediaPlayback = true
```

> 👍 ### Enabling camera permissions isn’t just a technical checkbox—it’s about delivering a reliable, efficient, and secure experience to your customers.
> By following these guidelines, you’ll:
>
> ✅ Save time by avoiding verification hiccups.
> ✅ Build trust with a professional, frustration-free process.
> ✅ Keep your business running smoothly with happy customers.
>
> For further help, revisit the linked resources or contact our integration team.
>
> Let’s make this a success together!

---
