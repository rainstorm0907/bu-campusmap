import UIKit
import WebKit
import NMapsMap

/// 네이버 지도 (아이폰 SDK, 기울이면 건물이 3D 로 보임)
/// - 웹(js/map.js 의 NativeEngine)이 "campusMap" 으로 보내는 명령을 받아 지도에 그린다.
/// - 마커를 누르거나 지도를 누르면 window.__nativeMap 으로 웹에 알린다.
/// - 키가 없으면 만들지 않는다 (웹이 임시 지도를 그림).
final class NativeMap: NSObject, WKScriptMessageHandler, NMFMapViewTouchDelegate, NMFAuthManagerDelegate {
    static func makeIfAvailable() -> NativeMap? {
        let key = (Bundle.main.object(forInfoDictionaryKey: "NMFNcpKeyId") as? String ?? "").trimmingCharacters(in: .whitespaces)
        guard !key.isEmpty, !key.hasPrefix("$(") else { return nil }
        NMFAuthManager.shared().ncpKeyId = key
        return NativeMap()
    }

    /// 처음 보여줄 기울기(도). 0 이면 평면
    static let startTilt: Double = 50
    /// 건물 전체를 맞춘 뒤 더 당길 줌 단계
    static let startZoomIn: Double = 0.25

    let view = NMFMapView()
    weak var webView: PassthroughWebView?
    private var markers: [String: NMFMarker] = [:]
    private var lineOverlays: [NMFOverlay] = []
    private var logo: NMFMarker?
    private var topInset: CGFloat = 0
    private var authFailed = false

    override init() {
        super.init()
        NMFAuthManager.shared().delegate = self
        view.touchDelegate = self
        view.setLayerGroup(NMF_LAYER_GROUP_BUILDING, isEnabled: true)
        view.buildingHeight = 1
        view.minZoomLevel = 14
        view.logoAlign = .leftTop
    }

