import Foundation

enum AppConfig {
    /// 웹을 서버에 배포했다면 그 주소를 넣으세요. (예: URL(string: "https://campusmap.example.com"))
    /// - nil 이면 앱 안에 포함된 web 폴더(../web)를 엽니다.
    /// - 네이버 지도 API 는 등록된 서비스 URL 에서만 동작하므로,
    ///   앱에서 실제 네이버 지도를 띄우려면 배포 주소를 넣는 것을 권장합니다.
    static let remoteURL: URL? = nil
}
