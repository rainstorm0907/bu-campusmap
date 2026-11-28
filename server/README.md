# 캠퍼스맵 서버: DB·인증·공통 API·배포 (1번 담당)

Flask와 SQLite로 만든 서버예요. 이 서버 하나가 **web 폴더(프론트)와 `/api/*`를 같은 주소로 함께 제공**해요.
그래서 브라우저로 열면 `js/api.js`가 따로 설정하지 않아도 이 API를 사용해요.

## 1. 로컬 실행

```bash
cd server
pip install -r requirements.txt
python seed.py          # 최초 1회: DB 생성, 예시 데이터, 관리자 계정(admin / admin1234)
python app.py           # http://localhost:8000
```

- DB를 처음부터 다시 만들 때: `python seed.py --reset`
- 관리자 비밀번호 지정: `ADMIN_PASSWORD=원하는비번 python seed.py --reset`
- iOS 시뮬레이터: `ios/CampusMap/AppConfig.swift`의 `apiBaseURL`이 기본값 `http://localhost:8000`이에요.
  실제 아이폰에서 테스트하려면 맥의 IP(예: `http://192.168.0.10:8000`)나 배포 주소로 바꿔야 해요.

### 차량 이동 시간 (네이버 실시간 교통)

길찾기 화면의 차량 시간은 `/api/route`가 네이버 Directions 5에 물어봐서 채워요 (`routing.py`).
키가 없으면 화면은 직선거리로 계산한 예상값을 보여줘요.

1. NCP 콘솔의 Maps Application(지도 키와 같은 것)에서 **Directions 5**를 켜요.
2. `server/.env` 파일을 만들고 두 줄을 적어요. 이 파일은 깃에 올라가지 않아요.
   ```
   NAVER_MAP_KEY_ID=Client ID
   NAVER_MAP_KEY=Client Secret
   ```
3. 서버를 다시 켜요. 확인: `http://localhost:8000/api/route?from=36.840169,127.184518&to=36.837766,127.184041`

## 2. 폴더 구조

```
server/
  app.py        라우트(API) 전체
  db.py         DB 연결, 행 → JSON 변환 (snake_case → camelCase)
  auth.py       관리자 로그인 토큰, @admin_required
  schema.sql    테이블 정의
  seed.py       DB 생성 + 예시 데이터 (web/js/data.js와 같은 내용)
  feedback.py   혼잡도·평가 계산
  ratelimit.py  호출 횟수 제한 (혼잡도, 평가)
  chatbot.py    챗봇 기본 버전 → 4번이 교체
  routing.py    차량 이동 시간 (네이버 Directions 5, 실시간 교통)
  menu_auto.py  학식 메뉴 자동 채우기 (2번 데이터 담당 작업을 옮김). 지금은 무작위 메뉴, 점심만
```

## 3. DB 구조 (ERD)

```mermaid
erDiagram
  buildings ||--o{ floors : has
  floors ||--o{ floor_facilities : has
  facility_types ||--o{ floor_facilities : type
  buildings ||--o{ cafeterias : in
  cafeterias ||--o{ menus : serves
  buildings ||--o{ lost_items : at
  buildings ||--o{ reports : about
  users ||--o{ reports : reviews
  buildings ||--o{ crowd_votes : votes
  buildings ||--o{ reviews : rated
  cafeterias ||--o{ menu_votes : voted

  buildings { text id PK; text name; text aliases; real lat; real lng; text type; int levels_above; int levels_below; int elevator; text image_url }
  floors { int id PK; text building_id FK; text floor; text note; text places; int sort_order }
  floor_facilities { int floor_id FK; text facility_key FK }
  facility_types { text key PK; text label }
  cafeterias { text id PK; text name; text building_id FK; text floor; text hours; text price }
  menus { int id PK; text cafeteria_id FK; text date; text meal; text items }
  lost_items { int id PK; text type; text title; text building_id FK; text place; text description; text contact; text image_url; int resolved; text date }
  reports { int id PK; text kind; text building_id FK; text floor; text content; text image_url; text status; text admin_note; int reviewed_by FK; text date }
  users { int id PK; text username; text password_hash; text role }
  chat_logs { int id PK; text message; text answer; text created_at }
  events { int id PK; text cat; text title; text start_date; text end_date; text due; text place }
  crowd_votes { int id PK; text building_id FK; text level; text client; text created_at }
  reviews { int id PK; text building_id FK; int facility; int clean; int space; text text; text client; text created_at }
  menu_votes { int id PK; text cafeteria_id FK; text date; text meal; text item; text vote; text client; text created_at }
```

