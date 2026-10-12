import WebKit

/// The renderer's native HTTP path (src/native.js nativeHttpRequest on iOS):
/// `window.webkit.messageHandlers.dgHttp.postMessage([method, url, headersJson, body])`
/// resolves with HttpBridge's `{ status, ok, body, headers?, error? }` JSON.
///
/// Why a message handler and not a dgbridge:// XHR like the other bridge calls:
///   - A dgbridge:// call carries its arguments in the URL, and WebKit prints
///     that URL whenever a load fails. For HTTP the arguments include the
///     request headers, so a failure wrote the GLANCEvault bearer token (and
///     WebDAV credentials) into the Web Inspector console on every retry.
///     A message body is never logged.
///   - An async XHR from dg:// to dgbridge:// is cross-origin and held to the
///     CORS check (#2048 broke every request on iOS that way); a message
///     handler has no origin check to fail.
///   - The reply is asynchronous by construction: the request runs on a
///     background queue and the WebView's main thread never waits (#2048).
///
/// Only the app's own page may use it: the main frame, from the dg:// origin.
final class NativeHttpMessageHandler: NSObject, WKScriptMessageHandlerWithReply {

    static let name = "dgHttp"

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "dg" else {
            replyHandler(nil, "not allowed")
            return
        }
        guard let args    = message.body as? [Any], args.count >= 4,
              let method  = args[0] as? String,
              let url     = args[1] as? String,
              let headers = args[2] as? String,
              let body    = args[3] as? String else {
            replyHandler(nil, "missing args")
            return
        }
        // HttpBridge blocks its calling thread on a semaphore: never the main one.
        DispatchQueue.global(qos: .userInitiated).async {
            let result = HttpBridge.shared.request(method: method, url: url, headersJson: headers, body: body)
            DispatchQueue.main.async { replyHandler(result, nil) }
        }
    }
}
