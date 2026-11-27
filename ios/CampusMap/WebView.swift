import SwiftUI
import WebKit
import CoreLocation

/// 앱 화면
/// - 키가 있으면 아래에 네이버 지도(NativeMap.swift), 위에 웹(web/index.html)을 투명하게 겹친다.
///   웹은 검색창, 시트, 버튼만 그리고 그 밖을 누르면 손가락이 아래 지도로 내려간다.
/// - 키가 없으면 웹 하나만 띄운다 (웹이 임시 지도를 그림).
struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIView {
        let root = UIView()
        root.backgroundColor = .systemBackground

        let config = WKWebViewConfiguration()
        // JS → 네이티브 위치 요청 브릿지 (web/js/app.js 의 requestLocation 참고)
        config.userContentController.add(context.coordinator, name: "campusLocation")

        let map = NativeMap.makeIfAvailable()
        if let map {
            // JS → 네이버 지도 (web/js/map.js 의 NativeEngine 참고)
            config.userContentController.add(map, name: "campusMap")
            config.userContentController.addUserScript(WKUserScript(source: "window.CAMPUS_NATIVE_MAP = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            map.view.frame = root.bounds
            map.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            root.addSubview(map.view)
        }

        let webView = PassthroughWebView(frame: root.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.passthrough = map != nil
        if #available(iOS 16.4, *) {
            webView.isInspectable = true   // Mac Safari > 개발자 메뉴에서 디버깅 가능
        }
        root.addSubview(webView)
        map?.webView = webView
        context.coordinator.webView = webView

        if let remote = AppConfig.remoteURL {
            webView.load(URLRequest(url: remote))
        } else if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return root
    }

    func updateUIView(_ uiView: UIView, context: Context) {}

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

/// 웹이 알려준 칸(검색창, 시트, 버튼)만 손가락을 받고, 나머지는 아래 지도로 넘기는 웹 화면
final class PassthroughWebView: WKWebView {
    var passthrough = false
    var hitRects: [CGRect] = []
    var fullScreenHit = false   // 제보 창처럼 화면 전체를 덮는 창이 열려 있을 때

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard passthrough, !fullScreenHit else { return super.hitTest(point, with: event) }
        return hitRects.contains { $0.contains(point) } ? super.hitTest(point, with: event) : nil
    }
}
