/**
 * 임시(목업) 데이터
 * - 나중에 백엔드/DB(API)로 교체할 부분입니다.
 * - 건물 이름과 좌표(lat, lng)는 OpenStreetMap의 백석대학교 건물 위치입니다 (2026-11-16 조회).
 * - 건물 종류(type), 층별 시설(floors), 혼잡도(crowd), 평가(rating)는 화면 확인용 예시값입니다. 진리관 층 정보는 팀원 화면 값.
 * - levels: [지상 층수, 지하 층수], elevator: 엘리베이터 여부 (모르면 비워 둠)
 *   실제 자료는 자료 담당(2번)이 확인한 값으로 바꿔주세요.
 */
const CAMPUS_CENTER = { lat: 36.8397504, lng: 127.1850643 }; // OSM 백석대학교 영역 중심
const CAMPUS_LOGO = { lat: 36.8406, lng: 127.1863, name: "백석대학교", src: "icons/bu-emblem.png" }; // 운동장 동쪽

const FACILITY_TYPES = {
  convenience: "편의점",
  cafe: "카페",
  printer: "프린터",
  atm: "ATM",
  lounge: "라운지",
  restroom: "화장실",
  water: "정수기",
};

/** 지도 마커 종류: [색, 이름] */
const BUILDING_TYPES = {
  lecture: ["#4A7DFF", "강의동"],
  food: ["#FF7A2F", "식당"],
  sport: ["#14B8A6", "체육"],
  art: ["#EC4899", "예술"],
  hall: ["#F59E0B", "공연장"],
  library: ["#0EA5E9", "도서관"],
  office: ["#64748B", "행정"],
  dorm: ["#8B5CF6", "생활관"],
};