설계 포인트:

- **메뉴는 날짜별로 저장해요** (`menus.date`). 프론트에서는 요일별 `weeklyMenu`로 쓰지만, 날짜 단위로 저장해야 "다음 주 메뉴"나 "지난 메뉴 수정"이 가능해요. 같은 식당·날짜·끼니는 하나만 저장돼요(UNIQUE).
- **층별 시설은 다대다 구조예요** (`floors` ↔ `floor_facilities` ↔ `facility_types`). 카테고리 필터와 "프린터 어디?" 같은 챗봇 질문을 SQL 한 번으로 처리할 수 있어요.
- **제보 상태값**: `pending`(검토 대기) → `done`(반영 완료) / `rejected`(반려). 2번의 승인 화면에서 바꿔요.
- `chat_logs`: 4번이 자주 나오는 질문을 분석할 때 쓰도록 남겨둔 기록이에요.
- **혼잡도, 평가, 메뉴 좋아요는 누른 기록을 그대로 저장해요** (`crowd_votes`, `reviews`, `menu_votes`). 평균이나 "몇 명이 확인" 같은 값은 요청이 올 때마다 계산해요. 그래서 관리자가 평가 하나를 지우면 평균도 바로 바뀌어요.

## 4. API 명세

- 공통: JSON 요청·응답. 에러는 항상 `{ "error": "메시지" }` 형태와 400/401/404/409 상태 코드로 와요.
- 🔒 표시가 있는 API는 헤더에 `Authorization: Bearer <token>`이 필요해요 (관리자 전용).

### 인증

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `{token, user, expiresIn}` (토큰 유효시간 12시간) |
| GET 🔒 | `/api/auth/me` | 로그인한 관리자 정보 |
| GET | `/api/health` | 서버 상태 확인 (프론트가 온라인 여부 판단에 사용) |

### 건물·시설 (3번 지도, 5번 상세 화면)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/facility-types` | `{ "printer": "프린터", ... }` |
| GET | `/api/buildings` | 건물 목록 (층·시설 포함) |
| GET | `/api/buildings/:id` | 건물 하나 |
| POST 🔒 | `/api/buildings` | `{id, name, lat, lng, aliases?, imageUrl?, floors?}` |
| PUT 🔒 | `/api/buildings/:id` | 보낸 필드만 수정. `floors`를 보내면 층 정보를 통째로 교체 |
| DELETE 🔒 | `/api/buildings/:id` | 식당이 있는 건물은 삭제할 수 없어요 (409) |

건물 응답 형태 (`web/js/data.js`와 같아요):

```json
{ "id": "b3", "name": "중앙도서관", "aliases": ["도서관"], "lat": 37.5668, "lng": 126.9798, "imageUrl": null,
  "floors": [{ "floor": "1F", "facilities": ["cafe", "printer"], "note": "대출/반납" }] }
```

### 식당·메뉴 (2번 메뉴 등록, 5번 학식 탭)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/cafeterias` | `[{id, name, buildingId, floor, hours, price}]` |
| POST / PUT / DELETE 🔒 | `/api/cafeterias(/:id)` | 식당 관리 |
| GET | `/api/menus?from=YYYY-MM-DD&to=YYYY-MM-DD&cafeteriaId=` | `[{cafeteriaId, date, meal, items}]` (기본값: 오늘) |
| PUT 🔒 | `/api/menus` | `{menus: [{cafeteriaId, date, meal, items}]}` 여러 개를 한 번에 등록·수정. `items: []`를 보내면 삭제 |

`meal`은 `breakfast`, `lunch`, `dinner` 중 하나예요 (현재 프론트는 점심과 저녁만 표시).

### 일정

조회는 누구나, 추가·수정·삭제는 관리자만 할 수 있어요. 처음 값은 `seed.py`의 `EVENTS`에서 들어가요 (`web/js/data.js`와 같은 내용).

