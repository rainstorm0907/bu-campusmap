/**
 * 임시(목업) 데이터
 * - 나중에 백엔드/DB(API)로 교체할 부분입니다.
 * - 좌표(lat, lng)는 예시값입니다. 실제 학교 건물 좌표로 바꿔주세요.
 */
const CAMPUS_CENTER = { lat: 37.5665, lng: 126.9780 };

const FACILITY_TYPES = {
  convenience: "편의점",
  cafe: "카페",
  printer: "프린터",
  atm: "ATM",
  lounge: "라운지",
  restroom: "화장실",
  water: "정수기",
};

const BUILDINGS = [
  {
    id: "b1", name: "본관", lat: 37.5672, lng: 126.9772,
    floors: [
      { floor: "1F", facilities: ["atm", "restroom"], note: "학사지원팀, 학생처" },
      { floor: "2F", facilities: ["printer", "water"], note: "총무팀" },
    ],
  },
  {
    id: "b2", name: "학생회관", lat: 37.5660, lng: 126.9790,
    floors: [
      { floor: "B1", facilities: ["convenience"], note: "편의점 08:00~22:00" },
      { floor: "1F", facilities: ["cafe", "lounge"], note: "학생식당" },
      { floor: "2F", facilities: ["printer", "restroom"], note: "동아리방" },
    ],
  },
  {
    id: "b3", name: "중앙도서관", lat: 37.5668, lng: 126.9798,
    floors: [
      { floor: "1F", facilities: ["cafe", "printer", "water"], note: "대출/반납" },
      { floor: "3F", facilities: ["lounge", "restroom"], note: "열람실" },
    ],
  },
  {
    id: "b4", name: "공학관", lat: 37.5656, lng: 126.9768,
    floors: [
      { floor: "1F", facilities: ["convenience", "atm"], note: "" },
      { floor: "4F", facilities: ["printer", "lounge"], note: "실습실" },
    ],
  },
];

/**
 * 학식 데이터
 * - weeklyMenu 키: 1(월) ~ 5(금). 주말은 미운영.
 * - hours: "HH:MM ~ HH:MM" 를 "/" 로 구분
 */
const CAFETERIAS = [
  {
    id: "c1", name: "학생식당", buildingId: "b2", floor: "1F",
    hours: "11:00 ~ 14:00 / 17:00 ~ 19:00", price: "5,500원",
    weeklyMenu: {
      1: { lunch: ["제육볶음", "된장국", "계란말이", "김치"], dinner: ["돈까스", "우동", "단무지"] },
      2: { lunch: ["치킨마요덮밥", "미소국", "샐러드"], dinner: ["김치찌개", "계란후라이", "어묵볶음"] },
      3: { lunch: ["순두부찌개", "고등어구이", "시금치나물"], dinner: ["짜장면", "탕수육", "단무지"] },
      4: { lunch: ["닭갈비", "콩나물국", "감자조림"], dinner: ["카레라이스", "유부장국", "깍두기"] },
      5: { lunch: ["불고기비빔밥", "북엇국", "김치전"], dinner: [] },
    },
  },
  {
    id: "c2", name: "교직원식당", buildingId: "b1", floor: "2F",
    hours: "11:30 ~ 13:30", price: "7,000원",
    weeklyMenu: {
      1: { lunch: ["비빔밥", "미역국", "잡채", "깍두기"], dinner: [] },
      2: { lunch: ["갈비탕", "도라지무침", "김치"], dinner: [] },
      3: { lunch: ["생선까스", "크림스프", "코울슬로"], dinner: [] },
      4: { lunch: ["육개장", "두부조림", "멸치볶음"], dinner: [] },
      5: { lunch: ["떡갈비", "된장찌개", "오이무침"], dinner: [] },
    },
  },
  {
    id: "c3", name: "공학관 푸드코트", buildingId: "b4", floor: "1F",
    hours: "10:30 ~ 19:30", price: "4,500~6,500원",
    weeklyMenu: {
      1: { lunch: ["라면", "김밥", "돈까스"], dinner: ["라면", "김밥", "쫄면"] },
      2: { lunch: ["라면", "김밥", "제육덮밥"], dinner: ["라면", "김밥", "떡볶이"] },
      3: { lunch: ["라면", "김밥", "오므라이스"], dinner: ["라면", "김밥", "비빔국수"] },
      4: { lunch: ["라면", "김밥", "치즈돈까스"], dinner: ["라면", "김밥", "만두"] },
      5: { lunch: ["라면", "김밥", "참치마요"], dinner: ["라면", "김밥"] },
    },
  },
];

const LOST_ITEMS = [
  { id: "l1", type: "found", title: "파란색 텀블러", buildingId: "b3", place: "3층 열람실", desc: "", contact: "도서관 안내데스크", date: "2026-11-08" },
  { id: "l2", type: "lost", title: "학생증", buildingId: "b4", place: "1층 편의점 근처", desc: "이름 김OO", contact: "오픈채팅", date: "2026-11-07" },
];

const REPORTS = [];
