import SwiftUI

@main
struct CampusMapApp: App {
    var body: some Scene {
        WindowGroup {
            WebView()
                .ignoresSafeArea()   // 웹(CSS)에서 safe-area 를 직접 처리
        }
    }
}