    // MARK: 웹 → 지도

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "ready":
            if authFailed { js("failed()") }
        case "hit":
            webView?.fullScreenHit = body["full"] as? Bool ?? false
            webView?.hitRects = (body["rects"] as? [[Double]] ?? []).map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            let top = CGFloat(body["top"] as? Double ?? 0)
            if abs(top - topInset) > 1 {
                topInset = top
                view.logoMargin = UIEdgeInsets(top: top + 4, left: 12, bottom: 0, right: 0)
            }
        case "logo":
            setLogo(body)
        case "fit":
            fit(points: latLngs(body["points"]), top: cg(body["top"]), bottom: cg(body["bottom"]))
        case "markers":
            let list = body["list"] as? [[String: Any]] ?? []
            setMarkers(list)
        case "focus":
            focus(NMGLatLng(lat: body["lat"] as? Double ?? 0, lng: body["lng"] as? Double ?? 0), top: cg(body["top"]), bottom: cg(body["bottom"]))
        case "user":
            let pos = body["pos"] as? [String: Double]
            view.locationOverlay.hidden = pos == nil
            if let pos { view.locationOverlay.location = NMGLatLng(lat: pos["lat"] ?? 0, lng: pos["lng"] ?? 0) }
        case "lines":
            setLines(from: body["from"] as? [String: Double], targets: body["targets"] as? [[String: Any]] ?? [])
        default: break
        }
    }

    private func cg(_ v: Any?) -> CGFloat { CGFloat(v as? Double ?? 0) }
    private func latLngs(_ v: Any?) -> [NMGLatLng] {
        (v as? [[String: Double]] ?? []).map { NMGLatLng(lat: $0["lat"] ?? 0, lng: $0["lng"] ?? 0) }
    }

    /// 화면에서 검색창 아래 ~ 시트 위 사이 가운데 (0~1)
    private func visiblePivot(top: CGFloat, bottom: CGFloat) -> CGPoint {
        let h = max(view.bounds.height, 1)
        return CGPoint(x: 0.5, y: min(0.9, max(0.1, (top + (h - bottom)) / 2 / h)))
    }

    /// 건물 전체가 보이는 칸에 들어오게 맞춘 다음, 그 가운데를 기준으로 기울인다
    private func fit(points: [NMGLatLng], top: CGFloat, bottom: CGFloat) {
        guard !points.isEmpty else { return }
        let bounds = NMGLatLngBounds(latLngs: points)
        view.moveCamera(NMFCameraUpdate(fit: bounds, paddingInsets: UIEdgeInsets(top: top + 36, left: 24, bottom: bottom + 24, right: 64)))
        // 네이버 지도는 많이 당길수록 더 기울어지므로, 맞춘 범위보다 조금 당겨서 건물이 서 보이게 한다
        let params = NMFCameraUpdateParams()
        params.zoom(to: view.zoomLevel + Self.startZoomIn)
        params.tilt(to: Self.startTilt)
        let tilt = NMFCameraUpdate(params: params)
        tilt.pivot = visiblePivot(top: top, bottom: bottom)
        view.moveCamera(tilt)
    }

    private func focus(_ target: NMGLatLng, top: CGFloat, bottom: CGFloat) {
        let update = view.zoomLevel < 17 ? NMFCameraUpdate(scrollTo: target, zoomTo: 17.2) : NMFCameraUpdate(scrollTo: target)
        update.pivot = visiblePivot(top: top, bottom: bottom)
        update.animation = .easeOut
        update.animationDuration = 0.35
        view.moveCamera(update)
    }

    private func setMarkers(_ list: [[String: Any]]) {
        var seen = Set<String>()
        for item in list {
            guard let id = item["id"] as? String, let lat = item["lat"] as? Double, let lng = item["lng"] as? Double else { continue }
            seen.insert(id)
            let selected = item["selected"] as? Bool ?? false
            let m = markers[id] ?? {
                let m = NMFMarker()
                m.anchor = CGPoint(x: 0.5, y: 0.5)
                m.captionAligns = [NMFAlignType.right]
                m.captionOffset = 2
                m.captionHaloColor = .white
                m.isHideCollidedSymbols = true
                m.touchHandler = { [weak self] _ in self?.js("markerTap(\(Self.quote(id)))"); return true }
                markers[id] = m
                return m
            }()
            m.position = NMGLatLng(lat: lat, lng: lng)
            m.iconImage = MarkerArt.dot(color: item["color"] as? String ?? "#4A7DFF", type: item["type"] as? String ?? "lecture", selected: selected)
            m.captionText = item["name"] as? String ?? ""
            m.captionTextSize = selected ? 14 : 12.5
            m.captionColor = selected ? UIColor(hex: "#174BB0") : UIColor(hex: "#1D1D1F")
            m.alpha = (item["dim"] as? Bool ?? false) ? 0.28 : 1
            m.zIndex = selected ? 20 : 10
            if m.mapView == nil { m.mapView = view }
        }
        for (id, m) in markers where !seen.contains(id) { m.mapView = nil; markers[id] = nil }
    }

    private func setLogo(_ body: [String: Any]) {
        guard let lat = body["lat"] as? Double, let lng = body["lng"] as? Double else { return }
        let m = logo ?? NMFMarker()
        m.position = NMGLatLng(lat: lat, lng: lng)
        if let src = body["src"] as? String, let url = Bundle.main.url(forResource: src, withExtension: nil, subdirectory: "web"),
           let img = UIImage(contentsOfFile: url.path) {
            m.iconImage = MarkerArt.logo(img)
        }
        m.captionText = body["name"] as? String ?? ""
        m.captionAligns = [NMFAlignType.top]
        m.captionTextSize = 12
        m.captionColor = UIColor(hex: "#1F4FA8")
        m.captionHaloColor = .white
        m.isHideCollidedSymbols = true
        m.zIndex = 5
        m.mapView = view
        logo = m
    }

    private func setLines(from: [String: Double]?, targets: [[String: Any]]) {
        lineOverlays.forEach { $0.mapView = nil }
        lineOverlays = []
        guard let from else { return }
        let a = NMGLatLng(lat: from["lat"] ?? 0, lng: from["lng"] ?? 0)
        for t in targets {
            guard let lat = t["lat"] as? Double, let lng = t["lng"] as? Double else { continue }
            let b = NMGLatLng(lat: lat, lng: lng)
            if let line = NMFPolylineOverlay([a, b]) {
                line.color = UIColor(hex: "#FF7A2F")
                line.width = 3
                line.pattern = [6, 5]
                line.mapView = view
                lineOverlays.append(line)
            }
            let label = NMFMarker(position: NMGLatLng(lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2))
            label.iconImage = MarkerArt.empty
            label.captionText = t["label"] as? String ?? ""
            label.captionAligns = [NMFAlignType.center]
            label.captionColor = UIColor(hex: "#B34A00")
            label.captionHaloColor = .white
            label.mapView = view
            lineOverlays.append(label)
        }
    }

    // MARK: 지도 → 웹

    func mapView(_ mapView: NMFMapView, didTapMap latlng: NMGLatLng, point: CGPoint) { js("mapTap()") }
    func mapView(_ mapView: NMFMapView, didTap symbol: NMFSymbol) -> Bool { false }

    func authorized(_ state: NMFAuthState, error: Error?) {
        guard state == .unauthorized else { return }
        // 키가 틀렸거나 번들 ID 가 등록되지 않음 → 지도를 치우고 웹 임시 지도로
        authFailed = true
        view.removeFromSuperview()
        webView?.passthrough = false
        js("failed()")
        print("[CampusMap] 네이버 지도 인증 실패: \(error?.localizedDescription ?? "-")")
    }

    private func js(_ call: String) {
        webView?.evaluateJavaScript("window.__nativeMap && window.__nativeMap.\(call)")
    }
    private static func quote(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [s])
        return String(data: data ?? Data("[\"\"]".utf8), encoding: .utf8).map { String($0.dropFirst().dropLast()) } ?? "\"\""
    }
}

