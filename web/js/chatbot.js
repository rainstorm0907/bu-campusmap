/**
 * ============================================================
 *  캠퍼스 챗봇 (CampusBot)
 * ============================================================
 *  1순위: 서버 챗봇 (/api/chat) → DB 의 실제 메뉴로 답변 (server/chatbot.py)
 *         관리자 앱에서 메뉴를 올리면 바로 반영, 날짜가 바뀌면 자동으로 그날 메뉴
 *  2순위: 서버에 연결할 수 없을 때만 아래 로컬 규칙(js/data.js 예시 데이터)으로 답변
 *
 *  AI(LLM) 챗봇으로 바꾸려면:
 *    reply() 안에서 우리 백엔드 서버로 fetch 하도록 바꾸면 됩니다.
 *    ※ API 키는 절대 프론트엔드 코드에 넣지 마세요. (누구나 볼 수 있음)
 *       반드시 서버를 거쳐서 호출해야 합니다.
 *
 *    예)
 *    async function reply(text, ctx) {
 *      const res = await fetch("/api/chat", {
 *        method: "POST",
 *        headers: { "Content-Type": "application/json" },
 *        body: JSON.stringify({ message: text, userPos: ctx.userPos }),
 *      });
 *      return await res.json();   // { text, buildingId? }
 *    }
 *
 *  반환 형태: { text: string, buildingId?: string }
 *    buildingId 가 있으면 답변 아래에 "지도에서 보기" 버튼이 붙습니다.
 * ============================================================
 */
