# bu-campusmap

백석대학교 학생 참여형 캠퍼스 생활 정보 지도. 지도 위에서 건물, 학식, 학사일정, 시설 제보를 한 화면에 봐요.

## 폴더

| 폴더 | 내용 |
|---|---|
| `web/` | 화면 전부 (HTML/CSS/JS). 브라우저와 iOS 앱이 같이 씀 |
| `ios/` | `web/` 을 띄우는 iOS 앱 (SwiftUI + WKWebView) |

`web/js` 안:

- `app.js` 화면 흐름 (하단 시트: 학사일정 홈, 목록, 건물 요약, 건물 페이지), 학식, 제보, 챗봇 연결
- `map.js` 지도. 네이버 지도 키가 있으면 네이버 지도, 없으면 캠퍼스 모양을 그린 임시 지도
- `data.js` 건물·학사일정·공지 데이터. 건물 좌표는 OpenStreetMap 실제 위치, 종류·시설·혼잡도·평가는 예시값
- `campus-shapes.js` 임시 지도용 캠퍼스 윤곽 (OpenStreetMap)
- `config.js` 네이버 지도 키 넣는 곳

## 실행

브라우저:

```sh
cd web
python3 -m http.server 8000
# http://localhost:8000
```

iOS 앱: `ios/CampusMap.xcodeproj` 를 Xcode 로 열고 시뮬레이터에서 실행. 앱 안에 `web/` 폴더가 그대로 들어가요.

## 네이버 지도 키

키가 없어도 임시 지도로 다 동작해요.

**iOS 앱 (3D 건물이 보이는 네이버 지도)**

앱은 아래에 네이버 지도(아이폰 SDK)를 깔고, 그 위에 `web/` 화면을 투명하게 겹쳐요. 지도를 기울이면 학교 건물이 입체로 보여요.

1. NCP 콘솔 > Application 에서 Mobile Dynamic Map 을 켜고, iOS 번들 ID 를 등록해요. 지금 번들 ID 는 `com.example.campusmap` (`ios/Config/Base.xcconfig`).
2. `ios/Config/Secrets.xcconfig.example` 을 `ios/Config/Secrets.xcconfig` 로 복사하고 Client ID 를 넣어요. 이 파일은 깃에 안 올라가요.
3. Xcode 로 다시 빌드해요. 처음 열 때 네이버 지도 패키지를 내려받아요.

관련 코드: `ios/CampusMap/NativeMap.swift` (지도), `ios/CampusMap/WebView.swift` (겹치기), `web/js/map.js` 의 `NativeEngine` (웹 → 지도 명령)

**브라우저**

1. NCP 콘솔 > Application 에서 Web Dynamic Map 을 켜고, 지도를 여는 주소(`http://localhost`, 배포 주소)를 웹 서비스 URL 에 등록해요. 포트는 빼고 적어요.
2. `web/js/config.js` 의 `NAVER_MAP_KEY_ID` 에 Client ID 를 넣어요.

웹 네이버 지도는 기울이기가 없어서 평면으로 보여요.

## 검색창에 AI 붙이는 자리

- 검색창 "무엇이든 물어보세요": `web/js/app.js` 의 검색 부분 (`searchForm` 제출). 지금은 건물·시설·분실물을 글자로 찾아요.
- 답을 만드는 곳: `web/js/chatbot.js` 의 `CampusBot.reply(text, ctx)`. `{ text, buildingId? }` 를 돌려주면 돼요. `buildingId` 가 있으면 지도에서 그 건물로 갈 수 있어요.
- AI API 키는 웹 코드에 넣지 말고 서버를 거쳐서 불러요. 웹 코드는 누구나 볼 수 있어요.
