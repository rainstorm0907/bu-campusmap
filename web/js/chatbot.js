/**
 * ============================================================
 *  캠퍼스 챗봇 (CampusBot)
 * ============================================================
 *  답변 순서
 *    1) 아래 규칙으로 알아들을 수 있는 질문(학식, 식당, 시설, 건물, 일정, 분실물)은
 *       화면에 있는 데이터로 바로 답해요. 서버가 켜져 있으면 app.js 가 BUILDINGS, CAFETERIAS
 *       를 서버(DB) 값으로 바꿔 두기 때문에 답도 DB 기준이에요.
 *    2) 못 알아들은 질문만 서버 챗봇(/api/chat, server/chatbot.py)에 물어봐요.
 *       나중에 LLM 을 붙이면 server/chatbot.py 의 answer() 만 바꾸면 돼요.
 *       ※ API 키는 프론트엔드 코드에 넣지 말고 서버 환경변수로만 읽어요.
 *
 *  답변 형태 (서버 답도 같은 형태, text 만 있어도 됨)
 *    {
 *      text: string,                  말풍선 글
 *      buildingId?: string,           있으면 "지도에서 보기" 버튼
 *      cards?: Card[],                메뉴, 장소, 일정, 분실물, 건물 카드
 *      chips?: string[],              다음에 물어볼 만한 질문
 *    }
 * ============================================================
 */
