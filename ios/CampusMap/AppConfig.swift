import Foundation

enum AppConfig {
    /// 웹을 서버에 배포했다면 그 주소를 넣으세요. (예: URL(string: "https://campusmap.example.com"))
    /// - nil 이면 앱 안에 포함된 web 폴더(../web)를 엽니다.
    /// - 네이버 지도 API 는 등록된 서비스 URL 에서만 동작하므로,
    ///   앱에서 실제 네이버 지도를 띄우려면 배포 주소를 넣는 것을 권장합니다.
    static let remoteURL: URL? = nil

    /// 백엔드(server/app.py) 주소. 앱 안의 web 폴더(file://)로 열 때 이 주소의 API 를 사용합니다.
    /// - 시뮬레이터 + 내 맥에서 서버 실행: "http://localhost:8000"
    /// - 배포 후: "https://<배포주소>"
    /// - nil 이면 서버 없이 예시 데이터(web/js/data.js)로 동작
    /// - 서버가 꺼져 있어도 앱은 예시 데이터로 동작합니다.
    static let apiBaseURL: String? = "http://localhost:8000"
}