| 메서드 | 경로 | 보내는 값 → 받는 값 |
|---|---|---|
| GET | `/api/events?cat=academic&from=YYYY-MM-DD` | 일정 목록. `from`을 주면 그날 이후 끝나는 일정만 |
| POST 🔒 | `/api/events` | `{cat, title, start?, end?, due?, place?}` → `event` (`start`나 `end` 중 하나는 필수) |
| PUT 🔒 | `/api/events/:id` | 보낸 값만 수정 → `event` |
| DELETE 🔒 | `/api/events/:id` | 삭제 → `{ok}` |

```js
// event: 값이 없는 키는 빠져서 와요
{ id: 7, cat: "club",          // academic(학사) | club(동아리) | festival(축제) | event(교내 행사)
  title: "동아리 박람회 사전 신청",
  start: "2026-11-23",         // 시작일·하루짜리 (YYYY-MM-DD)
  end: "2026-11-30",           // 마감일
  due: "신청 마감",             // 마감 카드 문구
  place: "학생회관 앞 광장 · 10:00" }
```

### 혼잡도 · 평가 · 메뉴 좋아요 (학생 참여)

학생은 로그인 없이 누르고 쓸 수 있어요. 관리자는 초기화와 삭제만 해요.
결과는 `GET /api/buildings`의 각 건물 안에 `crowd`, `rating`으로도 같이 와요. 없으면 키가 빠져요.

| 메서드 | 경로 | 보내는 값 → 받는 값 |
|---|---|---|
| POST | `/api/buildings/:id/crowd` | `{level: "busy" \| "calm"}` → `{crowd}` |
| DELETE 🔒 | `/api/buildings/:id/crowd` | 그 건물 혼잡도 초기화 → `{ok, deleted}` |
| GET | `/api/buildings/:id/reviews` | 그 건물 평가 목록 → `[review]` |
| POST | `/api/buildings/:id/reviews` | `{scores: {facility, clean, space}, text?}` → `{review, rating}` |
| GET 🔒 | `/api/reviews?buildingId=` | 관리자 화면용 전체 평가 목록 → `[review]` |
| DELETE 🔒 | `/api/reviews/:id` | 부적절한 평가 삭제 → `{ok}` |
| GET | `/api/menu-votes?from=YYYY-MM-DD&to=YYYY-MM-DD` | 그 기간 메뉴별 좋아요/별로예요 수 → `[menuVote]` (표가 있는 메뉴만) |
| POST | `/api/menu-votes` | `{cafeteriaId, date, meal, item, vote: "up" \| "down" \| null}` → `menuVote` (`null`이면 내 표 취소) |

주고받는 데이터:

```js
// crowd: 최근 60분 동안 누른 것만 계산. 없으면 null
{ level: "busy",            // busy(붐빔) | calm(한산)
  label: "조금 붐벼요",       // 붐벼요 | 조금 붐벼요 | 한산해요
  minutesAgo: 5,            // 마지막으로 누른 지 몇 분
  confirms: 7,              // 지금 상태에 동의한 사람 수
  votes: 9 }                // 전체 누른 사람 수

// rating: 평가가 없으면 null
{ score: 4.1, count: 12,    // 전체 평균, 평가 수
  parts: [["시설 상태", 4.2], ["깨끗함", 4.3], ["자리 여유", 2.6]],
  reviews: [["2026학년도 2학기, 3일 전", "콘센트가 많아요"]] }   // 한줄평 있는 것만, 최근 20개

// review: 평가 하나 (관리자 목록에서 id 로 삭제)
{ id: 3, buildingId: "jihye",
  scores: { facility: 4, clean: 5, space: 2 },   // 각각 1~5 정수
  text: "콘센트가 많아요", date: "2026-11-28", when: "2026학년도 2학기, 오늘" }

// menuVote: 메뉴 하나의 좋아요/별로예요
{ cafeteriaId: "c1", date: "2026-11-30", meal: "lunch", item: "제육볶음",
  up: 12, down: 3,
  mine: "up" }               // 요청한 사람이 누른 것. 안 눌렀으면 null
```