const CampusBot = (() => {
  const U = CampusUtil;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const has = (text, words) => words.some((w) => text.includes(w));
  const squash = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const bById = (id) => BUILDINGS.find((b) => b.id === id);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  /** 받침이 있으면 a, 없으면 b (예: 돈까스가, 제육볶음이) */
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? a : b; };
  const DAY_WORDS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  /* ---------------- 위치 ---------------- */

  /** 거리 기준: 내 위치 → 지금 보고 있는 건물 → 없음 */
  function origin(ctx) {
    if (ctx.userPos) return { pos: ctx.userPos, label: "내 위치" };
    const b = bById(ctx.currentBuildingId);
    return b ? { pos: b, label: b.name } : null;
  }
  function distOf(ctx, b) {
    const o = origin(ctx);
    return o && b ? Math.round(U.distance(o.pos, b)) : null;
  }
  const byDist = (a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9);

  /* ---------------- 의도별 답변 ---------------- */

  function parseDay(t) {
    const now = new Date();
    if (has(t, ["모레"])) return { day: (now.getDay() + 2) % 7, label: "모레" };
    if (has(t, ["내일"])) return { day: (now.getDay() + 1) % 7, label: "내일" };
    const i = DAY_WORDS.findIndex((w) => t.includes(w));
    if (i >= 0) return { day: i, label: DAY_WORDS[i] };
    return { day: now.getDay(), label: "오늘" };
  }

  function menuCards(ctx, day, meal) {
    const now = new Date();
    const isToday = day === now.getDay();
    return CAFETERIAS.map((c) => {
      const b = bById(c.buildingId);
      return {
        kind: "menu",
        name: c.name,
        place: `${b?.name || ""} ${c.floor || ""}`.trim(),
        hours: c.hours,
        open: isToday ? U.isOpenNow(c.hours, now) : null,
        items: U.getMenu(c, day, meal),
        dist: distOf(ctx, b),
        buildingId: c.buildingId,
      };
    }).sort(byDist);
  }

  function answerMenu(t, ctx) {
    const { day, label } = parseDay(t);
    const meal = has(t, ["저녁", "석식"]) ? "dinner" : has(t, ["점심", "중식"]) ? "lunch" : U.currentMeal();
    const mealLabel = meal === "lunch" ? "점심" : "저녁";
    if (day === 0 || day === 6) {
      return { text: `${label}은 주말이라 학식을 운영하지 않아요.`, chips: ["월요일 점심 메뉴", "이번 주 메뉴", "가까운 편의점"] };
    }
    const cards = menuCards(ctx, day, meal);
    if (!cards.some((c) => c.items.length)) {
      const other = meal === "lunch" ? "저녁" : "점심";
      return { text: `${label} ${mealLabel}은 등록된 메뉴가 없어요.`, chips: [`${label} ${other} 메뉴`, "이번 주 메뉴", "식당 운영시간"] };
    }
    const o = origin(ctx);
    return {
      text: `${label}(${U.DAY_NAMES[day]}) ${mealLabel} 메뉴예요.${o ? ` ${o.label}에서 가까운 순이에요.` : ""}`,
      cards: cards.filter((c) => c.items.length),
      chips: [label === "오늘" ? "내일 메뉴" : "오늘 메뉴", "이번 주 메뉴", "가장 가까운 식당"],
    };
  }

  /** 메인 반찬: 보통 [밥, 국, 메인, 반찬...] 순서 */
  const mainDish = (items) => items[2] || items[1] || items[0] || "";

  function answerWeek() {
    const rows = [1, 2, 3, 4, 5].map((d) => ({
      day: U.DAY_NAMES[d],
      today: d === new Date().getDay(),
      dishes: CAFETERIAS.map((c) => ({ cafe: c.name, dish: mainDish(U.getMenu(c, d, "lunch")) })).filter((x) => x.dish),
    }));
    if (!rows.some((r) => r.dishes.length)) return { text: "이번 주에 등록된 메뉴가 아직 없어요.", chips: ["식당 운영시간"] };
    return { text: "이번 주 점심 메인 메뉴예요.", cards: [{ kind: "week", rows }], chips: ["오늘 메뉴", "내일 메뉴"] };
  }

  /** 메뉴 이름이 들어 있으면 (예: "돈까스 언제 나와?") 이번 주에 언제, 어디서 나오는지 */
  function answerDish(t) {
    const all = [];
    for (const c of CAFETERIAS) for (const d of [1, 2, 3, 4, 5]) for (const meal of ["lunch", "dinner"])
      for (const item of U.getMenu(c, d, meal)) all.push({ day: d, cafe: c, meal, item, key: squash(item) });
    // 이름이 그대로 들어간 메뉴 먼저 (돈까스 → 돈까스), 없으면 비슷한 메뉴 (까스 → 생선까스, 돈까스)
    let hits = all.filter((h) => h.key.length >= 2 && t.includes(h.key));
    if (!hits.length && t.includes("까스")) hits = all.filter((h) => h.key.endsWith("까스"));
    if (!hits.length) return null;
    const todayIdx = new Date().getDay();
    const order = (d) => (d - todayIdx + 7) % 7; // 오늘부터 가까운 요일 순
    hits.sort((a, b) => order(a.day) - order(b.day));
    const names = [...new Set(hits.map((h) => h.item))];
    const rows = hits.map((h) => ({
      kind: "place",
      title: `${U.DAY_NAMES[h.day]}요일 ${h.meal === "lunch" ? "점심" : "저녁"}`,
      sub: `${h.cafe.name}, ${h.item}`,
      tag: h.day === todayIdx ? "오늘" : "",
      tagTone: "open",
      buildingId: h.cafe.buildingId,
    }));
    const what = names.length === 1 ? names[0] : names.join(", ");
    return { text: `이번 주에 ${what}${josa(what, "이", "가")} 나오는 날이에요.`, cards: [{ kind: "list", rows }], chips: ["이번 주 메뉴", "오늘 메뉴"] };
  }

  function answerNearest(ctx) {
    const o = origin(ctx);
    if (!o) {
      return {
        text: "어디서 출발하는지 알려주세요. 지도 오른쪽 위치 버튼을 누르거나, 지금 있는 건물을 지도에서 고른 뒤 다시 물어보면 가까운 순으로 찾아드려요.",
        needsLocation: true,
        chips: ["오늘 메뉴", "식당 운영시간"],
      };
    }
    const now = new Date();
    const cards = menuCards(ctx, now.getDay(), U.currentMeal(now));
    const open = cards.filter((c) => c.open);
    const best = open[0] || cards[0];
    return {
      text: open.length
        ? `${o.label}에서 가장 가까운, 지금 문을 연 식당은 ${best.name}${josa(best.name, "이에요", "예요")}.`
        : `지금 문을 연 식당이 없어요. ${o.label}에서 가장 가까운 곳은 ${best.name}${josa(best.name, "이에요", "예요")}.`,
      cards: [best],
      chips: ["식당 운영시간", "가까운 카페", "오늘 메뉴"],
    };
  }

  function answerHours() {
    const now = new Date();
    const rows = CAFETERIAS.map((c) => {
      const open = U.isOpenNow(c.hours, now);
      return { kind: "place", title: c.name, sub: c.hours, tag: open ? "운영 중" : "운영 종료", tagTone: open ? "open" : "closed", buildingId: c.buildingId };
    });
    const n = rows.filter((r) => r.tagTone === "open").length;
    return { text: n ? `지금 ${n}곳이 운영 중이에요.` : "지금은 운영 중인 식당이 없어요.", cards: [{ kind: "list", rows }], chips: ["오늘 메뉴", "가장 가까운 식당"] };
  }

  /** 시설 분류(프린터, 편의점...) 또는 층 이름표(서점, 은행...)로 찾기 */
  function findFacility(t) {
    const key = Object.entries(FACILITY_TYPES).find(([, label]) => t.includes(squash(label)))?.[0];
    if (key) return { label: FACILITY_TYPES[key], match: (f) => f.facilities?.includes(key) };
    const ALIAS = { 은행: "은행", 우체국: "우편", 우편: "우편", 보건: "보건", 서점: "서점", 문구: "문구", 커피: "카페" };
    const word = Object.keys(ALIAS).find((w) => t.includes(w));
    if (!word) return null;
    if (word === "커피") return { label: "카페", match: (f) => f.facilities?.includes("cafe") };
    return { label: word, match: (f) => (f.places || []).some((p) => p.includes(ALIAS[word])) };
  }

  function answerFacility(fac, ctx) {
    const rows = BUILDINGS.flatMap((b) =>
      (b.floors || []).filter(fac.match).map((f) => ({
        kind: "place",
        title: b.name,
        sub: [f.floor, f.note].filter(Boolean).join(", "),
        dist: distOf(ctx, b),
        buildingId: b.id,
      }))
    ).sort(byDist);
    if (!rows.length) {
      return { text: `등록된 ${fac.label} 정보가 아직 없어요. 알고 있는 곳이 있으면 제보해 주세요.`, action: "report", chips: ["프린터 어디 있어?", "편의점"] };
    }
    const o = origin(ctx);
    return {
      text: `${fac.label}${o ? `, ${o.label}에서 가까운 순이에요.` : `${josa(fac.label, "은", "는")} ${rows.length}곳에 있어요.`}`,
      cards: [{ kind: "list", rows }],
      buildingId: rows[0].buildingId,
      chips: ["ATM 어디 있어?", "정수기", "가까운 카페"].filter((c) => !c.includes(fac.label)),
    };
  }

  /* 편의점: 브랜드까지 (data.js 의 CONVENIENCE_STORES) */
  const BRAND_WORDS = { CU: ["cu", "씨유"], GS25: ["gs25", "gs", "지에스"], 세븐일레븐: ["세븐", "7일레븐", "7-11", "711", "seven"], 이마트24: ["이마트24", "emart"] };
  function answerStores(t, ctx) {
    const list = typeof CONVENIENCE_STORES !== "undefined" ? CONVENIENCE_STORES : [];
    const want = Object.keys(BRAND_WORDS).find((k) => BRAND_WORDS[k].some((w) => t.includes(w)));
    const pick = want ? list.filter((x) => x.brand === want) : list;
    if (want && !pick.length) {
      return { ...answerStores("편의점", ctx), text: `교내에 ${want}${josa(want, "은", "는")} 아직 등록되어 있지 않아요. 지금 등록된 편의점이에요.` };
    }
    const rows = pick.map((x) => {
      const b = bById(x.buildingId);
      if (!b) return { kind: "place", title: x.brand, sub: [x.building, x.floor].filter(Boolean).join(" ") };
      const open = x.hours ? U.isOpenNow(x.hours) : null;
      return {
        kind: "place",
        title: x.brand || "편의점",
        sub: [[b.name, x.floor].filter(Boolean).join(" "), x.hours].filter(Boolean).join(", "),
        tag: open == null ? "" : open ? "영업 중" : "영업 시간 아님",
        tagTone: open ? "open" : "",
        dist: distOf(ctx, b),
        buildingId: b.id,
      };
    }).filter(Boolean).sort(byDist);
    const brands = [...new Set(pick.map((x) => x.brand).filter(Boolean))];
    return {
      text: want ? `${want} 위치예요.` : `교내 편의점은 ${rows.length}곳이에요.${brands.length ? ` 확인된 브랜드는 ${brands.join(", ")}예요.` : ""}`,
      cards: [{ kind: "list", rows }],
      buildingId: rows[0]?.buildingId,
      chips: ["CU 어디 있어?", "GS25 어디야?", "가까운 카페"].filter((c) => !want || !c.toLowerCase().includes(want.toLowerCase())),
    };
  }

  /* 은행, ATM (data.js 의 ATMS) */
  function answerAtms(t, ctx) {
    const list = typeof ATMS !== "undefined" ? ATMS : [];
    const want = has(t, ["국민", "kb"]) ? "KB국민은행" : has(t, ["신한"]) ? "신한은행" : null;
    const pick = want ? list.filter((x) => x.bank === want) : list;
    if (!pick.length) return { ...answerAtms("atm", ctx), text: `교내에 ${want} ATM은 아직 등록되어 있지 않아요. 지금 등록된 ATM이에요.` };
    const rows = pick.map((x) => {
      const b = bById(x.buildingId);
      return b && { kind: "place", title: `${x.bank} ${x.kind}`, sub: [b.name, x.floor].filter(Boolean).join(" "), dist: distOf(ctx, b), buildingId: b.id };
    }).filter(Boolean).sort(byDist);
    const banks = [...new Set(pick.map((x) => x.bank))];
    return {
      text: want ? `${want} ATM 위치예요.` : `교내 은행, ATM은 ${rows.length}곳이에요. ${banks.join(", ")}이 있어요.`,
      cards: [{ kind: "list", rows }],
      buildingId: rows[0]?.buildingId,
      chips: ["국민은행 ATM", "편의점 어디 있어?", "가까운 카페"].filter((c) => !want || !c.includes(want.slice(0, 2))),
    };
  }

  /* 길찾기: "진리관에서 도서관까지 얼마나 걸려?" */
  function buildingsInText(t) {
    const found = [];
    BUILDINGS.forEach((b) => {
      const pos = Math.min(...[b.name, ...(b.aliases || [])].map((n) => (n ? t.indexOf(squash(n)) : -1)).filter((i) => i >= 0));
      if (Number.isFinite(pos)) found.push({ b, pos });
    });
    return found.sort((a, c) => a.pos - c.pos).map((x) => x.b);
  }
  async function answerRoute(t, ctx) {
    const list = buildingsInText(t);
    let from = list[0], to = list[1];
    if (list.length === 1) {
      to = list[0];
      from = ctx.userPos ? { ...ctx.userPos, id: "me", name: "내 위치" } : bById(ctx.currentBuildingId);
      if (!from || from.id === to.id) return { text: `어디서 출발하는지 알려주세요. 예) 진리관에서 ${to.name}까지 얼마나 걸려?`, needsLocation: !ctx.userPos };
    }
    if (!from || !to) return null;
    const r = U.routeEstimate(from, to);
    const walk = typeof CampusWalk !== "undefined" ? CampusWalk.route(from, to) : null;
    if (walk) r.walkMin = walk.minutes;
    let live = false;
    if (typeof Api !== "undefined" && Api.online) {
      try {
        const res = await Api.get(`/api/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`);
        r.carMin = res.carMin;
        live = true;
      } catch { /* 네이버 값을 못 받으면 예상값 */ }
    }
    return {
      text: `${from.name}에서 ${to.name}까지 걸어서 약 ${r.walkMin}분, 차로 약 ${r.carMin}분이에요.${walk?.via.length ? `\n걸어갈 때는 ${walk.via.join(", ")} 앞을 지나가요.` : ""}${live ? "\n차량은 네이버 실시간 교통 기준이에요." : ""}`,
      cards: [{ kind: "route", from: from.name, to: to.name, fromId: from.id, toId: to.id, walk: r.walkMin, car: r.carMin, live }],
      chips: [`${to.name}에서 ${from.name}까지`, "가장 가까운 식당"],
    };
  }

  function findBuilding(t, ctx) {
    if (ctx.currentBuildingId && has(t, ["여기", "이건물", "이곳"])) return bById(ctx.currentBuildingId);
    return BUILDINGS.find((b) => [b.name, ...(b.aliases || [])].some((n) => n && t.includes(squash(n))));
  }

  function answerBuilding(b, ctx) {
    const floors = (b.floors || []).map((f) => ({
      floor: f.floor,
      items: (f.places?.length ? f.places : f.facilities.map((k) => FACILITY_TYPES[k])).filter(Boolean),
      note: f.note || "",
    }));
    const type = BUILDING_TYPES[b.type]?.[1] || "";
    const d = !ctx.userPos && b.id === ctx.currentBuildingId ? null : distOf(ctx, b);
    return {
      text: `${b.name} 층별 안내예요.`,
      cards: [{ kind: "building", name: b.name, type, dist: d, crowd: b.crowd?.label || "", floors, buildingId: b.id }],
      chips: ["가장 가까운 식당", "프린터 어디 있어?", "다가오는 일정"],
    };
  }

  function eventDate(e) { return e.end || e.start; }
  function dday(e) {
    const t = new Date(eventDate(e) + "T00:00:00");
    const n = new Date(); n.setHours(0, 0, 0, 0);
    return Math.round((t - n) / 86400000);
  }

  function answerEvents(t) {
    const today = ymd(new Date());
    let list = (typeof EVENTS !== "undefined" ? EVENTS : []).filter((e) => eventDate(e) >= today);
    let what = "다가오는 일정";
    if (has(t, ["마감", "신청", "접수"])) { list = list.filter((e) => e.due); what = "마감이 다가오는 일"; }
    else if (has(t, ["축제"])) { list = list.filter((e) => e.cat === "festival"); what = "축제 일정"; }
    else if (has(t, ["동아리"])) { list = list.filter((e) => e.cat === "club"); what = "동아리 일정"; }
    else if (has(t, ["학사"])) { list = list.filter((e) => e.cat === "academic"); what = "학사 일정"; }
    list.sort((a, b) => eventDate(a).localeCompare(eventDate(b)));
    if (!list.length) return { text: `${what}이 지금은 없어요.`, chips: ["다가오는 일정", "오늘 메뉴"] };
    const rows = list.map((e) => {
      const d = dday(e);
      const range = e.start && e.end ? `${e.start.slice(5).replace("-", "/")} ~ ${e.end.slice(5).replace("-", "/")}` : eventDate(e).slice(5).replace("-", "/");
      return {
        kind: "event",
        title: e.title,
        sub: [e.due ? `${range} ${e.due}` : range, e.place].filter(Boolean).join(", "),
        dday: d === 0 ? "오늘" : `D-${d}`,
        urgent: d <= 3,
        cat: EVENT_CATS[e.cat]?.label || "",
      };
    });
    return { text: `${what}이에요.`, cards: [{ kind: "events", rows }], chips: ["마감 임박한 거", "축제 일정", "동아리 일정"] };
  }

  function answerLost(ctx) {
    const items = (ctx.lostItems || []).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    if (!items.length) return { text: "등록된 분실물이 아직 없어요. 물건을 잃어버렸거나 주웠다면 분실물 탭에서 등록할 수 있어요.", chips: ["다가오는 일정"] };
    const rows = items.map((i) => ({
      kind: "place",
      title: i.title,
      sub: `${bById(i.buildingId)?.name || ""} ${i.place || ""}, ${i.date.slice(5).replace("-", "/")}`.trim(),
      tag: i.type === "lost" ? "분실" : "습득",
      tagTone: i.type === "lost" ? "warm" : "open",
      buildingId: i.buildingId,
    }));
    return { text: "최근 올라온 분실물이에요. 물건을 누르면 그 건물을 지도에서 보여줘요.", cards: [{ kind: "list", rows }], chips: ["도서관 층별 안내", "다가오는 일정"] };
  }

  const HELP_CHIPS = ["오늘 점심 뭐야?", "가장 가까운 식당", "프린터 어디 있어?", "마감 임박한 거", "도서관 층별 안내", "분실물 있어?"];

  /* ---------------- 메인 ---------------- */

  function localReply(text, ctx) {
    const t = squash(text);
    if (!t) return null;

    if (has(t, ["안녕", "하이", "hello", "hi", "반가"])) return { text: "안녕하세요. 학식, 시설 위치, 학사 일정, 분실물을 물어보세요.", chips: HELP_CHIPS };
    if (has(t, ["도움", "뭐할수", "뭘할수", "기능", "help"])) return { text: "이런 걸 물어볼 수 있어요.", chips: HELP_CHIPS };
    if (has(t, ["제보", "틀렸", "잘못", "수정요청"])) return { text: "틀린 정보나 새 시설은 제보로 알려주세요. 운영자가 확인하면 지도에 반영돼요.", action: "report" };
    if (has(t, ["분실", "잃어버", "주웠", "습득", "찾아줘"])) return answerLost(ctx);
    if (has(t, ["일정", "마감", "학사", "축제", "동아리", "행사", "수강신청", "계절학기", "d-day", "디데이"])) return answerEvents(t);

    const dish = has(t, ["언제", "나와", "나오", "있어", "먹을"]) ? answerDish(t) : null;
    if (dish) return dish;
    if (has(t, ["이번주", "주간", "일주일"]) && has(t, ["메뉴", "학식", "밥"])) return answerWeek();
    if (has(t, ["가까운", "가까이", "근처", "제일가까", "가장가까"]) && has(t, ["식당", "밥", "학식", "먹"])) return answerNearest(ctx);
    if (has(t, ["몇시", "운영시간", "영업", "언제까지", "언제열", "열었", "문열", "닫"])) return answerHours();
    if (has(t, ["학식", "메뉴", "밥", "점심", "저녁", "중식", "석식", "뭐먹", "배고"])) return answerMenu(t, ctx);

    if (has(t, ["에서", "까지", "가는길", "가려면", "얼마나걸", "몇분", "걸려"]) && (buildingsInText(t).length >= 2 || has(t, ["까지", "가는길", "가려면"])) && buildingsInText(t).length) {
      return answerRoute(t, ctx);
    }
    if (has(t, ["편의점", "cu", "씨유", "gs25", "지에스", "세븐", "7일레븐", "이마트24"]) || /(^|[^a-z])gs/.test(t)) return answerStores(t, ctx);

    if (has(t, ["atm", "현금", "은행", "출금", "신한", "국민은행", "kb"])) return answerAtms(t, ctx);

    const fac = findFacility(t);
    if (fac) return answerFacility(fac, ctx);

    const b = findBuilding(t, ctx);
    if (b) return answerBuilding(b, ctx);

    if (has(t, ["가까운", "근처"])) return answerNearest(ctx);
    return null;
  }

  /**
   * @param {string} text 사용자 입력
   * @param {{ userPos: {lat,lng}|null, lostItems: Array, currentBuildingId?: string }} ctx
   */
  async function reply(text, ctx) {
    const local = await localReply(text, ctx);
    if (local) return local;
    if (typeof Api !== "undefined" && Api.online) {
      try {
        const res = await Api.post("/api/chat", { message: text, userPos: ctx.userPos });
        if (res && res.text) return { chips: HELP_CHIPS.slice(0, 3), ...res };
      } catch (e) {
        console.warn("서버 챗봇 연결 실패", e);
      }
    }
    return { text: "그 질문은 아직 답하기 어려워요. 아래처럼 물어보면 바로 찾아드려요.", chips: HELP_CHIPS };
  }

  /* ---------------- 첫 화면 ---------------- */

  function welcome(ctx) {
    const now = new Date();
    const h = now.getHours();
    const greet = h < 6 ? "늦은 밤이에요" : h < 11 ? "좋은 아침이에요" : h < 14 ? "점심시간이에요" : h < 18 ? "좋은 오후예요" : "오늘도 수고했어요";
    const openCafes = CAFETERIAS.filter((c) => U.isOpenNow(c.hours, now)).length;
    const today = ymd(now);
    const nextDue = (typeof EVENTS !== "undefined" ? EVENTS : [])
      .filter((e) => e.due && eventDate(e) >= today)
      .sort((a, b) => eventDate(a).localeCompare(eventDate(b)))[0];
    const here = bById(ctx.currentBuildingId);
    return {
      greet,
      status: [
        { label: "운영 중인 식당", value: `${openCafes}곳`, ask: "식당 운영시간", tone: openCafes ? "open" : "" },
        nextDue && { label: nextDue.title, value: dday(nextDue) === 0 ? "오늘 마감" : `D-${dday(nextDue)}`, ask: "마감 임박한 거", tone: dday(nextDue) <= 3 ? "warm" : "" },
      ].filter(Boolean),
      actions: [
        { icon: "meal", label: "오늘 학식", ask: "오늘 점심 뭐야?" },
        { icon: "near", label: "가까운 식당", ask: "가장 가까운 식당" },
        { icon: "printer", label: "프린터 찾기", ask: "프린터 어디 있어?" },
        { icon: "store", label: "편의점", ask: "편의점 어디 있어?" },
        { icon: "calendar", label: "다가오는 일정", ask: "다가오는 일정" },
        here ? { icon: "building", label: `${here.name} 안내`, ask: `${here.name} 층별 안내` } : { icon: "lost", label: "분실물", ask: "분실물 있어?" },
      ],
    };
  }

  /* ---------------- 그리기 (app.js 가 사용) ---------------- */

  const ICONS = {
    meal: "M5 3v8a2 2 0 0 0 2 2v8M9 3v8M7 3v4M16 3c-1.7 1-3 3.2-3 6 0 2 1 3 3 3v9",
    near: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    printer: "M7 9V3h10v6M7 17H4v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6h-3M7 14h10v7H7z",
    store: "M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s2.7-1.3 2.7-3c0 1.7 1.3 3 2.3 3s2.3-1.3 2.3-3c0 1.7 1 3 2.7 3s3-1.3 3-3M10 20v-5h4v5",
    calendar: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
    building: "M5 21V4h9v17M14 9h5v12M8 8h3M8 12h3M8 16h3M3 21h18",
    lost: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  };
  const icon = (k, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[k] || ICONS.near}"/></svg>`;
  const chev = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
  const walk = (m) => (m == null ? "" : m < 20 ? "같은 건물" : `도보 ${U.walkMinutes(m)}분`);
  const goAttr = (id) => (id ? ` data-go="${esc(id)}"` : "");

  function renderWelcome(w) {
    return `
      <div class="cw">
        <p class="cw-greet">${esc(w.greet)}</p>
        <h3 class="cw-title">무엇을 찾고 있나요?</h3>
        ${w.status.length ? `<div class="cw-status">${w.status.map((s) => `
          <button class="cw-stat ${s.tone}" data-ask="${esc(s.ask)}">
            <b>${esc(s.value)}</b><span>${esc(s.label)}</span>
          </button>`).join("")}</div>` : ""}
        <div class="cw-grid">${w.actions.map((a) => `
          <button class="cw-act" data-ask="${esc(a.ask)}"><i>${icon(a.icon)}</i><span>${esc(a.label)}</span></button>`).join("")}
        </div>
      </div>`;
  }

  const SHOW = 4; // 목록 카드는 처음에 4개만, 나머지는 더보기
  const moreBtn = (rows) => (rows.length > SHOW ? `<button class="cc-more" data-more="1">더보기 ${rows.length - SHOW}개</button>` : "");

  function renderCard(c) {
    if (c.kind === "menu") {
      const rest = c.items.filter((x) => x !== mainDish(c.items));
      return `
        <article class="cc cc-menu">
          <header>
            <div><b>${esc(c.name)}</b><small>${esc(c.place)}</small></div>
            ${c.open == null ? "" : `<span class="pill ${c.open ? "open" : "closed"}">${c.open ? "운영 중" : "운영 종료"}</span>`}
          </header>
          <p class="cc-main">${esc(mainDish(c.items))}</p>
          <p class="cc-rest">${esc(rest.join(", "))}</p>
          <footer>
            <span>${esc(c.hours)}${c.dist != null ? `<em>${esc(walk(c.dist))}</em>` : ""}</span>
            <button class="cc-go"${goAttr(c.buildingId)}>지도에서 보기</button>
          </footer>
        </article>`;
    }
    if (c.kind === "list") {
      return `<div class="cc cc-list">${c.rows.map((r, i) => `
        <button class="cc-row${i >= SHOW ? " cc-extra" : ""}"${goAttr(r.buildingId)}>
          <span class="cc-row-txt"><b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span>
          ${r.tag ? `<span class="pill ${r.tagTone || ""}">${esc(r.tag)}</span>` : ""}
          ${r.dist != null ? `<span class="cc-dist">${esc(walk(r.dist))}</span>` : ""}
          ${r.buildingId ? chev : ""}
        </button>`).join("")}${moreBtn(c.rows)}</div>`;
    }
    if (c.kind === "events") {
      return `<div class="cc cc-list">${c.rows.map((r, i) => `
        <div class="cc-row cc-event${i >= SHOW ? " cc-extra" : ""}">
          <span class="cc-dday ${r.urgent ? "urgent" : ""}">${esc(r.dday)}</span>
          <span class="cc-row-txt"><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span>
        </div>`).join("")}${moreBtn(c.rows)}</div>`;
    }
    if (c.kind === "week") {
      return `<div class="cc cc-week">${c.rows.map((r) => `
        <div class="cc-wrow ${r.today ? "today" : ""}">
          <span class="cc-wday">${esc(r.day)}</span>
          <span class="cc-wdish">${r.dishes.map((d) => `<span><b>${esc(d.dish)}</b><small>${esc(d.cafe)}</small></span>`).join("")}</span>
        </div>`).join("")}</div>`;
    }
    if (c.kind === "route") {
      return `
        <article class="cc cc-route">
          <div class="cc-rt-path"><span><i class="from"></i>${esc(c.from)}</span><span><i class="to"></i>${esc(c.to)}</span></div>
          <div class="cc-rt-modes">
            <div><small>도보</small><b>${c.walk}<em>분</em></b></div>
            <div><small>차량</small><b>${c.car}<em>분</em></b></div>
          </div>
          <footer><span>${c.live ? "차량: 네이버 실시간 교통" : "직선거리로 계산한 예상 시간"}</span><button class="cc-go" data-route-to="${esc(c.toId)}" data-route-from="${esc(c.fromId)}">걷는 길 보기</button></footer>
        </article>`;
    }
    if (c.kind === "building") {
      return `
        <article class="cc cc-bld">
          <header>
            <div><b>${esc(c.name)}</b><small>${esc([c.type, c.dist != null ? walk(c.dist) : "", c.crowd].filter(Boolean).join(", "))}</small></div>
          </header>
          <ul>${c.floors.map((f) => `
            <li><span class="cc-floor">${esc(f.floor)}</span><span>${esc(f.items.join(", ") || "등록된 시설 없음")}${f.note ? `<small>${esc(f.note)}</small>` : ""}</span></li>`).join("")}
          </ul>
          <footer><span></span><button class="cc-go"${goAttr(c.buildingId)}>지도에서 보기</button></footer>
        </article>`;
    }
    return "";
  }

  /** 봇 답변 하나 → HTML */
  function renderReply(res) {
    const cards = res.cards || [];
    const menus = cards.filter((c) => c.kind === "menu");
    const others = cards.filter((c) => c.kind !== "menu");
    const menuHtml = menus.length > 1
      ? `<div class="cc-rail" tabindex="0" aria-label="식당 ${menus.length}곳, 옆으로 넘겨 보세요">${menus.map(renderCard).join("")}</div>`
      : menus.map(renderCard).join("");
    const hasGoCard = cards.some((c) => c.buildingId || c.toId || c.rows?.some((r) => r.buildingId));
    return `
      ${res.text ? `<div class="cb">${esc(res.text)}</div>` : ""}
      ${menuHtml}${others.map(renderCard).join("")}
      ${res.buildingId && !hasGoCard ? `<button class="cc-go solo"${goAttr(res.buildingId)}>지도에서 보기</button>` : ""}
      ${res.needsLocation ? `<button class="cc-go solo" data-locate="1">내 위치 사용하기</button>` : ""}
      ${res.action === "report" ? `<button class="cc-go solo" data-report="1">정보 제보하기</button>` : ""}`;
  }

  return { reply, welcome, renderWelcome, renderReply, HELP_CHIPS };
})();
