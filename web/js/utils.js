/**
 * 공용 계산 함수 (app.js, chatbot.js 에서 함께 사용)
 */
const CampusUtil = (() => {
  const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
  const WALK_M_PER_MIN = 67; // 도보 약 4km/h

  /** 두 좌표 사이 직선거리(m) - 하버사인 공식 */
  function distance(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const walkMinutes = (m) => Math.max(1, Math.ceil(m / WALK_M_PER_MIN));
  const formatDistance = (m) => (m < 20 ? "같은 건물" : m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`);

  const toMin = (t) => {
    const [h, m] = t.trim().split(":").map(Number);
    return h * 60 + m;
  };
  const ranges = (hours) => hours.split("/").map((r) => r.split("~").map(toMin));

  function isOpenNow(hours, now = new Date()) {
    if (now.getDay() === 0 || now.getDay() === 6) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    return ranges(hours).some(([s, e]) => cur >= s && cur <= e);
  }

  /** 지금 시간 기준 점심/저녁 (15시 이후는 저녁) */
  const currentMeal = (now = new Date()) => (now.getHours() >= 15 ? "dinner" : "lunch");

  /** 요일(0~6)과 끼니로 메뉴 조회. 없으면 [] */
  function getMenu(cafe, day, meal) {
    return cafe.weeklyMenu?.[day]?.[meal] || [];
  }

  /**
   * 건물 사이 이동 예상 (직선거리로 계산한 대략값)
   * - 도보: 길이 돌아가는 걸 감안해 직선거리 x1.3, 분당 67m
   * - 차량: 교내 도로를 돌아가는 걸 감안해 직선거리 x1.5 + 150m, 시속 25km(분당 417m), 주차 시간 제외
   *   서버가 켜져 있으면 차량은 네이버 실시간 교통 값(/api/route)으로 바뀌어요. 이 값은 서버가 없을 때 예비용.
   */
  function routeEstimate(a, b) {
    const straight = distance(a, b);
    const walkM = straight * 1.3;
    const carM = straight * 1.5 + 150;
    const walkMin = Math.max(1, Math.ceil(walkM / WALK_M_PER_MIN));
    const carMin = Math.max(1, Math.ceil(carM / 417));
    return { straight, walkM, walkMin, carM, carMin, walkFaster: walkMin <= carMin };
  }

  return { DAY_NAMES, distance, walkMinutes, formatDistance, isOpenNow, currentMeal, getMenu, routeEstimate };
})();