규칙:
- **혼잡도**: 같은 사람이 같은 건물에서 10분 안에 다시 누르면 새로 세지 않고 이전 표를 바꿔요. 숫자를 부풀릴 수 없어요.
- **평가**: 한 사람당 1시간에 5개까지 쓸 수 있어요. 넘으면 `429`가 와요.
- **메뉴 좋아요**: 한 사람이 메뉴 하나에 한 표예요. 같은 버튼을 다시 누르면 취소, 반대 버튼을 누르면 바뀌어요. 그날 메뉴에 없는 음식은 `404`예요.
- 사람 구분은 IP를 암호화한 값으로만 하고, 원래 IP는 저장하지 않아요.
- 고장 신고(`issues`)는 아직 DB에 없어서 화면이 `data.js`의 예시값을 써요.

### 분실물 (5번)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/lost` | 해결되지 않은 것만 보여줘요. `?all=1`이면 전체 |
| POST | `/api/lost` | `{type: lost\|found, title, buildingId, place, desc, contact, imageUrl?}` (로그인 불필요) |
| PATCH 🔒 | `/api/lost/:id` | `{resolved: true}` (주인 찾음 처리) |
| DELETE 🔒 | `/api/lost/:id` | 삭제 |

### 수정 제보 (5번 제보 화면, 2번 승인 화면)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/reports?status=pending` | 제보 목록 |
| POST | `/api/reports` | `{kind: new\|edit\|menu\|etc, buildingId, floor, content, imageUrl?}` |
| PATCH 🔒 | `/api/reports/:id` | `{status: done\|rejected\|pending, adminNote?}` |

※ 승인(`done`)으로 바꿔도 건물 정보가 자동으로 바뀌지는 않아요. 관리자 화면에서 `PUT /api/buildings/:id`를 함께 호출해야 해요.

### 사진 업로드 (5번)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/uploads` | `multipart/form-data`, 필드 이름은 `file`. 최대 5MB, 이미지 파일만 → `{url: "/uploads/xxx.jpg"}` |

받은 `url`을 분실물·제보·건물의 `imageUrl`에 넣어 저장하면 돼요.

```js
const fd = new FormData(); fd.append("file", input.files[0]);
const { url } = await (await fetch(base + "/api/uploads", { method: "POST", body: fd })).json();
```

### 챗봇 (4번)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/chat` | `{message, userPos?: {lat, lng}}` → `{text, buildingId?}` |

4번은 `server/chatbot.py`의 `answer(db, message, user_pos)`만 바꾸면 돼요. API 키는 꼭 환경변수로 넣어주세요.

## 5. 배포

`Dockerfile`이 web과 server를 함께 띄워요. Render, Railway, Fly.io 같은 Docker 배포 서비스에서 다음처럼 설정해요.

1. GitHub 저장소를 연결하고 Dockerfile로 배포해요.
2. 환경변수를 설정해요.
   - `SECRET_KEY`: 아무 긴 랜덤 문자열
   - `ADMIN_PASSWORD`: 관리자 비밀번호
   - (4번) LLM API 키
3. **디스크(볼륨)를 `/data`에 연결해요.** 연결하지 않으면 재배포할 때마다 DB가 초기화돼요.
4. 배포 주소가 나오면 다음 작업을 해요.
   - 네이버 클라우드 콘솔 → Maps 애플리케이션 → 서비스 URL에 배포 주소를 등록해요 (3번).
   - `ios/CampusMap/AppConfig.swift`의 `remoteURL`(또는 `apiBaseURL`)에 배포 주소를 넣어요.
     실제 기기에서는 `https://` 주소여야 해요.

## 6. 팀원별로 쓰는 API

| 담당 | 쓰는 API |
|---|---|
| 2번 데이터·관리자 | `auth/login`, `PUT menus`, `POST/PUT buildings`, `GET/PATCH reports`, `PATCH/DELETE lost`, `events` 추가/수정/삭제, `GET/DELETE reviews`, `DELETE buildings/:id/crowd` |
| 3번 지도 | `GET buildings`, `GET facility-types` |
| 4번 챗봇 | `POST chat`, `chatbot.py` 교체 (DB 직접 조회 가능) |
| 5번 상세·제보 | `GET buildings/:id`, `GET menus`, `GET/POST menu-votes`, `GET/POST lost`, `POST reports`, `POST uploads` |
