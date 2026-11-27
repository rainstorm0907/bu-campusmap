/**
 * 화면(UI) 로직
 * - 지도 관련 작업은 모두 CampusMap(js/map.js)을 통해서만 합니다.
 * - 서버가 켜져 있으면 DB(관리자 앱에서 올린 실제 메뉴 등)를 사용하고,
 *   아니면 js/data.js 예시 데이터 + localStorage 로 동작합니다.
 * - 화면 구성: 지도 전체 + 위 검색창과 분류 + 아래 시트
 *   시트 내용: 곧 있을 일들(처음) / 목록(분류, 검색) / 건물 요약 / 건물 페이지(끝까지 올렸을 때)
 */
(() => {
  const U = CampusUtil;
  const $ = (sel) => document.querySelector(sel);
  const buildingById = (id) => BUILDINGS.find((b) => b.id === id);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const todayIdx = () => new Date().getDay();
  const replaceAll = (arr, items) => arr.splice(0, arr.length, ...items);
  const facilitiesOf = (b) => (b.floors || []).flatMap((f) => f.facilities);
  const cafesOf = (b) => CAFETERIAS.filter((c) => c.buildingId === b.id);
  const walk = (b) => (state.userPos && b ? `걸어서 ${U.walkMinutes(U.distance(state.userPos, b))}분` : "");
  const korDate = (s) => { const [, m, d] = s.split("-").map(Number); return `${m}월 ${d}일`; };
  const DAY_KO = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

  /* -------------------- 로컬 저장소 (서버 없을 때) -------------------- */
  const Local = {
    load(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },
    save(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    },
  };

  const state = {
    lostItems: [],
    reports: [],
    userPos: null,
    weekStart: null, // 학식에 보여줄 주의 월요일
    cafeDate: null,     // 학식에 보여줄 날짜 (YYYY-MM-DD)
    cafeCalOpen: false, // 학식 달력 열림
    cafeCalMonth: null, // 학식 달력에 보이는 달
    menuCache: {},      // 이번 주가 아닌 날짜의 메뉴 (서버에서 받아 둠) { 날짜: { 식당id: { lunch, dinner } } }
    route: { from: null, to: null }, // 길찾기: 건물 id 또는 "me"(내 위치)
    meal: U.currentMeal(),
    loadedDate: null, // 메뉴를 마지막으로 불러온 날짜 (자정 넘어가면 다시 불러옴)
    cat: "all",       // 위쪽 분류
    query: "",
    lostFilter: "all",
    view: { kind: "home" }, // home | list | summary | page
    prevView: null,
    homeTab: "all",   // 곧 있을 일들: all | academic | club | festival
    homeAll: false,   // "전체 보기"
    calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // 학사 달력에 보이는 달
    calDay: null,     // 달력에서 누른 날 (YYYY-MM-DD)
    pageTab: "home",
    floorIdx: 0,
    votes: {},
  };

  /** 이번 주 월요일 (토/일이면 다음 주 월요일) */
  function currentWeekStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? 1 : day === 6 ? 2 : 1 - day));
    return d;
  }
  const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const isWeekend = (s) => [0, 6].includes(parseYmd(s).getDay());
  /** 학식 기본 날짜: 오늘 (주말이면 다음 월요일) */
  function defaultCafeDate() {
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 6 ? 2 : d.getDay() === 0 ? 1 : 0));
    return ymd(d);
  }

  /* ============================================================
   *  서버 데이터 불러오기
   * ============================================================ */
  async function loadFromServer() {
    const [buildings, cafes, lost, reports] = await Promise.all([
      Api.get("/api/buildings"), Api.get("/api/cafeterias"), Api.get("/api/lost"), Api.get("/api/reports"),
    ]);
    replaceAll(BUILDINGS, buildings);
    replaceAll(CAFETERIAS, cafes.map((c) => ({ ...c, weeklyMenu: {} })));
    state.lostItems = lost;
    state.reports = reports;
    await loadWeekMenus();
  }

  /** 이번 주(월~금) 메뉴를 DB 에서 받아 weeklyMenu 형태로 변환 */
  async function loadWeekMenus() {
    state.weekStart = currentWeekStart();
    state.loadedDate = today();
    if (!Api.online) return;
    const fri = new Date(state.weekStart);
    fri.setDate(fri.getDate() + 4);
    const menus = await Api.get(`/api/menus?from=${ymd(state.weekStart)}&to=${ymd(fri)}`);
    CAFETERIAS.forEach((c) => (c.weeklyMenu = {}));
    menus.forEach((m) => {
      const cafe = CAFETERIAS.find((c) => c.id === m.cafeteriaId);
      if (!cafe) return;
      const [y, mo, d] = m.date.split("-").map(Number);
      const day = new Date(y, mo - 1, d).getDay();
      (cafe.weeklyMenu[day] ||= {})[m.meal] = m.items;
    });
  }

  /** 메뉴 최신화: 관리자가 수정했거나 날짜가 바뀌었으면 다시 그림 */
  async function refreshMenus() {
    const dayChanged = state.loadedDate !== today();
    try {
      await loadWeekMenus();
    } catch { return; }
    if (dayChanged) {
      state.cafeDate = defaultCafeDate();
      state.meal = U.currentMeal();
    }
    render();
  }

  /* ============================================================
   *  아래 시트
   *  높이 세 단계: peek(내림) / half(반) / full(전체)
   * ============================================================ */
  const sheet = $("#sheet");
  const body = $("#sheetBody");
  /** 넓은 화면(PC): 시트가 왼쪽 열에 있어 지도를 아래가 아니라 왼쪽에서 가린다. 시트 동작은 폰과 같다 */
  const isDesktop = () => window.matchMedia("(min-width: 769px)").matches;
  const Sheet = {
    st: "half",
    H: () => sheet.offsetHeight,
    pos(s) {
      const H = this.H();
      if (s === "full") return 0;
      if (s === "peek") return H - (this.peekH() + safeBottom());
      if (["summary", "nav"].includes(state.view.kind)) return Math.max(H * 0.35, H - ((body.firstElementChild?.offsetHeight || 0) + 40 + safeBottom()));
      return H * 0.5;
    },
    peekH: () => 96,
    set(s) {
      this.st = s;
      // 요약 <-> 건물 페이지는 높이를 바꾸면서 내용도 바꾼다
      if (state.view.kind === "summary" && s === "full") { state.view = { kind: "page", id: state.view.id }; state.pageTab = "home"; renderSheet(); body.scrollTop = 0; }
      else if (state.view.kind === "page" && s !== "full") { state.view = { kind: "summary", id: state.view.id }; renderSheet(); }
      sheet.dataset.state = s;
      sheet.style.transform = `translateY(${this.pos(s)}px)`;
      sheet.style.setProperty("--hidden", `${Math.max(0, this.pos(s))}px`); // 가려진 만큼 아래 여백 → 끝까지 스크롤
      placeFabs();
    },
    visible() { return isDesktop() ? 0 : this.H() - this.pos(this.st); },
  };
  const safeBottom = () => $("#sab")?.offsetHeight || 0; // 아이폰 아래 홈 막대 높이

  function placeFabs() {
    const v = isDesktop() ? 0 : Math.min(Sheet.visible(), window.innerHeight * 0.6);
    $("#locateBtn").style.bottom = `${v + 14}px`;
    $("#chatFab").style.bottom = `${v + 66}px`;
    const hideFabs = !isDesktop() && Sheet.st === "full";
    $("#locateBtn").hidden = hideFabs;
    $("#chatFab").hidden = hideFabs;
  }

  // 손잡이 끌기
  (() => {
    const grab = $("#grab");
    let y0 = null, t0 = 0;
    grab.addEventListener("pointerdown", (e) => {
      y0 = e.clientY; t0 = Sheet.pos(Sheet.st);
      sheet.classList.add("drag");
      grab.setPointerCapture(e.pointerId);
    });
    grab.addEventListener("pointermove", (e) => {
      if (y0 == null) return;
      sheet.style.transform = `translateY(${Math.max(0, t0 + e.clientY - y0)}px)`;
    });
    const end = (e) => {
      if (y0 == null) return;
      sheet.classList.remove("drag");
      const moved = e.clientY - y0;
      const y = t0 + moved;
      y0 = null;
      if (Math.abs(moved) < 6) { // 손잡이를 그냥 누르면 한 단계 위로
        Sheet.set(Sheet.st === "peek" ? "half" : Sheet.st === "half" ? "full" : "half");
        return;
      }
      const best = ["peek", "half", "full"].sort((a, b) => Math.abs(Sheet.pos(a) - y) - Math.abs(Sheet.pos(b) - y))[0];
      Sheet.set(best);
    };
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", end);
  })();

  /* ============================================================
   *  시트 내용
   * ============================================================ */
  const ICON = {
    x: '<svg width="14" height="14" viewBox="0 0 24 24" stroke="#626873" stroke-width="2"><path d="M5 5l14 14M19 5L5 19"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1D1D1F" stroke-width="2"><path d="M15 5l-7 7 7 7"/></svg>',
  };
  const typeChip = (b) => {
    const [color, label] = BUILDING_TYPES[b.type] || ["#4A7DFF", "건물"];
    return `<span class="type" style="color:${color};background:${color}1A">${label}</span>`;
  };

  /* ---------- 곧 있을 일들 (처음 화면) ---------- */
  const md = (s) => { const [, m, d] = s.split("-").map(Number); return `${m}/${d}`; };
  const daysTo = (s) => Math.round((new Date(`${s}T00:00`) - new Date(`${today()}T00:00`)) / 86400000);
  const dLabel = (n) => (n === 0 ? "D-DAY" : `D-${n}`);
  const URGENT_DAYS = 3; // 마감까지 며칠 남으면 "마감 임박" 카드로 올릴지
  const isUrgent = (e) => e.end && daysTo(e.end) >= 0 && daysTo(e.end) <= URGENT_DAYS && (!e.start || e.start <= today());
  /** 목록에 보일 날짜와 설명: 아직 안 시작했으면 시작일, 진행 중이면 마감일 */
  function eventWhen(e) {
    const now = today();
    if (!e.end) return { date: e.start, sub: e.place || "" };
    if (e.start && e.start > now) return { date: e.start, sub: e.place || `${korDate(e.start)}부터` };
    return { date: e.end, sub: e.place || `${korDate(e.end)}까지` };
  }
  const HOME_TABS = [["all", "전체"], ["academic", "학사"], ["club", "동아리"], ["festival", "축제"]];

  function urgentCards(list) {
    const cards = list.filter(isUrgent).sort((x, y) => x.end.localeCompare(y.end));
    if (!cards.length) return "";
    return `<div class="head sec"><h3>마감 임박</h3>${cards.length > 2 ? `<span class="quiet">옆으로 넘겨보세요</span>` : ""}</div>
      <div class="dcards">${cards.map((e) => {
        const c = EVENT_CATS[e.cat];
        const n = daysTo(e.end);
        return `<div class="dcard"><div class="dbox" style="background:${c.bg};color:${c.fg}"><span class="dday${n <= 2 ? " hot" : ""}">${dLabel(n)}</span><b>${esc(e.title)}</b></div>
          <small>${md(e.end)} ${esc(e.due || "마감")}</small></div>`;
      }).join("")}</div>`;
  }

  function upcomingList(list) {
    const now = today();
    const rows = list.filter((e) => (e.end || e.start) >= now && !isUrgent(e))
      .map((e) => ({ e, w: eventWhen(e) }))
      .sort((x, y) => x.w.date.localeCompare(y.w.date));
    const shown = state.homeAll ? rows : rows.slice(0, 4);
    return `<div class="head sec"><h3>다가오는 일정</h3>${rows.length > 4 ? `<button class="more" data-act="home-all">${state.homeAll ? "접기" : "전체 보기"}</button>` : ""}</div>
      <ul class="erows">${shown.map(({ e, w }) => `<li><span class="k">${md(w.date)}</span><div><p>${esc(e.title)}</p>${w.sub ? `<small>${esc(w.sub)}</small>` : ""}</div>
        <i class="thumb" style="background:${EVENT_CATS[e.cat].bg}"></i></li>`).join("") || `<li class="empty">다가오는 일정이 없어요</li>`}</ul>`;
  }

  /** 학사: 달력 + 그 달 학사 일정 */
  function academicView() {
    const now = today();
    const list = EVENTS.filter((e) => e.cat === "academic");
    const m0 = state.calMonth;
    const y = m0.getFullYear(), m = m0.getMonth();
    const key = (d) => ymd(new Date(y, m, d));
    const marked = new Set(list.flatMap((e) => [e.start, e.end].filter(Boolean)));
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [...Array(first).fill(""), ...Array.from({ length: days }, (_, i) => i + 1)].map((d, i) => {
      if (!d) return "<span></span>";
      const k = key(d);
      const cls = [i % 7 === 0 ? "sun" : "", k === now ? "today" : "", k === state.calDay ? "pick" : ""].join(" ").trim();
      return `<button data-act="cal-day" data-d="${k}" class="${cls}">${d}${marked.has(k) ? "<i></i>" : ""}</button>`;
    }).join("");
    const monthStart = key(1), monthEnd = key(days);
    const inView = (e) => state.calDay
      ? (e.start || e.end) <= state.calDay && (e.end || e.start) >= state.calDay
      : state.homeAll || ((e.start || e.end) <= monthEnd && (e.end || e.start) >= monthStart);
    const rows = list.filter(inView).map((e) => {
      let date = e.start || e.end, sub = "", badge;
      if (e.end && e.start && e.start <= now && e.end >= now) {
        const n = daysTo(e.end);
        if (n <= 7) { date = e.end; sub = `${korDate(e.end)}까지`; badge = `<span class="badge blue">${dLabel(n)}</span>`; }
        else { sub = `${korDate(e.start)}부터`; badge = `<span class="badge">진행 중</span>`; }
      } else if ((e.end || e.start) < now) {
        sub = e.end ? `${korDate(e.end)}까지` : ""; badge = `<span class="badge past">끝남</span>`;
      } else {
        sub = e.end ? `${korDate(e.end)}까지` : ""; badge = `<span class="badge blue">${dLabel(daysTo(date))}</span>`;
      }
      return { date, html: `<li class="${(e.end || e.start) < now ? "past" : ""}"><span class="k">${md(date)}</span><div><p>${esc(e.title)}</p>${sub ? `<small>${sub}</small>` : ""}</div>${badge}</li>` };
    }).sort((a, b) => a.date.localeCompare(b.date)).map((r) => r.html).join("");
    const title = state.calDay ? `${korDate(state.calDay)} 학사 일정` : "학사 일정";
    return `<div class="cal">
        <div class="cal-head"><button data-act="cal-move" data-n="-1" aria-label="이전 달">‹</button><b>${y}년 ${m + 1}월</b><button data-act="cal-move" data-n="1" aria-label="다음 달">›</button></div>
        <div class="cal-grid wk">${["일", "월", "화", "수", "목", "금", "토"].map((d, i) => `<span class="${i ? "" : "sun"}">${d}</span>`).join("")}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="head sec"><h3>${title}</h3>${state.calDay ? `<button class="more" data-act="cal-day" data-d="${state.calDay}">이 달 전체</button>` : `<button class="more" data-act="home-all">${state.homeAll ? "이 달만" : "전체 보기"}</button>`}</div>
      <ul class="erows">${rows || `<li class="empty">이 기간에 학사 일정이 없어요</li>`}</ul>`;
  }

  function viewHome() {
    const d = new Date();
    const tab = state.homeTab;
    const list = tab === "all" ? EVENTS : EVENTS.filter((e) => e.cat === tab);
    const inner = tab === "academic" ? academicView() : urgentCards(list) + upcomingList(list);
    return `<div class="head home-head"><h2>곧 있을 일들</h2><span class="quiet">${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_KO[d.getDay()]}</span></div>
      <div class="etabs">${HOME_TABS.map(([k, l]) => `<button data-act="home-tab" data-t="${k}" class="${tab === k ? `on${k === "all" ? " dark" : ""}` : ""}">${l}</button>`).join("")}</div>
      ${inner}`;
  }

  /* ---------- 목록: 분류, 검색 ---------- */
  function matchBuildings() {
    const q = state.query.trim().toLowerCase();
    const f = state.cat;
    return BUILDINGS.filter((b) => {
      if (FACILITY_TYPES[f] && !facilitiesOf(b).includes(f)) return false;
      if (f === "food" && !cafesOf(b).length) return false;
      if (!q) return true;
      const text = [b.name, ...(b.aliases || []), ...(b.floors || []).map((x) => x.note), ...facilitiesOf(b).map((t) => FACILITY_TYPES[t]),
        ...cafesOf(b).map((c) => c.name)].join(" ").toLowerCase();
      return text.includes(q);
    });
  }
  function matchLost() {
    const q = state.query.trim().toLowerCase();
    return state.lostItems
      .filter((i) => state.lostFilter === "all" || i.type === state.lostFilter)
      .filter((i) => !q || `${i.title} ${i.place} ${i.desc}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  const buildingRow = (b) => {
    const f = state.cat;
    const floors = (b.floors || [])
      .filter((x) => !FACILITY_TYPES[f] || x.facilities.includes(f))
      .map((x) => `${x.floor} ${x.facilities.map((t) => FACILITY_TYPES[t] || t).join(", ")}`).join(", ");
    return `<li class="row tap" data-act="select" data-id="${esc(b.id)}"><div><p class="strong">${esc(b.name)}</p><small>${esc(floors)}</small></div><span class="quiet">${walk(b)}</span></li>`;
  };
  const lostRow = (i) => `<li class="row tap" data-act="select" data-id="${esc(i.buildingId)}">
      <span class="pill ${i.type === "lost" ? "lost" : ""}">${i.type === "lost" ? "분실" : "습득"}</span>
      <div><p class="strong">${esc(i.title)}</p><small>${esc(buildingById(i.buildingId)?.name)} ${esc(i.place)}, ${esc(i.contact || "연락처 없음")}</small></div>
      <span class="quiet">${esc(korDate(i.date))}</span></li>`;

  /* ---------- 학식 날짜: 이전/다음 + 누르면 달력 ---------- */
  /** 그 날 메뉴. 이번 주는 이미 받아 둔 값, 다른 주는 서버에서 그 주를 받아 온다 (받는 중이면 null) */
  const menuLoading = new Set();
  function menuFor(c, ds, meal) {
    const day = parseYmd(ds).getDay();
    if (day === 0 || day === 6) return [];
    const start = ymd(state.weekStart || currentWeekStart());
    const fri = new Date(state.weekStart || currentWeekStart());
    fri.setDate(fri.getDate() + 4);
    if (!Api.online || (ds >= start && ds <= ymd(fri))) return U.getMenu(c, day, meal);
    const cached = state.menuCache[ds];
    if (cached) return cached[c.id]?.[meal] || [];
    loadMenusFor(ds);
    return null;
  }
  async function loadMenusFor(ds) {
    const mon = parseYmd(ds);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const key = ymd(mon);
    if (menuLoading.has(key)) return;
    menuLoading.add(key);
    const fri = new Date(mon);
    fri.setDate(fri.getDate() + 4);
    try {
      const menus = await Api.get(`/api/menus?from=${key}&to=${ymd(fri)}`);
      for (let d = new Date(mon); d <= fri; d.setDate(d.getDate() + 1)) state.menuCache[ymd(d)] ||= {};
      menus.forEach((m) => ((state.menuCache[m.date][m.cafeteriaId] ||= {})[m.meal] = m.items));
    } catch {
      for (let d = new Date(mon); d <= fri; d.setDate(d.getDate() + 1)) state.menuCache[ymd(d)] ||= {};
    }
    menuLoading.delete(key);
    renderSheet();
  }

  /** 평일만 n 칸 이동 */
  function stepWeekday(ds, n) {
    const d = parseYmd(ds);
    do d.setDate(d.getDate() + Math.sign(n)); while ([0, 6].includes(d.getDay()));
    return ymd(d);
  }

  function cafeCalendar() {
    const m0 = state.cafeCalMonth || parseYmd(state.cafeDate);
    const y = m0.getFullYear(), m = m0.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const now = today();
    const cells = [...Array(first).fill(0), ...Array.from({ length: days }, (_, i) => i + 1)].map((d, i) => {
      if (!d) return "<span></span>";
      const k = ymd(new Date(y, m, d));
      const off = i % 7 === 0 || i % 7 === 6;
      const cls = [off ? "off" : "", k === now ? "today" : "", k === state.cafeDate ? "pick" : ""].join(" ").trim();
      return `<button data-act="cafe-pick" data-d="${k}" class="${cls}" ${off ? 'disabled aria-label="주말, 운영 안 함"' : ""}>${d}</button>`;
    }).join("");
    return `<div class="mcal" role="dialog" aria-label="학식 날짜 고르기">
      <div class="mcal-head">
        <button data-act="cafe-cal-move" data-n="-1" aria-label="이전 달">${ICON.back}</button>
        <b>${y}년 ${m + 1}월</b>
        <button data-act="cafe-cal-move" data-n="1" aria-label="다음 달" class="flip">${ICON.back}</button>
      </div>
      <div class="mcal-grid wk">${["일", "월", "화", "수", "목", "금", "토"].map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="mcal-grid">${cells}</div>
      <div class="mcal-foot"><span>주말은 학식을 운영하지 않아요</span><button data-act="cafe-pick" data-d="${defaultCafeDate()}">오늘로</button></div>
    </div>`;
  }

  function dayMealChips() {
    const ds = state.cafeDate;
    const dt = parseYmd(ds);
    const diff = Math.round((dt - parseYmd(today())) / 86400000);
    const rel = diff === 0 ? "오늘" : diff === 1 ? "내일" : diff === -1 ? "어제" : "";
    const meals = [["lunch", "점심"], ["dinner", "저녁"]].map(([k, l]) => `<button data-act="cafe-meal" data-m="${k}" class="${state.meal === k ? "on" : ""}">${l}</button>`).join("");
    return `<div class="mdate">
        <button class="mdate-step" data-act="cafe-step" data-n="-1" aria-label="이전 평일">${ICON.back}</button>
        <button class="mdate-pick ${state.cafeCalOpen ? "open" : ""}" data-act="cafe-cal" aria-expanded="${state.cafeCalOpen}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16v15H4zM4 10h16M8 3v5M16 3v5"/></svg>
          <b>${dt.getMonth() + 1}월 ${dt.getDate()}일 ${DAY_KO[dt.getDay()]}</b>${rel ? `<span class="mdate-rel">${rel}</span>` : ""}
          <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button class="mdate-step flip" data-act="cafe-step" data-n="1" aria-label="다음 평일">${ICON.back}</button>
      </div>
      ${state.cafeCalOpen ? cafeCalendar() : ""}
      <div class="opts">${meals}</div>`;
  }
  const cafeBlock = (c, withVotes) => {
    const open = U.isOpenNow(c.hours);
    const menu = menuFor(c, state.cafeDate, state.meal);
    const b = buildingById(c.buildingId);
    const items = menu === null
      ? `<li class="menu quiet">메뉴를 불러오는 중이에요</li>`
      : menu.length
      ? menu.map((m) => {
          const key = `${c.id}|${state.cafeDate}|${state.meal}|${m}`;
          const v = state.votes[key];
          return `<li class="menu"><span>${esc(m)}</span>${withVotes ? `<span class="vote">
            <button data-act="vote" data-k="${esc(key)}" data-v="up" class="${v === "up" ? "on up" : ""}">좋아요</button>
            <button data-act="vote" data-k="${esc(key)}" data-v="down" class="${v === "down" ? "on" : ""}">별로예요</button></span>` : ""}</li>`;
        }).join("")
      : `<li class="menu quiet">${isWeekend(state.cafeDate) ? "주말은 운영하지 않아요" : "등록된 메뉴가 없어요"}</li>`;
    return `<div class="cafe">
      <div class="head"><p class="strong">${esc(c.name)} <span class="live ${open ? "open" : ""}">${open ? "지금 운영 중" : "운영 시간 아님"}</span></p><span class="quiet">${esc(c.price)}</span></div>
      <small>${esc(b?.name)} ${esc(c.floor || "")}, ${esc(c.hours)}</small>
      <ul>${items}</ul></div>`;
  };

  function viewList() {
    const c = state.cat;
    if (c === "lost") {
      const items = matchLost();
      return `<div class="head"><h2>분실물</h2><button class="link" data-act="lost-add">분실물 올리기</button></div>
        <div class="opts">${[["all", "전체"], ["lost", "잃어버렸어요"], ["found", "주웠어요"]].map(([k, l]) =>
          `<button data-act="lost-filter" data-f="${k}" class="${state.lostFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
        <ul class="rows">${items.length ? items.map(lostRow).join("") : `<li class="empty">등록된 분실물이 없어요</li>`}</ul>`;
    }
    if (c === "food") {
      const rows = CAFETERIAS.map((x) => ({ x, b: buildingById(x.buildingId) }))
        .map((r) => ({ ...r, m: state.userPos && r.b ? U.distance(state.userPos, r.b) : null }));
      if (state.userPos) rows.sort((a, b) => a.m - b.m);
      return `<div class="head"><h2>학식</h2><span class="quiet">${state.userPos ? "가까운 순" : ""}</span></div>${dayMealChips()}
        ${rows.map(({ x, b }) => `<div class="tapblock" data-act="select" data-id="${esc(b?.id)}" data-tab="food">${cafeBlock(x, false)}<span class="quiet">${walk(b)}</span></div>`).join("")}`;
    }
    if (c === "convenience" && !state.query) return viewStores();
    if (c === "atm" && !state.query) return viewAtms();
    const list = matchBuildings();
    const lost = state.query ? matchLost() : [];
    const title = state.query ? `"${esc(state.query)}" 검색 결과` : esc(FACILITY_TYPES[c] || "건물");
    const none = !list.length && !lost.length;
    return `<div class="head"><h2>${title}</h2><span class="quiet">${list.length ? `${list.length}곳` : ""}</span></div>
      <ul class="rows">${list.map(buildingRow).join("")}</ul>
      ${lost.length ? `<p class="sub">분실물</p><ul class="rows">${lost.map(lostRow).join("")}</ul>` : ""}
      ${none ? `<div class="empty">등록된 정보가 없어요<br><small>시설이 없다는 뜻은 아니에요. 챗봇에게 물어보거나 제보해 주세요.</small></div>
        <div class="acts"><button class="btn" data-act="ask-chat">챗봇에게 물어보기</button><button class="btn" data-act="report">제보하기</button></div>` : ""}`;
  }

  /* ---------- 편의점: 브랜드별 (로고는 icons/brands) ---------- */
  const BRAND = {
    CU: "icons/brands/cu.svg",
    GS25: "icons/brands/gs25.svg",
    세븐일레븐: "icons/brands/7eleven.svg",
    이마트24: "icons/brands/emart24.svg",
    신한은행: "icons/brands/shinhan.svg",
    KB국민은행: "icons/brands/kb.svg",
  };
  const brandBadge = (brand, small) => (BRAND[brand]
    ? `<span class="brand${small ? " sm" : ""}"><img src="${BRAND[brand]}" alt="${esc(brand)}"></span>`
    : `<span class="brand none${small ? " sm" : ""}" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24"><path d="${CAT_ICON.convenience[1]}" fill="currentColor"/></svg></span>`);
  function storeList() {
    return CONVENIENCE_STORES.map((st) => {
      const b = st.buildingId ? buildingById(st.buildingId) : null;
      return { ...st, b, where: [b?.name || st.building || "", st.floor].filter(Boolean).join(" "), m: state.userPos && b ? U.distance(state.userPos, b) : null };
    }).sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9) || Object.keys(BRAND).indexOf(a.brand) - Object.keys(BRAND).indexOf(b.brand));
  }
  function viewStores() {
    const list = storeList();
    const count = {};
    list.forEach((x) => (count[x.brand] = (count[x.brand] || 0) + 1));
    return `<div class="head"><h2>편의점</h2><span class="quiet">${list.length}곳${state.userPos ? ", 가까운 순" : ""}</span></div>
      <div class="brands-sum">${Object.entries(count).map(([br, n]) => `<span class="bsum">${brandBadge(br, true)}<b>${n}</b></span>`).join("")}</div>
      <ul class="stores">${list.map((x) => {
        const open = x.hours ? U.isOpenNow(x.hours) : null;
        return `<li class="${x.b ? "tap" : ""}" ${x.b ? `data-act="select" data-id="${esc(x.b.id)}"` : ""}>
          ${brandBadge(x.brand)}
          <div class="store-txt">
            <p><b>${esc(x.brand || "편의점")}</b></p>
            <small>${esc(x.where)}${x.hours ? `, ${esc(x.hours)}` : ""}</small>
          </div>
          <div class="store-side">${open == null ? "" : `<span class="live ${open ? "open" : ""}">${open ? "영업 중" : "영업 시간 아님"}</span>`}<span class="quiet">${x.b ? walk(x.b) : ""}</span></div>
        </li>`;
      }).join("")}</ul>
      <p class="src">바뀐 곳이 있으면 알려주세요. <button class="link" data-act="report">제보하기</button></p>`;
  }

  /* ---------- ATM: 은행별 ---------- */
  function viewAtms() {
    const list = ATMS.map((x) => {
      const b = buildingById(x.buildingId);
      return { ...x, b, m: state.userPos && b ? U.distance(state.userPos, b) : null };
    }).filter((x) => x.b)
      .sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9) || Object.keys(BRAND).indexOf(a.bank) - Object.keys(BRAND).indexOf(b.bank));
    const count = {};
    list.forEach((x) => (count[x.bank] = (count[x.bank] || 0) + 1));
    return `<div class="head"><h2>은행, ATM</h2><span class="quiet">${list.length}곳${state.userPos ? ", 가까운 순" : ""}</span></div>
      <div class="brands-sum">${Object.entries(count).map(([bk, n]) => `<span class="bsum">${brandBadge(bk, true)}${esc(bk)} <b>${n}</b></span>`).join("")}</div>
      <ul class="stores">${list.map((x) => `<li class="tap" data-act="select" data-id="${esc(x.b.id)}">
          ${brandBadge(x.bank)}
          <div class="store-txt">
            <p><b>${esc(x.bank)} ${esc(x.kind)}</b></p>
            <small>${esc([x.b.name, x.floor].filter(Boolean).join(" "))}</small>
          </div>
          <div class="store-side"><span class="quiet">${walk(x.b)}</span></div>
        </li>`).join("")}</ul>
      <p class="src">바뀐 곳이 있으면 알려주세요. <button class="link" data-act="report">제보하기</button></p>`;
  }

  /* ---------- 길찾기: 출발, 도착 ---------- */
  const routePoint = (id) => (id === "me" ? (state.userPos && { ...state.userPos, id: "me", name: "현재 위치" }) : buildingById(id));
  function routeOptions(slot) {
    const cur = state.route[slot];
    const me = `<option value="me" ${cur === "me" ? "selected" : ""}>현재 위치</option>`;
    return `<option value="" ${cur ? "" : "selected"} disabled>${slot === "from" ? "출발" : "도착"} 건물 고르기</option>${me}` +
      BUILDINGS.map((b) => `<option value="${esc(b.id)}" ${cur === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  }
  /** 차량 시간: 서버(/api/route → 네이버 실시간 교통). 받는 중이면 status "loading", 못 받으면 "fail" */
  const routeLive = {};
  function liveCar(a, b) {
    if (!Api.online) return null;
    const key = [a.lat, a.lng, b.lat, b.lng].map((x) => x.toFixed(5)).join(",");
    const hit = routeLive[key];
    if (hit && (hit.status === "loading" || Date.now() - hit.t < 180000)) return hit;
    routeLive[key] = { status: "loading", t: Date.now() };
    Api.get(`/api/route?from=${a.lat},${a.lng}&to=${b.lat},${b.lng}`)
      .then((r) => (routeLive[key] = { status: "ok", t: Date.now(), ...r }))
      .catch((e) => (routeLive[key] = { status: "fail", t: Date.now(), error: e.message }))
      .finally(() => state.view.kind === "route" && renderSheet());
    return routeLive[key];
  }

  /* 현재 위치: 고르면 위치를 찾고, 현재 위치에서 걸어갈 때는 몇 초마다 다시 찾아 안내를 갱신 */
  let routeLoc = "idle"; // idle | finding | fail | far
  function routeLocate() {
    routeLoc = "finding";
    renderSheet();
    locate(true, () => {
      routeLoc = "idle";
      if (state.view.kind === "route") { renderSheet(); showRouteLine(); }
    }, (why) => {
      routeLoc = why === "far" ? "far" : "fail";
      if (state.view.kind === "route") renderSheet();
    });
  }
  let routeWatch = null;
  function syncRouteWatch() {
    const want = state.view.kind === "nav" && state.route.from === "me" && state.route.to && state.userPos;
    if (want && !routeWatch) {
      routeWatch = setInterval(() => requestLocation(({ lat, lng }) => {
        if (state.view.kind !== "nav" || state.route.from !== "me") return;
        const pos = { lat, lng };
        if (U.distance(pos, CAMPUS_CENTER) > 3000 || (state.userPos && U.distance(pos, state.userPos) < 4)) return;
        state.userPos = pos;
        CampusMap.setUserLocation(pos);
        const keep = body.scrollTop;
        renderSheet();
        body.scrollTop = keep;
        showRouteLine(false);
        CampusMap.focus({ ...pos, id: "me" }, { bottomInset: Math.min(Sheet.visible(), window.innerHeight * 0.6) }); // 지도가 나를 따라감
      }, () => {}), 6000);
    } else if (!want && routeWatch) {
      clearInterval(routeWatch);
      routeWatch = null;
    }
  }

  /** 현재 위치에서 걸어갈 때 맨 위에 보이는 "다음 안내" */
  function nextGuide(w) {
    const turn = w.steps.find((st) => st.turn);
    const left = Math.round(w.meters / 10) * 10;
    let title;
    if (w.meters < 25) title = "거의 다 왔어요";
    else if (turn) title = `${Math.max(10, Math.round(turn.at / 10) * 10)}m 앞, ${turn.text}`;
    else title = `약 ${left}m 걸으면 도착해요`;
    const ic = STEP_IC[turn && w.meters >= 25 ? turn.turn : "walk"];
    return `<div class="r-next" role="status">
        <span class="r-next-ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${ic}"/></svg></span>
        <div><b>${esc(title)}</b><small>도착까지 ${left}m, 약 ${w.minutes}분</small></div>
        <span class="r-live">위치 따라 바뀌어요</span>
      </div>`;
  }

  /* ---------- 걷는 길 안내 화면 (도보 카드 → 예) ----------
   * 현재 위치에서 출발: 6초마다 위치를 다시 잡고 다음 안내를 바꿈, 지도가 나를 따라감
   * 건물에서 출발: 이전/다음으로 회전 지점을 하나씩 지도에서 보여줌 */
  function navAsk() {
    const a = routePoint(state.route.from), b = routePoint(state.route.to);
    const w = a && b && CampusWalk.route(a, b);
    if (!w) return;
    $("#navConfirmText").textContent = `${a.name}에서 ${b.name}까지 걸어서 약 ${w.minutes}분 (${Math.round(w.meters / 10) * 10}m)`;
    $("#navConfirm").returnValue = "";
    $("#navConfirm").showModal();
  }
  $("#navConfirm").addEventListener("close", () => {
    if ($("#navConfirm").returnValue === "ok") startNav();
  });
  function navStops(w) { return w.steps.filter((st, i) => i === 0 || st.turn || i === w.steps.length - 1); }
  function startNav() {
    state.view = { kind: "nav" };
    state.navStep = 0;
    renderSheet();
    renderCats();
    Sheet.st = "half";
    Sheet.set("half");
    showRouteLine(false);
    focusNavStep();
  }
  function endNav() {
    state.view = { kind: "route" };
    renderSheet();
    Sheet.set("half");
    showRouteLine();
  }
  function focusNavStep() {
    const a = routePoint(state.route.from), b = routePoint(state.route.to);
    const w = a && b && CampusWalk.route(a, b);
    if (!w) return;
    const live = a.id === "me";
    const stop = live ? { pos: a } : navStops(w)[state.navStep];
    if (stop?.pos) CampusMap.focus({ ...stop.pos, id: "nav" }, { bottomInset: Math.min(Sheet.visible(), window.innerHeight * 0.6) });
  }
  function viewNav() {
    const a = routePoint(state.route.from), b = routePoint(state.route.to);
    const w = a && b && CampusWalk.route(a, b);
    if (!w) { state.view = { kind: "route" }; return viewRoute(); }
    const live = a.id === "me";
    let card, ctrl = "";
    if (live) {
      card = nextGuide(w);
    } else {
      const stops = navStops(w);
      const i = Math.min(state.navStep, stops.length - 1);
      const st = stops[i];
      const kind = i === 0 ? "walk" : st.turn || "end";
      const ic = kind === "end"
        ? "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
        : STEP_IC[kind];
      const next = stops[i + 1];
      const gap = next ? Math.round((next.at - st.at) / 10) * 10 : 0;
      card = `<div class="r-next">
          <span class="r-next-ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${ic}"/></svg></span>
          <div><b>${esc(st.text)}</b><small>${next ? `그다음 약 ${Math.max(10, gap)}m 걷기` : "도착했어요"}</small></div>
        </div>`;
      ctrl = `<div class="nav-ctrl">
          <button data-act="nav-step" data-n="-1" ${i === 0 ? "disabled" : ""} aria-label="이전 안내">${ICON.back}</button>
          <span>${i + 1} / ${stops.length}</span>
          <button data-act="nav-step" data-n="1" class="flip" ${i === stops.length - 1 ? "disabled" : ""} aria-label="다음 안내">${ICON.back}</button>
        </div>`;
    }
    return `<div class="nav">
        <div class="nav-head"><div><b>${esc(b.name)}까지 걸어서 ${w.minutes}분</b><small>${esc(a.name)}에서 출발, ${Math.round(w.meters / 10) * 10}m</small></div>
          <button class="nav-end" data-act="nav-end">안내 종료</button></div>
        ${card}
        ${ctrl}
      </div>`;
  }

  /** 걷는 길 안내: 지나는 건물 + 단계별 안내 */
  const STEP_IC = {
    left: "M14 7l-5 5 5 5M9 12h6a4 4 0 0 1 4 4v4",
    right: "M10 7l5 5-5 5M15 12H9a4 4 0 0 0-4 4v4",
    back: "M9 14l-4-4 4-4M5 10h9a5 5 0 0 1 0 10h-3",
    walk: "M12 20V4M7 9l5-5 5 5",
  };
  function walkGuide(w) {
    const steps = w.steps.map((st, i) => {
      const kind = i === 0 ? "start" : i === w.steps.length - 1 ? "end" : st.turn || "walk";
      const ic = STEP_IC[kind] ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${STEP_IC[kind]}"/></svg>` : "";
      return `<li class="${kind}"><span class="r-step-ic">${ic}</span><span>${esc(st.text)}</span></li>`;
    }).join("");
    return `<section class="r-walk">
        <div class="head sec"><h3>걸어가는 길</h3><span class="quiet">${Math.round(w.meters / 10) * 10}m</span></div>
        ${w.via.length ? `<p class="r-via">${w.via.map((n) => `<span>${esc(n)}</span>`).join("")}<em>앞을 지나가요</em></p>` : ""}
        <ol class="r-steps">${steps}</ol>
        <p class="r-note">OpenStreetMap 길 기준이라 건물 사이 통로나 계단 같은 지름길은 빠져 있을 수 있어요.</p>
      </section>`;
  }

  function viewRoute() {
    const a = routePoint(state.route.from), b = routePoint(state.route.to);
    const empty = !a ? "from" : !b ? "to" : null;
    const meMissing = [state.route.from, state.route.to].includes("me") && !state.userPos;
    let result = "";
    if (meMissing) {
      const msg = routeLoc === "finding" ? "현재 위치를 찾는 중이에요"
        : routeLoc === "far" ? "지금 캠퍼스에서 멀리 있어서 현재 위치로 안내할 수 없어요. 출발 건물을 골라 주세요."
        : "현재 위치를 찾지 못했어요. 위치 권한을 허용했는지 확인해 주세요.";
      result = `<div class="r-hint">${msg}${routeLoc === "finding" ? "" : `<button class="link r-retry" data-act="route-locate">다시 찾기</button>`}</div>`;
    } else if (a && b && a.id === b.id) {
      result = `<div class="r-hint">출발과 도착이 같은 건물이에요.</div>`;
    } else if (a && b) {
      const r = U.routeEstimate(a, b);
      const walk = CampusWalk.route(a, b); // 캠퍼스 길을 따라 계산 (없으면 직선거리 예상)
      if (walk) { r.walkMin = walk.minutes; r.walkM = walk.meters; }
      const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 10) * 10}m`);
      const live = liveCar(a, b);
      const ok = live?.status === "ok";
      const carMin = ok ? live.carMin : r.carMin;
      r.walkFaster = r.walkMin <= carMin;
      const carValue = live?.status === "loading" ? `<b class="r-wait">···</b>` : `<b>${carMin}<small>분</small></b>`;
      const carSub = ok ? `약 ${km(live.distanceM)}` : live?.status === "loading" ? "교통 정보 확인 중" : `약 ${km(r.carM)}`;
      const carSrc = ok ? `<span class="r-src live">네이버 실시간 교통</span>` : live?.status === "loading" ? "" : `<span class="r-src">예상, 교통 미반영</span>`;
      result = `<div class="r-modes">
          <button class="r-mode r-walk-btn ${r.walkFaster ? "best" : ""}" data-act="nav-ask"${walk ? "" : " disabled"}>
            <span class="r-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="M10 21l2-6 3 3v3M9 12l2-4 4 1 2 4M8 9l-2 4"/></svg></span>
            <span class="r-lbl">도보</span><b>${r.walkMin}<small>분</small></b><span class="r-dist">약 ${km(r.walkM)}</span>
            ${walk ? `<span class="r-start">눌러서 길 안내</span>` : ""}
            ${r.walkFaster ? `<span class="r-best">더 빨라요</span>` : ""}
          </button>
          <div class="r-mode ${r.walkFaster ? "" : "best"}">
            <span class="r-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M4 17v-5l2-5h12l2 5v5M4 12h16"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg></span>
            <span class="r-lbl">차량</span>${carValue}<span class="r-dist">${carSub}</span>${carSrc}
            ${r.walkFaster ? "" : `<span class="r-best">더 빨라요</span>`}
          </div>
        </div>
        <p class="r-note">${ok
          ? "차량은 네이버 지도 실시간 교통(빠른 길) 기준이고 주차 시간은 빠져 있어요."
          : `차량은 ${Api.online && live?.status === "fail" ? "네이버 교통 정보를 받지 못해서 " : ""}직선거리로 계산한 예상이에요.`}
          ${walk ? "도보는 캠퍼스 길을 따라 계산했어요." : "도보는 직선거리로 계산한 예상이에요."}</p>
        ${walk ? walkGuide(walk) : a.id === "me" ? `<div class="r-hint">현재 위치가 캠퍼스 길에서 멀어서 걷는 길 안내는 할 수 없어요.</div>` : ""}`;

    } else {
      result = `<div class="r-hint">${empty === "from" ? "출발" : "도착"}할 건물을 지도에서 누르거나 위에서 골라 주세요.</div>`;
    }
    return `<div class="head route-head"><h2>길찾기</h2><button class="x" data-act="route-close" aria-label="길찾기 닫기">${ICON.x}</button></div>
      <div class="r-box">
        <div class="r-pins" aria-hidden="true"><i class="from"></i><span></span><i class="to"></i></div>
        <div class="r-fields">
          <label class="r-field ${empty === "from" ? "want" : ""}"><span class="sr">출발</span><select data-route="from">${routeOptions("from")}</select></label>
          <label class="r-field ${empty === "to" ? "want" : ""}"><span class="sr">도착</span><select data-route="to">${routeOptions("to")}</select></label>
        </div>
        <button class="r-swap" data-act="route-swap" aria-label="출발과 도착 바꾸기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/></svg></button>
      </div>
      ${result}`;
  }
  function showRouteLine(move = true) {
    const a = routePoint(state.route.from), b = routePoint(state.route.to);
    if (a && b && a.id !== b.id) {
      const walk = CampusWalk.route(a, b);
      CampusMap.showDistanceLines(a, [{ building: b, label: `도보 ${walk ? walk.minutes : U.routeEstimate(a, b).walkMin}분`, path: walk?.points }]);
      // 현재 위치에서 출발하면 내 위치를, 아니면 도착 건물을 화면에
      const center = a.id === "me" ? { ...a } : b.id !== "me" ? b : null;
      if (move && center) CampusMap.focus(center, { bottomInset: Math.min(Sheet.visible(), window.innerHeight * 0.6) });
    } else {
      CampusMap.showDistanceLines(null, []);
    }
  }
  function openRoute(from, to) {
    if (state.view.kind !== "route") state.prevView = ["home", "list"].includes(state.view.kind) ? state.view : state.prevView;
    if (from !== undefined) state.route.from = from;
    if (to !== undefined) state.route.to = to;
    CampusMap.clearSelection();
    state.view = { kind: "route" };
    if ([state.route.from, state.route.to].includes("me") && !state.userPos) routeLocate();
    renderSheet();
    renderCats();
    Sheet.st = "half";
    Sheet.set("half");
    showRouteLine();
  }
  function closeRoute() {
    state.route = { from: null, to: null };
    CampusMap.showDistanceLines(null, []);
    state.view = state.prevView || { kind: "home" };
    state.prevView = null;
    showCafeLines();
    renderSheet();
    renderCats();
  }
  /** 지도에서 건물을 눌렀을 때: 길찾기 중이면 빈 칸을 채우고, 아니면 건물 요약 */
  function onMarker(b) {
    if (state.view.kind === "nav") return; // 안내 중에는 건물을 눌러도 안내 유지
    if (state.view.kind !== "route") return selectBuilding(b);
    if (!state.route.from) state.route.from = b.id;
    else state.route.to = b.id;
    renderSheet();
    showRouteLine();
  }

  /* ---------- 건물 요약 (마커를 누르면) ---------- */
  /** "지하 1층" → -1, "3층" → 3 */
  const floorNum = (s) => { const n = parseInt(String(s).replace(/[^0-9]/g, ""), 10) || 1; return /지하|B/i.test(s) ? -n : n; };
  const floorTag = (n) => (n < 0 ? `B${-n}` : `${n}F`);
  /** 위층부터 아래층까지. 정보 없는 층이 이어지면 "2–5F" 처럼 묶는다 */
  function floorStack(b) {
    const known = new Map((b.floors || []).map((f) => [floorNum(f.floor), f]));
    const nums = [...known.keys()];
    const top = Math.max(b.levels?.[0] || 1, ...nums), bottom = Math.min(-(b.levels?.[1] || 0) || 1, ...nums);
    const out = [];
    for (let n = top; n >= bottom; n--) {
      if (n === 0) continue;
      const f = known.get(n);
      const last = out[out.length - 1];
      if (!f && b.levels && last && !last.f) { last.lo = n; continue; }
      if (!f && !b.levels) continue;
      out.push({ hi: n, lo: n, f });
    }
    return out;
  }
  function viewSummary(b) {
    const sub = [b.levels ? `지상 ${b.levels[0]}층${b.levels[1] ? `, 지하 ${b.levels[1]}층` : ""}` : (BUILDING_TYPES[b.type] || [])[1],
      b.elevator === false ? "엘리베이터 없음" : b.elevator ? "엘리베이터 있음" : ""].filter(Boolean);
    const rows = floorStack(b);
    const stack = rows.map((r, i) => {
      const tag = r.hi === r.lo ? floorTag(r.hi) : `${floorTag(r.lo)}–${floorTag(r.hi)}`.replace(/^(\d+)F–/, "$1–");
      const names = r.f ? [...new Set([...(r.f.places || []), ...r.f.facilities.map((t) => FACILITY_TYPES[t] || t)])] : [];
      const next = rows[i + 1];
      const line = next ? `<i class="fline${r.f && next.f ? " on" : ""}"></i>` : "";
      return `<li class="${r.f ? "" : "none"}">${line}<span class="ftag">${tag}</span>
        <div class="fchips">${names.length ? names.map((x) => `<span>${esc(x)}</span>`).join("") : `<em>등록된 정보 없음</em>`}</div></li>`;
    }).join("");
    return `<div class="bcard">
      <div class="bhead"><h2><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1E5FD8" stroke-width="2" stroke-linejoin="round"><path d="M4 21V4h9v17M13 9h7v12M2 21h20M7 8h3M7 12h3M7 16h3M16 13h1M16 17h1"/></svg>${esc(b.name)}</h2>
        <button class="x" data-act="close" aria-label="닫기">${ICON.x}</button></div>
      ${sub.length ? `<p class="bsub">${sub.map(esc).join('<i class="dot"></i>')}</p>` : ""}
      <div class="rbtns">
        <button data-act="route-set" data-slot="from" data-id="${esc(b.id)}"><i class="from"></i>여기서 출발</button>
        <button data-act="route-set" data-slot="to" data-id="${esc(b.id)}" class="to"><i class="to"></i>여기로 도착</button>
      </div>
      <ul class="fstack">${stack || `<li class="none"><span class="ftag">-</span><div class="fchips"><em>등록된 정보 없음</em></div></li>`}</ul>
      <button class="bbtn" data-act="report" data-id="${esc(b.id)}" data-kind="edit">이 건물 정보 수정 제보</button>
    </div>`;
  }

  /* ---------- 건물 페이지 (시트를 끝까지 올리면) ---------- */
  function viewPage(b) {
    const cafes = cafesOf(b);
    const losts = state.lostItems.filter((i) => i.buildingId === b.id);
    const tabs = [["home", "홈"], ["floors", "층별 시설"], ...(cafes.length ? [["food", "학식"]] : []), ["rating", "평가"], ["lost", "분실물"]];
    if (!tabs.some(([k]) => k === state.pageTab)) state.pageTab = "home";
    const floors = b.floors || [];
    let inner = "";
    if (state.pageTab === "home") {
      const reports = state.reports.filter((r) => r.buildingId === b.id).slice().reverse();
      inner = `${b.crowd ? `<ul class="facts flat"><li><span class="live warm">지금 ${esc(b.crowd.label)}</span><span class="quiet">${b.crowd.minutesAgo}분 전, ${b.crowd.confirms}명이 확인</span></li></ul>
          <div class="acts small"><button class="btn" data-act="crowd" data-v="yes">맞아요</button><button class="btn" data-act="crowd" data-v="no">아니에요, 한산해요</button></div>`
        : `<div class="acts small"><button class="btn" data-act="crowd" data-v="busy">지금 붐벼요</button><button class="btn" data-act="crowd" data-v="calm">지금 한산해요</button></div>`}
        <p class="sub">층마다 있는 것</p>
        <ul class="facts">${floors.map((f) => `<li><span>${esc(f.floor)}</span><span class="muted">${f.facilities.map((t) => FACILITY_TYPES[t] || t).join(", ")}${f.note ? `, ${esc(f.note)}` : ""}</span></li>`).join("") || `<li class="quiet">아직 등록된 층 정보가 없어요</li>`}</ul>
        ${reports.length ? `<p class="sub">이 건물에 올라온 제보</p><ul class="rows">${reports.map((r) => `<li class="row"><div><p>${esc(r.content)}</p><small>${esc(r.floor || "")} ${esc(korDate(r.date))}, ${REPORT_STATUS[r.status] || "검토 대기"}</small></div></li>`).join("")}</ul>` : ""}`;
    } else if (state.pageTab === "floors") {
      const i = Math.min(state.floorIdx, Math.max(0, floors.length - 1));
      const f = floors[i];
      inner = floors.length ? `<div class="opts">${floors.map((x, k) => `<button data-act="floor" data-f="${k}" class="${k === i ? "on" : ""}">${esc(x.floor)}</button>`).join("")}</div>
        <ul class="facts">${f.facilities.map((t) => {
          const issue = (b.issues || []).find((x) => x.facility === t && x.floor === f.floor);
          return `<li><span>${FACILITY_TYPES[t] || esc(t)}</span>${issue ? `<span class="issue">고장 신고 ${issue.count}건</span>` : `<span class="quiet">문제 신고 없음</span>`}</li>
            ${issue ? `<li class="note">${issue.minutesAgo}분 전에 마지막으로 신고됐어요.</li>` : ""}`;
        }).join("")}</ul>
        ${f.note ? `<p class="quiet">${esc(f.note)}</p>` : ""}
        <div class="acts small"><button class="btn" data-act="report" data-id="${esc(b.id)}" data-floor="${esc(f.floor)}" data-kind="edit">고장이나 문제 알리기</button></div>`
        : `<div class="empty">아직 등록된 층 정보가 없어요</div>`;
    } else if (state.pageTab === "food") {
      inner = dayMealChips() + cafes.map((c) => cafeBlock(c, true)).join("");
    } else if (state.pageTab === "rating") {
      const r = b.rating;
      inner = r ? `<div class="score"><b>${r.score.toFixed(1)}</b><ul>${r.parts.map(([k, v]) => `<li><span>${esc(k)}</span><b>${v.toFixed(1)}</b></li>`).join("")}</ul></div>
          <ul class="rows">${r.reviews.map(([when, text]) => `<li class="row"><div><small>${esc(when)}</small><p>${esc(text)}</p></div></li>`).join("")}</ul>`
        : `<div class="empty">아직 평가가 없어요</div>`;
    } else if (state.pageTab === "lost") {
      inner = `${losts.length ? `<ul class="rows">${losts.map(lostRow).join("")}</ul>` : `<div class="empty">이 건물에 올라온 분실물이 없어요</div>`}
        <div class="acts small"><button class="btn" data-act="lost-add" data-id="${esc(b.id)}">분실물 올리기</button></div>`;
    }
    return `<div class="pagehead"><button class="back" data-act="back" aria-label="뒤로">${ICON.back}</button><h2>${esc(b.name)}</h2><span class="quiet">${walk(b)}</span></div>
      <nav class="ptabs">${tabs.map(([k, l]) => `<button data-act="page-tab" data-p="${k}" class="${state.pageTab === k ? "on" : ""}">${l}</button>`).join("")}</nav>
      <div class="pagebody">${inner}</div>`;
  }

  function renderSheet() {
    const v = state.view;
    const b = v.id && buildingById(v.id);
    const html = v.kind === "nav" ? viewNav() : v.kind === "route" ? viewRoute() : v.kind === "list" ? viewList() : v.kind === "summary" && b ? viewSummary(b) : v.kind === "page" && b ? viewPage(b) : viewHome();
    body.innerHTML = `<div class="sheet-inner">${html}</div>`;
    sheet.dataset.view = v.kind;
    syncRouteWatch();
    $("#fixReport").hidden = v.kind !== "page";
  }

  function render() {
    renderSheet();
    renderCats();
    sheet.style.transform = `translateY(${Sheet.pos(Sheet.st)}px)`;
    placeFabs();
  }

  /* ============================================================
   *  분류 (위쪽 칩)
   * ============================================================ */
  const CAT_ICON = {
    food: ["#FF7A2F", "M7 2v8a2 2 0 0 0 2 2v10h2V12a2 2 0 0 0 2-2V2h-1.5v6h-1V2h-1v6h-1V2zM16 2c-1.7 0-3 2-3 5v5h2v10h2V2z"],
    printer: ["#4A7DFF", "M6 2h12v6H6zM4 9h16a2 2 0 0 1 2 2v6h-4v5H6v-5H2v-6a2 2 0 0 1 2-2zm4 8v3h8v-3z"],
    convenience: ["#03C75A", "M3 9l2-5h14l2 5v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13h14v8H5z"],
    cafe: ["#A0612B", "M4 6h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 8h2a2 2 0 0 1 0 4h-2zM4 19h14v2H4z"],
    atm: ["#475569", "M2 5h20v14H2zm2 4v2h16V9zm2 6v2h5v-2z"],
    lounge: ["#8B5CF6", "M4 10a2 2 0 0 1 2 2v3h12v-3a2 2 0 1 1 4 0v7h-2v-2H4v2H2v-7a2 2 0 0 1 2-2zm3-5h10a2 2 0 0 1 2 2v3a3 3 0 0 0-2 2v1H7v-1a3 3 0 0 0-2-2V7a2 2 0 0 1 2-2z"],
    restroom: ["#0EA5E9", "M7 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm10 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5 8h4l1 7H9v7H5v-7H4zm10 0h4l2 9h-3v5h-4v-5h-3z"],
    water: ["#06B6D4", "M12 2s7 7.6 7 12a7 7 0 0 1-14 0c0-4.4 7-12 7-12z"],
    lost: ["#8B5CF6", "M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"],
  };
  const HIDDEN_CATS = new Set(["restroom"]); // 위쪽 분류 버튼에서 뺀 것
  const CATS = () => [["all", "전체"], ["route", "길찾기"], ["food", "학식"], ...Object.entries(FACILITY_TYPES).filter(([k]) => !HIDDEN_CATS.has(k)), ["lost", "분실물"]];
  function renderCats() {
    $("#cats").innerHTML = CATS().map(([k, label]) => {
      const ic = CAT_ICON[k];
      if (k === "route") {
        return `<button data-cat="route" class="cat-route ${["route", "nav"].includes(state.view.kind) ? "on" : ""}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20v-6a4 4 0 0 1 4-4h8M15 6l4 4-4 4"/></svg>${label}</button>`;
      }
      return `<button data-cat="${k}" class="${state.cat === k && !["route", "nav"].includes(state.view.kind) ? "on" : ""}">${ic ? `<svg width="15" height="15" viewBox="0 0 24 24"><path d="${ic[1]}" fill="${ic[0]}" fill-rule="evenodd"/></svg>` : ""}${label}</button>`;
    }).join("");
  }
  $("#cats").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    if (btn.dataset.cat === "route") {
      if (["route", "nav"].includes(state.view.kind)) return closeRoute();
      // 길찾기 버튼: 현재 위치에서 출발 (도착은 지도에서 누르거나 골라서)
      state.route = { from: "me", to: state.route.to || null };
      return openRoute();
    }
    setCategory(btn.dataset.cat);
  });

  function setCategory(cat) {
    state.cat = cat;
    state.query = "";
    $("#searchInput").value = "";
    CampusMap.clearSelection();
    if (cat === "all") {
      CampusMap.setDimmed(null);
      CampusMap.showDistanceLines(state.userPos, []);
      state.view = { kind: "home" };
    } else {
      const ids = cat === "lost" ? state.lostItems.map((i) => i.buildingId)
        : cat === "convenience" ? [...new Set([...matchBuildings().map((b) => b.id), ...CONVENIENCE_STORES.map((x) => x.buildingId)])]
        : cat === "atm" ? [...new Set(ATMS.map((x) => x.buildingId))]
        : matchBuildings().map((b) => b.id);
      CampusMap.setDimmed(ids);
      showCafeLines();
      state.view = { kind: "list" };
    }
    renderSheet();
    renderCats();
    Sheet.set("half");
  }

  function showCafeLines() {
    const on = state.cat === "food" && state.userPos;
    CampusMap.showDistanceLines(state.userPos, on ? CAFETERIAS.map((c) => {
      const b = buildingById(c.buildingId);
      return b && { building: b, label: `${c.name} ${U.formatDistance(U.distance(state.userPos, b))}` };
    }).filter(Boolean) : []);
  }

  /* ============================================================
   *  건물 고르기 (마커, 목록, 챗봇이 모두 이 함수 하나를 부름)
   * ============================================================ */
  function selectBuilding(b, opts = {}) {
    if (!b) return;
    if (state.view.kind === "home" || state.view.kind === "list") state.prevView = state.view;
    state.floorIdx = 0;
    if (opts.tab) {
      state.view = { kind: "page", id: b.id };
      state.pageTab = opts.tab;
      renderSheet();
      Sheet.st = "full";
      Sheet.set("full");
    } else {
      state.view = { kind: "summary", id: b.id };
      renderSheet();
      Sheet.st = "half";
      Sheet.set("half");
    }
    CampusMap.focus(b, { bottomInset: Math.min(Sheet.visible(), window.innerHeight * 0.6) });
  }

  function closeBuilding(sheetState) {
    CampusMap.clearSelection();
    state.view = state.prevView || { kind: "home" };
    state.prevView = null;
    renderSheet();
    Sheet.set(sheetState);
  }

  function onMapClick() {
    if (state.view.kind === "nav") return; // 안내 중에는 지도를 만져도 시트 그대로
    if (state.view.kind === "summary" || state.view.kind === "page") {
      closeBuilding("peek");
      return;
    }
    Sheet.set("peek");
  }

  /* -------------------- 시트 안 버튼들 -------------------- */
  const REPORT_STATUS = { pending: "검토 대기", done: "반영 완료", rejected: "반려" };

  body.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const d = el.dataset;
    const cur = state.view.id && buildingById(state.view.id);
    switch (d.act) {
      case "select": return selectBuilding(buildingById(d.id), { tab: d.tab });
      case "close": return closeBuilding(state.prevView?.kind === "list" ? "half" : "peek");
      case "open-page": return Sheet.set("full");
      case "back": return Sheet.set("half");
      case "home-tab": state.homeTab = d.t; state.homeAll = false; state.calDay = null; return renderSheet();
      case "home-all": state.homeAll = !state.homeAll; return renderSheet();
      case "cal-move": state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + Number(d.n), 1); state.calDay = null; return renderSheet();
      case "cal-day": state.calDay = state.calDay === d.d ? null : d.d; return renderSheet();
      case "page-tab": state.pageTab = d.p; state.floorIdx = 0; renderSheet(); body.scrollTop = 0; return;
      case "floor": state.floorIdx = Number(d.f); return renderSheet();
      case "cafe-cal": state.cafeCalOpen = !state.cafeCalOpen; state.cafeCalMonth = parseYmd(state.cafeDate); return renderSheet();
      case "cafe-cal-move": { const m = state.cafeCalMonth || parseYmd(state.cafeDate); state.cafeCalMonth = new Date(m.getFullYear(), m.getMonth() + Number(d.n), 1); return renderSheet(); }
      case "cafe-pick": state.cafeDate = d.d; state.cafeCalOpen = false; return renderSheet();
      case "cafe-step": state.cafeDate = stepWeekday(state.cafeDate, Number(d.n)); state.cafeCalOpen = false; return renderSheet();
      case "route-set": {
        const other = d.slot === "from" ? "to" : "from";
        if (state.route[other] === d.id) state.route[other] = null;
        if (d.slot === "to" && !state.route.from && state.userPos) state.route.from = "me";
        return openRoute(...(d.slot === "from" ? [d.id, undefined] : [undefined, d.id]));
      }
      case "route-swap": state.route = { from: state.route.to, to: state.route.from }; renderSheet(); return showRouteLine();
      case "route-close": return closeRoute();
      case "route-locate": return routeLocate();
      case "nav-ask": return navAsk();
      case "nav-end": return endNav();
      case "nav-step": state.navStep = Math.max(0, (state.navStep || 0) + Number(d.n)); renderSheet(); return focusNavStep();
      case "cafe-meal": state.meal = d.m; return renderSheet();
      case "lost-filter": state.lostFilter = d.f; return renderSheet();
      case "lost-add": return openLost(d.id);
      case "report": return openReport(d.id || cur?.id, { floor: d.floor, kind: d.kind });
      case "ask-chat": return openChat(state.query);
      case "vote": {
        state.votes[d.k] = state.votes[d.k] === d.v ? undefined : d.v;
        Local.save("votes", state.votes);
        return renderSheet();
      }
      case "crowd": return toast("알려줘서 고마워요. 다른 학생들한테 같이 보여요");
    }
  });
  $("#fixReport").addEventListener("click", () => openReport(state.view.id));
  body.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-route]");
    if (!sel) return;
    state.route[sel.dataset.route] = sel.value || null;
    if (sel.value === "me" && !state.userPos) return routeLocate();
    renderSheet();
    showRouteLine();
  });

  let toastTimer = null;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ============================================================
   *  내 위치
   *  - iOS 앱(WKWebView) 안에서는 네이티브 위치(CoreLocation) 브릿지를 사용
   *  - 브라우저에서는 navigator.geolocation 사용
   * ============================================================ */
  function requestLocation(onOk, onErr) {
    const native = window.webkit?.messageHandlers?.campusLocation;
    if (native) {
      window.__campusLocation = (lat, lng, accuracy, error) => (error ? onErr(error) : onOk({ lat, lng, accuracy }));
      native.postMessage("locate");
      return;
    }
    if (!navigator.geolocation) return onErr("unsupported");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => onOk({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      () => onErr("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function locate(silent, onDone, onFail) {
    requestLocation(
      ({ lat, lng }) => {
        const pos = { lat, lng };
        const far = U.distance(pos, CAMPUS_CENTER);
        if (far > 3000) {
          if (!silent) toast(`캠퍼스에서 ${U.formatDistance(far)} 떨어져 있어요`);
          if (onFail) onFail("far");
          return;
        }
        state.userPos = pos;
        CampusMap.setUserLocation(pos);
        showCafeLines();
        renderSheet();
        if (!silent) toast("지금 위치 기준으로 걸어서 몇 분인지 보여요");
        if (onDone) onDone();
      },
      () => { if (!silent) toast("위치 권한이 없거나 위치를 찾지 못했어요"); if (onFail) onFail("denied"); }
    );
  }
  $("#locateBtn").addEventListener("click", () => locate(false));

  /* ============================================================
   *  모달 (분실물 / 제보)
   * ============================================================ */
  function openLost(buildingId) {
    if (buildingId) $("#lostForm").buildingId.value = buildingId;
    $("#lostModal").returnValue = "";
    $("#lostModal").showModal();
  }
  $("#lostModal").addEventListener("close", async () => {
    const form = $("#lostForm");
    if ($("#lostModal").returnValue === "ok") {
      const data = Object.fromEntries(new FormData(form));
      try {
        if (Api.online) {
          await Api.post("/api/lost", data);
          state.lostItems = await Api.get("/api/lost");
        } else {
          state.lostItems.push({ id: `l${Date.now()}`, date: today(), ...data });
          Local.save("lostItems", state.lostItems);
        }
        toast("분실물을 올렸어요");
      } catch (e) { alert(e.message); }
      renderSheet();
    }
    form.reset();
  });

  function openReport(buildingId, { floor, kind } = {}) {
    const form = $("#reportForm");
    if (buildingId) form.buildingId.value = buildingId;
    if (floor) form.floor.value = floor;
    if (kind) form.kind.value = kind;
    $("#reportModal").returnValue = "";
    $("#reportModal").showModal();
  }
  $("#reportModal").addEventListener("close", async () => {
    const form = $("#reportForm");
    if ($("#reportModal").returnValue === "ok") {
      const data = Object.fromEntries(new FormData(form));
      try {
        if (Api.online) {
          await Api.post("/api/reports", data);
          state.reports = await Api.get("/api/reports");
        } else {
          state.reports.push({ id: `r${Date.now()}`, date: today(), status: "pending", ...data });
          Local.save("reports", state.reports);
        }
        toast("제보를 보냈어요. 운영자가 확인하면 반영돼요");
      } catch (e) { alert(e.message); }
      renderSheet();
    }
    form.reset();
  });

  /* -------------------- 검색 --------------------
   * 지금은 건물·시설·분실물을 글자로 찾아 시트 목록에 보여준다.
   * AI 를 붙이면 여기서 q 를 CampusBot.reply(q, ctx)(js/chatbot.js)로 넘기면 된다.
   * 답에 buildingId 가 오면 selectBuilding(buildingById(id)) 로 지도에서 그 건물을 고를 수 있다. */
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#searchInput").value.trim();
    $("#searchInput").blur();
    if (!q) return setCategory("all");
    state.cat = "all";
    state.query = q;
    CampusMap.clearSelection();
    CampusMap.setDimmed([...matchBuildings().map((b) => b.id), ...matchLost().map((i) => i.buildingId)]);
    state.view = { kind: "list" };
    renderSheet();
    renderCats();
    Sheet.set("half");
  });

  /* -------------------- 챗봇 --------------------
   * 답변 만들기와 카드 그리기는 js/chatbot.js, 여기서는 화면 흐름만.
   * 대화는 이 기기에 30개까지 저장돼요 (새 대화 버튼으로 지움). */
  const chatLog = $("#chatLog");
  const chatInput = $("#chatInput");
  let chatHistory = Local.load("chatHistory", []);
  const chatCtx = () => ({
    userPos: state.userPos,
    lostItems: state.lostItems,
    currentBuildingId: ["summary", "page"].includes(state.view.kind) ? state.view.id : null,
  });
  const squashText = (s) => String(s).replace(/[\s?!.]/g, "");
  const clock = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

  function chatBubble(m) {
    const div = document.createElement("div");
    div.className = `cm ${m.role}`;
    div.innerHTML = m.role === "user"
      ? `<div class="cb">${esc(m.text)}</div><time>${clock(m.t)}</time>`
      : `<span class="cm-av" aria-hidden="true"></span><div class="cm-body">${CampusBot.renderReply(m.res)}<time>${clock(m.t)}</time></div>`;
    return div;
  }

  function setChips(list) {
    $("#chatSuggest").innerHTML = (list || []).map((q) => `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("");
    $("#chatSuggest").hidden = !list?.length;
  }

  function renderChat() {
    chatLog.innerHTML = CampusBot.renderWelcome(CampusBot.welcome(chatCtx()));
    chatHistory.forEach((m) => chatLog.appendChild(chatBubble(m)));
    const last = [...chatHistory].reverse().find((m) => m.role === "bot");
    setChips(last ? last.res.chips : null);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function pushChat(m) {
    chatHistory.push(m);
    chatHistory = chatHistory.slice(-30);
    Local.save("chatHistory", chatHistory);
    const el = chatBubble(m);
    el.classList.add("in");
    chatLog.appendChild(el);
    if (m.role === "bot") el.scrollIntoView({ block: "start", behavior: "smooth" });
    else chatLog.scrollTop = chatLog.scrollHeight;
  }

  let chatBusy = false;
  async function sendChat(text) {
    text = String(text || "").trim();
    if (!text || chatBusy) return;
    chatBusy = true;
    pushChat({ role: "user", text, t: Date.now() });
    setChips(null);
    const typing = document.createElement("div");
    typing.className = "cm bot typing";
    typing.innerHTML = `<span class="cm-av" aria-hidden="true"></span><div class="cb" aria-label="답변 쓰는 중"><i></i><i></i><i></i></div>`;
    chatLog.appendChild(typing);
    chatLog.scrollTop = chatLog.scrollHeight;
    let res;
    try {
      [res] = await Promise.all([CampusBot.reply(text, chatCtx()), new Promise((r) => setTimeout(r, 420))]);
    } catch {
      res = { text: "답을 가져오지 못했어요. 인터넷 연결을 확인하고 다시 보내 주세요.", chips: [text] };
    }
    typing.remove();
    if (res.chips) res.chips = res.chips.filter((c) => squashText(c) !== squashText(text));
    pushChat({ role: "bot", res, t: Date.now() });
    setChips(res.chips);
    chatBusy = false;
  }

  const isChatOpen = () => !$("#chatPanel").classList.contains("hidden");
  function closeChat() {
    $("#chatPanel").classList.add("hidden");
    $("#chatFab").setAttribute("aria-expanded", "false");
  }
  function openChat(question) {
    $("#chatPanel").classList.remove("hidden");
    $("#chatFab").setAttribute("aria-expanded", "true");
    renderChat();
    if (question) sendChat(question);
    else if (isDesktop()) chatInput.focus();
  }

  // 카드, 칩, 첫 화면 버튼 누르기
  $("#chatPanel").addEventListener("click", (e) => {
    const el = e.target.closest("[data-ask],[data-go],[data-locate],[data-report],[data-route-to],[data-more]");
    if (!el) return;
    if (el.dataset.more) {
      el.closest(".cc").classList.add("expanded");
      return el.remove();
    }
    if (el.dataset.ask) return sendChat(el.dataset.ask);
    if (el.dataset.go) {
      const b = buildingById(el.dataset.go);
      if (!b) return;
      selectBuilding(b);
      if (!isDesktop()) closeChat();
      return;
    }
    if (el.dataset.locate) {
      const lastAsk = [...chatHistory].reverse().find((m) => m.role === "user")?.text;
      return locate(false, () => lastAsk && sendChat(lastAsk));
    }
    if (el.dataset.report) return openReport(chatCtx().currentBuildingId);
    if (el.dataset.routeTo) {
      state.route = { from: el.dataset.routeFrom || null, to: el.dataset.routeTo };
      if (!isDesktop()) closeChat();
      return openRoute();
    }
  });

  $("#chatFab").addEventListener("click", () => (isChatOpen() ? closeChat() : openChat()));
  $("#chatClose").addEventListener("click", closeChat);
  $("#chatReset").addEventListener("click", () => {
    chatHistory = [];
    Local.save("chatHistory", chatHistory);
    renderChat();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isChatOpen() && !document.querySelector("dialog[open]")) closeChat();
  });

  const syncSend = () => ($("#chatSend").disabled = !chatInput.value.trim());
  chatInput.addEventListener("input", syncSend);
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value;
    chatInput.value = "";
    syncSend();
    sendChat(text);
  });
  syncSend();

  // 음성으로 묻기 (브라우저가 지원할 때만 버튼이 보임)
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Speech) {
    const mic = $("#chatMic");
    mic.hidden = false;
    let rec = null;
    mic.addEventListener("click", () => {
      if (rec) return rec.stop();
      rec = new Speech();
      rec.lang = "ko-KR";
      rec.interimResults = true;
      mic.classList.add("on");
      chatInput.placeholder = "듣고 있어요";
      rec.onresult = (ev) => {
        const r = ev.results[ev.results.length - 1];
        chatInput.value = r[0].transcript;
        syncSend();
        if (r.isFinal) { const t = chatInput.value; chatInput.value = ""; syncSend(); sendChat(t); }
      };
      rec.onerror = () => toast("음성을 알아듣지 못했어요. 마이크 권한을 확인해 주세요");
      rec.onend = () => { rec = null; mic.classList.remove("on"); chatInput.placeholder = "학식, 시설, 일정을 물어보세요"; };
      rec.start();
    });
  }

  /* ============================================================
   *  시작
   * ============================================================ */
  function fillBuildingSelects() {
    const opts = BUILDINGS.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join("");
    document.querySelectorAll(".building-select").forEach((sel) => (sel.innerHTML = opts));
  }

  async function start() {
    const insets = () => isDesktop()
      ? { top: 0, bottom: 0, left: sheet.getBoundingClientRect().right }
      : { top: $(".top").getBoundingClientRect().bottom + 4, bottom: Sheet.visible(), left: 0 };
    CampusMap.init("map", CAMPUS_CENTER, { logo: CAMPUS_LOGO, onMapClick, insets });

    if (await Api.init()) {
      try {
        await loadFromServer();
      } catch (e) {
        console.warn("서버 데이터 불러오기 실패, 예시 데이터로 표시합니다.", e);
      }
    }
    if (!Api.online) {
      state.lostItems = Local.load("lostItems", LOST_ITEMS);
      state.reports = Local.load("reports", REPORTS);
      state.weekStart = currentWeekStart();
      state.loadedDate = today();
    }
    state.votes = Local.load("votes", {});
    state.cafeDate = defaultCafeDate();

    fillBuildingSelects();
    render();
    Sheet.set("half"); // 앱을 켤 때마다 시트는 반쯤
    CampusMap.setMarkers(BUILDINGS, (b) => onMarker(b));
    locate(true);
    window.addEventListener("resize", () => Sheet.set(Sheet.st));

    // 메뉴 최신화: 5분마다 + 앱/탭으로 돌아올 때 (관리자 수정 / 날짜 변경 반영)
    if (Api.online) {
      setInterval(refreshMenus, 5 * 60 * 1000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshMenus());
    }
  }

  start();
})();