const CampusBot = (() => {
  const U = CampusUtil;

  const has = (text, words) => words.some((w) => text.includes(w));
  const buildingName = (id) => BUILDINGS.find((b) => b.id === id)?.name || "";

  /** ctx.userPos 가 있으면 식당을 가까운 순으로 정렬 */
  function cafesByDistance(ctx) {
    return CAFETERIAS.map((c) => {
      const b = BUILDINGS.find((x) => x.id === c.buildingId);
      const m = ctx.userPos ? U.distance(ctx.userPos, b) : null;
      return { cafe: c, building: b, meters: m };
    }).sort((a, b) => (a.meters ?? 0) - (b.meters ?? 0));
  }

  function distText(m) {
    return m == null ? "" : ` (${U.formatDistance(m)}, 도보 ${U.walkMinutes(m)}분)`;
  }

  /* ---------------- 의도별 답변 ---------------- */

  function answerMenu(text, ctx) {
    const now = new Date();
    let day = now.getDay();
    let dayLabel = "오늘";
    if (has(text, ["내일"])) { day = (day + 1) % 7; dayLabel = "내일"; }

    const meal = has(text, ["저녁", "석식"]) ? "dinner" : has(text, ["점심", "중식"]) ? "lunch" : U.currentMeal(now);
    const mealLabel = meal === "lunch" ? "점심" : "저녁";

    if (day === 0 || day === 6) {
      return { text: `${dayLabel}은 주말이라 학식을 운영하지 않아요 😢` };
    }

    const lines = cafesByDistance(ctx).map(({ cafe, meters }) => {
      const menu = U.getMenu(cafe, day, meal);
      return `• ${cafe.name}${distText(meters)}\n   ${menu.length ? menu.join(", ") : "운영 안 함"}`;
    });
    return { text: `🍚 ${dayLabel}(${U.DAY_NAMES[day]}) ${mealLabel} 메뉴예요.\n${lines.join("\n")}` };
  }

  function answerNearest(ctx) {
    if (!ctx.userPos) {
      return { text: "위치를 먼저 알려주세요! 학식 탭에서 📍'내 위치' 버튼을 누르거나 지금 있는 건물을 선택하면 가까운 식당을 찾아드릴게요." };
    }
    const now = new Date();
    const list = cafesByDistance(ctx);
    const open = list.filter(({ cafe }) => U.isOpenNow(cafe.hours, now));
    const best = open[0] || list[0];
    const menu = U.getMenu(best.cafe, now.getDay(), U.currentMeal(now));
    const status = open.length ? "지금 운영 중이에요." : "지금은 운영 중인 식당이 없어서, 가장 가까운 곳을 알려드려요.";
    return {
      text: `📍 가장 가까운 식당은 ${best.cafe.name}(${best.building.name} ${best.cafe.floor})이에요${distText(best.meters)}.\n${status}\n🕒 ${best.cafe.hours}${menu.length ? `\n🍚 ${menu.join(", ")}` : ""}`,
      buildingId: best.building.id,
    };
  }

  function answerHours() {
    const lines = CAFETERIAS.map((c) => `• ${c.name}: ${c.hours} ${U.isOpenNow(c.hours) ? "🟢 운영중" : "⚪ 운영종료"}`);
    return { text: `🕒 식당 운영시간이에요.\n${lines.join("\n")}` };
  }

  function answerFacility(type, ctx) {
    const label = FACILITY_TYPES[type];
    const found = BUILDINGS.flatMap((b) =>
      b.floors.filter((f) => f.facilities.includes(type)).map((f) => ({ b, floor: f.floor, m: ctx.userPos ? U.distance(ctx.userPos, b) : null }))
    ).sort((a, b) => (a.m ?? 0) - (b.m ?? 0));
    if (!found.length) return { text: `등록된 ${label} 정보가 아직 없어요. 알고 있다면 '정보 제보'로 알려주세요!` };
    const lines = found.map(({ b, floor, m }) => `• ${b.name} ${floor}${distText(m)}`);
    return { text: `${label} 위치예요.\n${lines.join("\n")}`, buildingId: found[0].b.id };
  }

  function answerBuilding(b) {
    const lines = b.floors.map((f) => `• ${f.floor}: ${f.facilities.map((t) => FACILITY_TYPES[t]).join(", ")}${f.note ? ` (${f.note})` : ""}`);
    return { text: `🏢 ${b.name} 층별 정보예요.\n${lines.join("\n")}`, buildingId: b.id };
  }

  function answerLost(ctx) {
    const items = ctx.lostItems.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
    const lines = items.map((i) => `• [${i.type === "lost" ? "분실" : "습득"}] ${i.title} - ${buildingName(i.buildingId)} ${i.place || ""} (${i.date})`);
    return {
      text: `🔎 최근 분실물이에요.\n${lines.join("\n") || "• 등록된 분실물이 없어요"}\n\n물건을 잃어버렸거나 주웠다면 '분실물' 탭에서 등록할 수 있어요.`,
    };
  }

  const HELP = {
    text: "이런 걸 물어볼 수 있어요 🙂\n• 오늘 점심 뭐야? / 내일 저녁 메뉴\n• 가장 가까운 식당 어디야?\n• 식당 몇 시까지 해?\n• 프린터 어디 있어? / 편의점\n• 도서관 층별 정보\n• 분실물 있어?",
  };

  /* ---------------- 메인 ---------------- */
  /**
   * @param {string} text 사용자 입력
   * @param {{ userPos: {lat,lng}|null, lostItems: Array }} ctx
   * @returns {Promise<{text: string, buildingId?: string}>}
   */
  async function reply(text, ctx) {
    if (typeof Api !== "undefined" && Api.online) {
      try {
        return await Api.post("/api/chat", { message: text, userPos: ctx.userPos });
      } catch (e) {
        console.warn("서버 챗봇 연결 실패 → 로컬 답변", e);
      }
    }
    return localReply(text, ctx);
  }

  async function localReply(text, ctx) {
    const t = text.replace(/\s+/g, "");

    if (has(t, ["가까운", "가까이", "근처", "거리", "얼마나걸", "멀어"])) return answerNearest(ctx);
    if (has(t, ["몇시", "운영시간", "영업", "언제까지", "언제열"])) return answerHours();
    if (has(t, ["학식", "메뉴", "밥", "점심", "저녁", "중식", "석식", "뭐먹"])) return answerMenu(t, ctx);
    if (has(t, ["분실", "잃어버", "주웠", "습득"])) return answerLost(ctx);
    if (has(t, ["제보", "수정", "틀렸"])) return { text: "상단의 '+ 정보 제보' 버튼이나 건물 상세 카드의 '정보 수정 제보'로 알려주세요. 검토 후 지도에 반영돼요!" };

    const facilityKey = Object.entries(FACILITY_TYPES).find(([, label]) => t.includes(label.replace(/\s/g, "")) || t.toLowerCase().includes(label.toLowerCase()))?.[0];
    if (facilityKey) return answerFacility(facilityKey, ctx);

    const b = BUILDINGS.find((x) => t.includes(x.name) || t.includes(x.name.replace("중앙", "")));
    if (b) return answerBuilding(b);

    if (has(t, ["안녕", "하이", "hi", "hello"])) return { text: "안녕하세요! 캠퍼스맵 챗봇이에요 🗺️\n" + HELP.text };
    return { text: "잘 이해하지 못했어요 😅\n" + HELP.text };
  }

  const SUGGESTIONS = ["오늘 점심 뭐야?", "내일 메뉴", "이번 주 메뉴", "돈까스 언제 나와?", "가장 가까운 식당", "프린터 어디 있어?"];

  return { reply, SUGGESTIONS };
})();
