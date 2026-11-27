# 백석대 캠퍼스맵

백석대학교 학생 참여형 캠퍼스 생활 정보 지도입니다. 지도 한 화면에서 건물, 학식, 학사일정을 확인하고, 잘못된 정보는 학생이 직접 제보합니다.

화면은 웹(`web/`)으로 만들고, iOS 앱은 이 화면을 네이버 3D 지도 위에 띄웁니다.

![캠퍼스맵 화면](docs/screens.jpg)

## 빠른 실행

### 화면만 확인

설치 없이 예시 데이터로 동작합니다.

```bash
cd web
python3 -m http.server 8765
```

- 주소: <http://localhost:8765>

### 서버 포함

데이터 저장, 관리자 기능, 학식 메뉴가 함께 동작합니다.

```bash
cd server
pip install -r requirements.txt
python seed.py      # 최초 1회: DB 생성
python app.py
```

- 주소: <http://localhost:8000> (화면과 API를 함께 제공)
- 관리자 계정: `admin` / `admin1234`
- macOS에서 `python` 명령이 없으면 `python3`, `pip3`를 사용합니다.

### iOS 앱

Xcode에서 `ios/CampusMap.xcodeproj`를 열어 실행합니다. 같은 Mac에서 서버가 실행 중이면 서버 데이터를, 그렇지 않으면 예시 데이터를 사용합니다.

## 네이버 지도 키 설정

키가 없으면 임시 지도로 동작합니다. iOS 앱에서 3D 지도를 사용하려면 다음과 같이 설정합니다.

1. `ios/Config/Secrets.xcconfig.example`을 복사해 `Secrets.xcconfig`를 만듭니다.
2. `NAVER_MAP_NCP_KEY_ID = <팀 키>`를 입력합니다. 팀 키는 팀 채팅방에서 공유합니다.
3. 다시 빌드합니다.

- `Secrets.xcconfig`는 Git에서 제외되어 있습니다. 저장소가 공개이므로 키는 커밋하지 않습니다.
- 번들 ID `com.example.campusmap`은 키에 등록된 값이므로 변경하지 않습니다.
- 브라우저에서 네이버 지도를 사용하려면 `web/js/config.js`에 같은 키를 입력합니다. 이 파일은 Git에 포함되므로 키를 입력한 상태로 커밋하지 않습니다.

## 파일 구조

| 작업 | 파일 |
|---|---|
| 화면 흐름, 하단 시트, 건물 카드 | `web/js/app.js` |
| 색상, 글꼴, 간격 | `web/css/style.css` |
| 지도, 마커 | `web/js/map.js`, iOS 3D 지도는 `ios/CampusMap/NativeMap.swift` |
| 건물, 식당 데이터 | `web/js/data.js`, `server/seed.py` (동일한 내용이므로 함께 수정) |
| 학사·동아리·축제 일정 | `web/js/data.js`의 `EVENTS` |
| 검색창, 챗봇 AI | `web/js/chatbot.js`, `server/chatbot.py` |
| API, DB | `server/app.py`, `server/schema.sql` ([서버 문서](server/README.md)) |
| 학식 메뉴 자동 생성 | `server/menu_auto.py` |

## 주의 사항

- 서버가 실행 중이 아니면 화면은 `web/js/data.js`의 예시 데이터로 동작합니다.
- `server/schema.sql`이 변경되면 `python seed.py --reset`으로 DB를 다시 만듭니다.
- iOS 앱은 macOS에서만 빌드할 수 있습니다. Windows에서는 `web/`만 수정해도 앱 화면에 그대로 반영됩니다.
- 키와 비밀번호는 커밋하지 않습니다. `Secrets.xcconfig`, `.env`, DB 파일은 Git에서 제외되어 있습니다.
- AI API 키는 웹 코드에 넣지 않고 서버 환경변수로만 읽습니다.
