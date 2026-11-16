import SwiftUI
import WebKit
import CoreLocation

/// 웹(web/index.html)을 띄우는 화면
struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // JS → 네이티브 위치 요청 브릿지 (web/js/app.js 의 requestLocation 참고)
        config.userContentController.add(context.coordinator, name: "campusLocation")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Mac Safari > 개발자 메뉴에서 디버깅 가능
        }
        context.coordinator.webView = webView

        if let remote = AppConfig.remoteURL {
            webView.load(URLRequest(url: remote))
        } else if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    // MARK: - 위치 브릿지
    final class Coordinator: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {
        weak var webView: WKWebView?
        private let manager = CLLocationManager()
        private var pending = false

        override init() {
            super.init()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "campusLocation" else { return }
            pending = true
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .denied, .restricted: sendError("denied")
            default: manager.requestLocation()
            }
        }

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            guard pending else { return }
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted: sendError("denied")
            default: break
            }
        }

        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            guard pending, let loc = locations.last else { return }
            pending = false
            let c = loc.coordinate
            call("\(c.latitude), \(c.longitude), \(loc.horizontalAccuracy), null")
        }

        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
            sendError("failed")
        }

        private func sendError(_ code: String) {
            pending = false
            call("null, null, null, '\(code)'")
        }

        private func call(_ args: String) {
            webView?.evaluateJavaScript("window.__campusLocation && window.__campusLocation(\(args))")
        }
    }
}