/** 층 하나: 층 이름, 시설 분류(FACILITY_TYPES 키, 분류 칩과 챗봇이 씀), 메모, 카드에 보일 이름들(없으면 시설 분류 이름) */
const fl = (floor, facilities, note = "", places) => ({ floor, facilities, note, ...(places && { places }) });
const BUILDINGS = [
  { id: "seungri", name: "승리관", lat: 36.841763, lng: 127.185758, type: "lecture", floors: [fl("1층", ["printer", "restroom"]), fl("2층", ["water"])] },
  { id: "gym", name: "체육관", lat: 36.841366, lng: 127.187434, type: "sport", floors: [fl("1층", ["restroom", "water"])] },
  { id: "johyung", name: "조형관", lat: 36.840894, lng: 127.188438, type: "art", floors: [fl("1층", ["cafe", "convenience"], "", ["CU"]), fl("2층", ["restroom"])] },
  { id: "mokyang", name: "목양관", lat: 36.840874, lng: 127.183654, type: "lecture", floors: [fl("1층", ["restroom"]), fl("2층", ["printer"])] },
  { id: "bokji", name: "학생복지관", aliases: ["복지관"], lat: 36.840597, lng: 127.182496, type: "food",
    floors: [fl("지하 1층", [], "", ["밀겨울"]), fl("1층", ["cafe", "lounge"]), fl("2층", ["convenience", "printer", "restroom"], "", ["세븐일레븐"])],
    crowd: { label: "조금 붐벼요", minutesAgo: 5, confirms: 7 } },
  { id: "jinri", name: "진리관", lat: 36.840169, lng: 127.184518, type: "lecture", levels: [5, 1], elevator: false,
    floors: [fl("1층", ["atm"], "", ["서점", "문구점", "신한은행", "우편취급국", "보건실"]), fl("지하 1층", ["convenience"], "", ["CU"])] },
  { id: "gyosu", name: "교수회관", lat: 36.839697, lng: 127.184804, type: "office", floors: [fl("1층", ["restroom"], "", ["교수회관 식당"])] },
  { id: "baekseokhall", name: "백석홀", lat: 36.839572, lng: 127.182658, type: "hall", floors: [fl("1층", ["cafe", "restroom"])] },
  { id: "insung", name: "인성관", lat: 36.839405, lng: 127.183558, type: "lecture", floors: [fl("1층", ["printer"]), fl("2층", ["lounge", "water"])] },
  { id: "bonbu", name: "본부동", lat: 36.83934, lng: 127.185784, type: "office", floors: [fl("1층", ["atm", "restroom"], "학사지원팀", ["신한은행 ATM"]), fl("2층", ["water"]), fl("6층", ["convenience"], "", ["CU"])] },
  { id: "jihye", name: "지혜관", lat: 36.838751, lng: 127.184338, type: "lecture",
    floors: [fl("1층", ["printer", "cafe"]), fl("2층", ["convenience", "lounge"], "", ["CU"])],
    crowd: { label: "조금 붐벼요", minutesAgo: 5, confirms: 7 },
    issues: [{ facility: "printer", floor: "1층", count: 2, minutesAgo: 10 }],
    rating: { score: 4.1, parts: [["시설 상태", 4.2], ["깨끗함", 4.3], ["자리 여유", 2.6]],
      reviews: [["2026학년도 2학기, 3일 전", "2층 라운지에 콘센트가 많아서 좋아요"], ["2026학년도 2학기, 1주 전", "1층 프린터가 자주 멈춰요. 2층 라운지 쪽이 조용해요"]] } },
  { id: "art", name: "예술대학동", lat: 36.838723, lng: 127.187577, type: "art", floors: [fl("1층", ["restroom", "water"])] },
  { id: "jayu", name: "자유관", lat: 36.838462, lng: 127.183223, type: "lecture", floors: [fl("1층", ["printer", "water"])] },
  { id: "library", name: "백석학술정보관", aliases: ["도서관", "학술정보관"], lat: 36.837766, lng: 127.184041, type: "library",
    floors: [fl("1층", ["cafe", "printer", "water"], "대출, 반납"), fl("3층", ["lounge", "restroom"], "열람실")] },
  { id: "global", name: "글로벌 외식산업관", aliases: ["외식산업관"], lat: 36.837551, lng: 127.185125, type: "food",
    floors: [fl("1층", [], "", ["안골식당"]), fl("2층", ["cafe"])] },
  { id: "dorm", name: "백석생활관", aliases: ["생활관", "기숙사"], lat: 36.842568, lng: 127.185143, type: "dorm",
    floors: [fl("1층", [], "", ["백석생활관 식당"]), fl("2층", ["convenience"], "", ["GS25"])] },
  { id: "changjo", name: "창조관", lat: 36.837402, lng: 127.182419, type: "lecture", floors: [fl("4층", ["printer", "lounge"], "실습실"), fl("8층", ["convenience"], "", ["GS25"])] },
];

/**
 * 곧 있을 일들 (시트 첫 화면)
 * - cat: academic(학사) / club(동아리) / festival(축제) / event(교내 행사, 전체에서만 보임)
 * - start: 시작일, end: 끝나는 날(마감일). 하루짜리는 start 만.
 * - due: 마감 카드 아래 붙는 말 (예: "접수 마감"), place: 장소와 시간
 * - 학사는 학교 홈페이지 2026년 11월 화면에서 옮긴 값. 나머지는 팀원 화면의 예시값.
 *   관리자 페이지가 생기면 운영자가 올린 값으로 바꿉니다.
 */
