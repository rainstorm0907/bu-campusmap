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

키가 없어도 임시 지도로 다 동작해요. 실제 네이버 지도를 쓰려면:

1. NCP 콘솔 > Application 에서 Web Dynamic Map 을 켜고 Client ID 를 받아요.
2. 지도를 여는 주소(`http://localhost`, 배포 주소)를 웹 서비스 URL 에 등록해요. 포트는 빼고 적어요.
3. `web/js/config.js` 의 `NAVER_MAP_KEY_ID` 에 Client ID 를 넣어요.

앱은 폰 안의 파일로 웹을 열어서 웹 지도 인증이 안 돼요. 앱에서 네이버 지도를 보려면 웹을 배포하고 `ios/CampusMap/AppConfig.swift` 의 `remoteURL` 에 그 주소를 넣어요.
