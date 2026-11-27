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
    cafeDay: 1,
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
  const dayDate = (day) => {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() + day - 1);
    return d;
  };

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
      state.cafeDay = [0, 6].includes(todayIdx()) ? 1 : todayIdx();
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
  const isDesktop = () => window.matchMedia("(min-width: 769px)").matches;
  const Sheet = {
    st: "half",
    H: () => sheet.offsetHeight,
    pos(s) {
      const H = this.H();
      if (s === "full") return 0;
      if (s === "peek") return H - (this.peekH() + safeBottom());
      if (state.view.kind === "summary") return Math.max(H * 0.35, H - ((body.firstElementChild?.offsetHeight || 0) + 40 + safeBottom()));
      return H * 0.5;
    },
    peekH: () => 96,
    set(s) {
      this.st = s;
      // 요약 <-> 건물 페이지는 높이를 바꾸면서 내용도 바꾼다
      if (state.view.kind === "summary" && s === "full") { state.view = { kind: "page", id: state.view.id }; state.pageTab = "home"; renderSheet(); body.scrollTop = 0; }
      else if (state.view.kind === "page" && s !== "full") { state.view = { kind: "summary", id: state.view.id }; renderSheet(); }
      sheet.dataset.state = s;
      if (isDesktop()) { sheet.style.transform = ""; placeFabs(); return; }
      sheet.style.transform = `translateY(${this.pos(s)}px)`;
      placeFabs();
      sheet.dataset.state = s;
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
      if (isDesktop()) return;
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

  function dayMealChips() {
    const days = [1, 2, 3, 4, 5].map((d) => {
      const dt = dayDate(d);
      const isToday = ymd(dt) === today();
      return `<button data-act="cafe-day" data-d="${d}" class="${state.cafeDay === d ? "on" : ""}">${U.DAY_NAMES[d]} ${dt.getMonth() + 1}/${dt.getDate()}${isToday ? " 오늘" : ""}</button>`;
    }).join("");
    const meals = [["lunch", "점심"], ["dinner", "저녁"]].map(([k, l]) => `<button data-act="cafe-meal" data-m="${k}" class="${state.meal === k ? "on" : ""}">${l}</button>`).join("");
    return `<div class="opts">${days}</div><div class="opts">${meals}</div>`;
  }
  const cafeBlock = (c, withVotes) => {
    const open = U.isOpenNow(c.hours);
    const menu = U.getMenu(c, state.cafeDay, state.meal);
    const b = buildingById(c.buildingId);
    const items = menu.length
      ? menu.map((m) => {
          const key = `${c.id}|${ymd(dayDate(state.cafeDay))}|${state.meal}|${m}`;
          const v = state.votes[key];
          return `<li class="menu"><span>${esc(m)}</span>${withVotes ? `<span class="vote">
            <button data-act="vote" data-k="${esc(key)}" data-v="up" class="${v === "up" ? "on up" : ""}">좋아요</button>
            <button data-act="vote" data-k="${esc(key)}" data-v="down" class="${v === "down" ? "on" : ""}">별로예요</button></span>` : ""}</li>`;
        }).join("")
      : `<li class="menu quiet">등록된 메뉴가 없어요</li>`;
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
      const names = r.f ? (r.f.places || r.f.facilities.map((t) => FACILITY_TYPES[t] || t)) : [];
      const next = rows[i + 1];
      const line = next ? `<i class="fline${r.f && next.f ? " on" : ""}"></i>` : "";
      return `<li class="${r.f ? "" : "none"}">${line}<span class="ftag">${tag}</span>
        <div class="fchips">${names.length ? names.map((x) => `<span>${esc(x)}</span>`).join("") : `<em>등록된 정보 없음</em>`}</div></li>`;
    }).join("");
    return `<div class="bcard">
      <div class="bhead"><h2><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1E5FD8" stroke-width="2" stroke-linejoin="round"><path d="M4 21V4h9v17M13 9h7v12M2 21h20M7 8h3M7 12h3M7 16h3M16 13h1M16 17h1"/></svg>${esc(b.name)}</h2>
        <button class="x" data-act="close" aria-label="닫기">${ICON.x}</button></div>
      ${sub.length ? `<p class="bsub">${sub.map(esc).join('<i class="dot"></i>')}</p>` : ""}
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
    const html = v.kind === "list" ? viewList() : v.kind === "summary" && b ? viewSummary(b) : v.kind === "page" && b ? viewPage(b) : viewHome();
    body.innerHTML = `<div class="sheet-inner">${html}</div>`;
    sheet.dataset.view = v.kind;
    $("#fixReport").hidden = v.kind !== "page";
  }

  function render() {
    renderSheet();
    renderCats();
    if (!isDesktop()) sheet.style.transform = `translateY(${Sheet.pos(Sheet.st)}px)`;
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
  const CATS = () => [["all", "전체"], ["food", "학식"], ...Object.entries(FACILITY_TYPES), ["lost", "분실물"]];
  function renderCats() {
    $("#cats").innerHTML = CATS().map(([k, label]) => {
      const ic = CAT_ICON[k];
      return `<button data-cat="${k}" class="${state.cat === k ? "on" : ""}">${ic ? `<svg width="15" height="15" viewBox="0 0 24 24"><path d="${ic[1]}" fill="${ic[0]}" fill-rule="evenodd"/></svg>` : ""}${label}</button>`;
    }).join("");
  }
  $("#cats").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
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
      const ids = cat === "lost" ? state.lostItems.map((i) => i.buildingId) : matchBuildings().map((b) => b.id);
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
      case "cafe-day": state.cafeDay = Number(d.d); return renderSheet();
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

  function locate(silent) {
    requestLocation(
      ({ lat, lng }) => {
        const pos = { lat, lng };
        const far = U.distance(pos, CAMPUS_CENTER);
        if (far > 3000) {
          if (!silent) toast(`캠퍼스에서 ${U.formatDistance(far)} 떨어져 있어요`);
          return;
        }
        state.userPos = pos;
        CampusMap.setUserLocation(pos);
        showCafeLines();
        renderSheet();
        if (!silent) toast("지금 위치 기준으로 걸어서 몇 분인지 보여요");
      },
      () => { if (!silent) toast("위치 권한이 없거나 위치를 찾지 못했어요"); }
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

  /* -------------------- 챗봇 -------------------- */
  function addChat(role, text, buildingId) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = esc(text);
    if (buildingId) {
      const btn = document.createElement("button");
      btn.className = "msg-link";
      btn.textContent = "지도에서 보기";
      btn.addEventListener("click", () => {
        selectBuilding(buildingById(buildingId));
        if (window.innerWidth <= 768) $("#chatPanel").classList.add("hidden");
      });
      div.appendChild(btn);
    }
    $("#chatLog").appendChild(div);
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
    return div;
  }

  async function sendChat(text) {
    if (!text.trim()) return;
    addChat("user", text);
    const typing = addChat("bot", "…");
    try {
      const res = await CampusBot.reply(text, { userPos: state.userPos, lostItems: state.lostItems });
      typing.remove();
      addChat("bot", res.text, res.buildingId);
    } catch {
      typing.remove();
      addChat("bot", "앗, 답변 중 오류가 났어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  $("#chatSuggest").innerHTML = CampusBot.SUGGESTIONS.map((q) => `<button class="chip">${esc(q)}</button>`).join("");
  $("#chatSuggest").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => sendChat(c.textContent)));

  let chatGreeted = false;
  function openChat(question) {
    $("#chatPanel").classList.remove("hidden");
    if (!chatGreeted) {
      chatGreeted = true;
      addChat("bot", "안녕하세요! 캠퍼스맵 챗봇이에요 🗺️\n오늘·내일 학식 메뉴, 가까운 식당, 편의시설 위치를 물어보세요.");
    }
    if (question) sendChat(question);
    else $("#chatInput").focus();
  }
  $("#chatFab").addEventListener("click", () => ($("#chatPanel").classList.contains("hidden") ? openChat() : $("#chatPanel").classList.add("hidden")));
  $("#chatClose").addEventListener("click", () => $("#chatPanel").classList.add("hidden"));
  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#chatInput").value;
    $("#chatInput").value = "";
    sendChat(text);
  });

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
    state.cafeDay = [0, 6].includes(todayIdx()) ? 1 : todayIdx();

    fillBuildingSelects();
    render();
    Sheet.set("half"); // 앱을 켤 때마다 시트는 반쯤
    CampusMap.setMarkers(BUILDINGS, (b) => selectBuilding(b));
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