const EVENT_CATS = {
  academic: { label: "학사", bg: "#E3F1DA", fg: "#2F6B1F" },
  club: { label: "동아리", bg: "#FCE8D6", fg: "#A2480B" },
  festival: { label: "축제", bg: "#F9E3EC", fg: "#9C2257" },
  event: { label: "교내 행사", bg: "#DDE9FA", fg: "#1F4E9C" },
};
const EVENTS = [
  { cat: "academic", start: "2026-11-01", title: "개교기념일" },
  { cat: "academic", start: "2026-11-09", end: "2026-12-04", title: "2027학년도 1학기 전공변경·전부(과) 신청" },
  { cat: "academic", start: "2026-11-23", title: "수업일수 4분의 3" },
  { cat: "academic", start: "2026-11-23", end: "2026-11-27", title: "동계 계절학기 수강신청", due: "신청 마감" },
  { cat: "festival", end: "2026-11-28", title: "겨울 축제 공연팀 오디션", due: "접수 마감" },
  { cat: "event", end: "2026-11-29", title: "교내 해커톤 참가 접수", due: "접수 마감" },
  { cat: "club", end: "2026-11-30", title: "동아리 박람회 사전 신청", due: "신청 마감" },
  { cat: "club", start: "2026-11-30", title: "동아리 박람회", place: "학생회관 앞 광장 · 10:00" },
  { cat: "festival", start: "2026-12-03", title: "겨울 축제 라인업 공개", place: "공식 계정에서 발표" },
];

/**
 * 학식 데이터
 * - 식당 이름, 층, 운영시간은 2번(데이터 담당) 자료. 가격은 아직 없음.
 * - 메뉴: 서버가 켜져 있으면 서버가 날짜마다 채운 메뉴(server/menu_auto.py), 서버가 없으면 아래 예시.
 *   지금은 점심만 운영하는 것으로 잡혀 있음.
 * - weeklyMenu 키: 1(월) ~ 5(금). 주말은 미운영.
 * - hours: "HH:MM ~ HH:MM" 를 "/" 로 구분
 */
const CAFETERIAS = [
  {
    id: "c1", name: "백석생활관 식당", buildingId: "dorm", floor: "1층", hours: "11:00 ~ 18:00", price: "",
    weeklyMenu: {
      1: { lunch: ["쌀밥", "육개장", "마파두부", "감자조림", "메추리알장조림", "배추김치"] },
      2: { lunch: ["흑미밥", "된장국", "고등어구이", "어묵볶음", "두부조림", "열무김치"] },
      3: { lunch: ["쌀밥", "북엇국", "닭볶음탕", "메추리알장조림", "샐러드", "단무지"] },
      4: { lunch: ["쌀밥", "떡국", "닭갈비", "감자조림", "두부조림", "총각김치"] },
      5: { lunch: ["보리밥", "어묵국", "마파두부", "잡채", "멸치볶음", "단무지"] },
    },
  },
  {
    id: "c2", name: "교수회관 식당", buildingId: "gyosu", floor: "1층", hours: "08:30 ~ 17:00", price: "",
    weeklyMenu: {
      1: { lunch: ["흑미밥", "순두부찌개", "제육볶음", "오이무침", "샐러드", "깍두기"] },
      2: { lunch: ["잡곡밥", "미역국", "갈비찜", "어묵볶음", "메추리알장조림", "열무김치"] },
      3: { lunch: ["기장밥", "떡국", "함박스테이크", "시금치나물", "오이무침", "총각김치"] },
      4: { lunch: ["기장밥", "미역국", "생선까스", "도라지무침", "멸치볶음", "열무김치"] },
      5: { lunch: ["기장밥", "청국장", "제육볶음", "콩나물무침", "계란말이", "총각김치"] },
    },
  },
  {
    id: "c3", name: "안골식당", buildingId: "global", floor: "1층", hours: "10:30 ~ 14:00", price: "",
    weeklyMenu: {
      1: { lunch: ["흑미밥", "소고기무국", "함박스테이크", "콩나물무침", "메추리알장조림", "단무지"] },
      2: { lunch: ["흑미밥", "순두부찌개", "카레", "메추리알장조림", "시금치나물", "단무지"] },
      3: { lunch: ["보리밥", "소고기무국", "훈제오리", "잡채", "숙주나물", "배추김치"] },
      4: { lunch: ["잡곡밥", "감자국", "돈까스", "콩나물무침", "메추리알장조림", "깍두기"] },
      5: { lunch: ["흑미밥", "부대찌개", "오징어볶음", "떡볶이", "두부조림", "총각김치"] },
    },
  },
  {
    id: "c4", name: "밀겨울", buildingId: "bokji", floor: "지하 1층", hours: "08:30 ~ 17:00", price: "",
    weeklyMenu: {
      1: { lunch: ["쌀밥", "김치찌개", "생선까스", "시금치나물", "두부조림", "단무지"] },
      2: { lunch: ["기장밥", "부대찌개", "제육볶음", "시금치나물", "메추리알장조림", "단무지"] },
      3: { lunch: ["쌀밥", "김치찌개", "오징어볶음", "콩나물무침", "두부조림", "깍두기"] },
      4: { lunch: ["잡곡밥", "소고기무국", "갈비찜", "계란말이", "메추리알장조림", "단무지"] },
      5: { lunch: ["흑미밥", "콩나물국", "갈비찜", "도라지무침", "계란말이", "깍두기"] },
    },
  },
];