/// 마커 그림 (웹 마커와 같은 모양: 흰 테두리 동그라미 + 종류 아이콘)
enum MarkerArt {
    private static var cache: [String: NMFOverlayImage] = [:]
    private static let symbols = [
        "lecture": "graduationcap.fill", "food": "fork.knife", "sport": "figure.run", "art": "paintpalette.fill",
        "hall": "music.note", "library": "book.fill", "office": "building.2.fill", "dorm": "bed.double.fill",
    ]

    static func dot(color: String, type: String, selected: Bool) -> NMFOverlayImage {
        let key = "\(color)|\(type)|\(selected)"
        if let hit = cache[key] { return hit }
        let size: CGFloat = selected ? 32 : 24, pad: CGFloat = 3, full = size + pad * 2
        let image = UIGraphicsImageRenderer(size: CGSize(width: full, height: full)).image { ctx in
            let rect = CGRect(x: pad, y: pad, width: size, height: size)
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 3, color: UIColor.black.withAlphaComponent(0.3).cgColor)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: rect).fill()
            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            UIColor(hex: color).setFill()
            UIBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2)).fill()
            let config = UIImage.SymbolConfiguration(pointSize: size * 0.4, weight: .bold)
            if let s = UIImage(systemName: symbols[type] ?? "graduationcap.fill", withConfiguration: config)?.withTintColor(.white, renderingMode: .alwaysOriginal) {
                s.draw(in: CGRect(x: (full - s.size.width) / 2, y: (full - s.size.height) / 2, width: s.size.width, height: s.size.height))
            }
        }
        let made = NMFOverlayImage(image: image, reuseIdentifier: key)
        cache[key] = made
        return made
    }

    static func logo(_ emblem: UIImage) -> NMFOverlayImage {
        let full: CGFloat = 40
        let image = UIGraphicsImageRenderer(size: CGSize(width: full, height: full)).image { ctx in
            let rect = CGRect(x: 3, y: 3, width: 34, height: 34)
            ctx.cgContext.setShadow(offset: CGSize(width: 0, height: 1), blur: 4, color: UIColor.black.withAlphaComponent(0.3).cgColor)
            UIColor.white.setFill()
            UIBezierPath(ovalIn: rect).fill()
            ctx.cgContext.setShadow(offset: .zero, blur: 0, color: nil)
            emblem.draw(in: rect.insetBy(dx: 3, dy: 3))
        }
        return NMFOverlayImage(image: image, reuseIdentifier: "campus-logo")
    }

    static let empty = NMFOverlayImage(image: UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).image { _ in }, reuseIdentifier: "empty")
}

extension UIColor {
    convenience init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(red: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}
