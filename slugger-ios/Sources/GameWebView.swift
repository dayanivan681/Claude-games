import SwiftUI
import UIKit
import WebKit

/// Runs the web game bundled from ../slugger full screen. The game itself is unchanged; this shell
/// serves it from a private `slugger://` origin (so its save in localStorage persists), adds native
/// haptics through the `haptic` message bridge, and keeps the page from scrolling, zooming or
/// showing link previews.
struct GameWebView: UIViewRepresentable {
    func makeCoordinator() -> HapticBridge { HapticBridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.websiteDataStore = .default()
        config.userContentController.add(context.coordinator, name: "haptic")

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0x12 / 255, green: 0x0D / 255, blue: 0x0A / 255, alpha: 1)
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.allowsLinkPreview = false
        #if DEBUG
        web.isInspectable = true   // Safari > Develop > [device] to debug the game
        #endif
        web.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://game/index.html")!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Receives `window.webkit.messageHandlers.haptic.postMessage("light" | "medium" | "heavy")`.
final class HapticBridge: NSObject, WKScriptMessageHandler {
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let medium = UIImpactFeedbackGenerator(style: .medium)
    private let heavy = UIImpactFeedbackGenerator(style: .heavy)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.body as? String {
        case "heavy": heavy.impactOccurred()
        case "medium": medium.impactOccurred()
        default: light.impactOccurred()
        }
    }
}

/// Serves files from the app bundle's `slugger` folder at `slugger://game/...`.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "slugger"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("slugger", isDirectory: true)

    private static let mimeTypes = [
        "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
        "webmanifest": "application/manifest+json", "png": "image/png", "webp": "image/webp", "svg": "image/svg+xml",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": mime, "Cache-Control": "no-cache"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