/**
 * 교내 편의점 (브랜드별)
 * - brand: "CU" | "GS25" | "세븐일레븐" | "이마트24"
 * - buildingId: 지도에 있는 건물. 지도에 없는 건물이면 비우고 building 에 이름만 적음
 * - hours: 확인된 것만 (모르면 비워 둠 → 영업 중 표시 안 함)
 * 2026-11-27 카카오맵 장소 정보 + 팀원 확인으로 정리. 지혜관 CU 는 카카오맵에 3층 309호로 나오지만 팀원 확인대로 2층.
 * 건물 층 정보(BUILDINGS 의 floors)와 server/seed.py 에도 같은 위치가 들어 있어요.
 */
const CONVENIENCE_STORES = [
  { brand: "CU", buildingId: "jinri", floor: "지하 1층", hours: "" },
  { brand: "CU", buildingId: "jihye", floor: "2층", hours: "" },
  { brand: "CU", buildingId: "bonbu", floor: "6층", hours: "" },
  { brand: "CU", buildingId: "johyung", floor: "1층", hours: "" },
  { brand: "GS25", buildingId: "dorm", floor: "2층", hours: "07:00 ~ 23:00" },
  { brand: "GS25", buildingId: "changjo", floor: "8층", hours: "" },
  { brand: "GS25", buildingId: "jayu", floor: "", hours: "" },
  { brand: "세븐일레븐", buildingId: "bokji", floor: "2층", hours: "" },
  { brand: "이마트24", buildingId: "", building: "은혜관", floor: "1층", hours: "" },
];

/**
 * 교내 은행, ATM
 * 2026-11-27 카카오맵 장소 정보로 정리. 층은 카카오맵에 나온 것만 (진리관 신한은행 출장소 1층).
 */
const ATMS = [
  { bank: "신한은행", kind: "출장소", buildingId: "jinri", floor: "1층" },
  { bank: "신한은행", kind: "ATM", buildingId: "jinri", floor: "" },
  { bank: "신한은행", kind: "ATM", buildingId: "bonbu", floor: "" },
  { bank: "신한은행", kind: "ATM", buildingId: "insung", floor: "" },
  { bank: "신한은행", kind: "ATM", buildingId: "jayu", floor: "" },
  { bank: "KB국민은행", kind: "ATM", buildingId: "jayu", floor: "" },
  { bank: "신한은행", kind: "ATM", buildingId: "dorm", floor: "" },
  { bank: "신한은행", kind: "ATM", buildingId: "bokji", floor: "" },
];

const LOST_ITEMS = [
  { id: "l1", type: "found", title: "파란색 텀블러", buildingId: "library", place: "3층 열람실", desc: "", contact: "도서관 안내데스크", date: "2026-11-08" },
  { id: "l2", type: "lost", title: "학생증", buildingId: "jihye", place: "2층 편의점 근처", desc: "이름 김OO", contact: "오픈채팅", date: "2026-11-07" },
];

const REPORTS = [];
