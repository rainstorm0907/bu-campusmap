/**
 * 화면(UI) 로직
 * - 지도 관련 작업은 모두 CampusMap(js/map.js)을 통해서만 합니다.
 * - 서버가 켜져 있으면 DB(관리자 앱에서 올린 실제 메뉴 등)를 사용하고,
 *   아니면 js/data.js 예시 데이터 + localStorage 로 동작합니다.
 */
(() => {
  const U = CampusUtil;
  const $ = (sel) => document.querySelector(sel);
  const buildingById = (id) => BUILDINGS.find((b) => b.id === id);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIdx = () => new Date().getDay();
  const replaceAll = (arr, items) => arr.splice(0, arr.length, ...items);

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
    facilityFilter: null,
    lostItems: [],
    reports: [],
    userPos: null,
    weekStart: null, // 학식 탭에 보여줄 주의 월요일
    cafeDay: 1,
    meal: U.currentMeal(),
    loadedDate: null, // 메뉴를 마지막으로 불러온 날짜 (자정 넘어가면 다시 불러옴)
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
    state.loadedDate = ymd(new Date());
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
    const dayChanged = state.loadedDate !== ymd(new Date());
    try {
      await loadWeekMenus();
    } catch { return; }
    if (dayChanged) {
      state.cafeDay = [0, 6].includes(todayIdx()) ? 1 : todayIdx();
      state.meal = U.currentMeal();
      renderDayMealChips();
    }
    renderCafeterias();
  }

  /* -------------------- 탭 -------------------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
  }
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      switchTab(t.dataset.tab);
      $("#sidebar").classList.remove("collapsed"); // 모바일: 탭 누르면 시트 펼치기
    })
  );
  $("#sidebarToggle").addEventListener("click", () => $("#sidebar").classList.toggle("collapsed"));

  /* -------------------- 편의시설 -------------------- */
  function renderFacilityFilters() {
    const wrap = $("#facilityFilters");
    const all = [["", "전체"], ...Object.entries(FACILITY_TYPES)];
    wrap.innerHTML = all
      .map(([k, label]) => `<button class="chip ${(state.facilityFilter || "") === k ? "active" : ""}" data-k="${k}">${label}</button>`)
      .join("");
    wrap.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => {
        state.facilityFilter = c.dataset.k || null;
        renderFacilityFilters();
        renderBuildings();
      })
    );
  }

  function renderBuildings(query = "") {
    const q = query.trim().toLowerCase();
    const f = state.facilityFilter;

    const list = BUILDINGS.filter((b) => {
      const types = b.floors.flatMap((fl) => fl.facilities);
      if (f && !types.includes(f)) return false;
      if (!q) return true;
      const text = [b.name, ...(b.aliases || []), ...b.floors.map((fl) => fl.note), ...types.map((t) => FACILITY_TYPES[t])].join(" ").toLowerCase();
      return text.includes(q);
    });

    $("#buildingList").innerHTML = list.length
      ? list.map((b) => {
          const floors = b.floors
            .filter((fl) => !f || fl.facilities.includes(f))
            .map((fl) => `${fl.floor}: ${fl.facilities.map((t) => FACILITY_TYPES[t] || t).join(", ")}`)
            .join(" · ");
          return `<li class="item" data-id="${esc(b.id)}"><h3>${esc(b.name)}</h3><p>${esc(floors)}</p></li>`;
        }).join("")
      : `<li class="empty">검색 결과가 없습니다</li>`;

    $("#buildingList").querySelectorAll(".item").forEach((li) =>
      li.addEventListener("click", () => selectBuilding(buildingById(li.dataset.id)))
    );

    CampusMap.setMarkers(list, selectBuilding);
  }

  /* -------------------- 학식 + 거리 -------------------- */
  function renderDayMealChips() {
    $("#dayChips").innerHTML = [1, 2, 3, 4, 5]
      .map((d) => {
        const dt = dayDate(d);
        const isToday = ymd(dt) === ymd(new Date());
        return `<button class="chip ${state.cafeDay === d ? "active" : ""}" data-d="${d}">${U.DAY_NAMES[d]} ${dt.getMonth() + 1}/${dt.getDate()}${isToday ? " 오늘" : ""}</button>`;
      })
      .join("");
    $("#mealChips").innerHTML = [["lunch", "☀️ 점심"], ["dinner", "🌙 저녁"]]
      .map(([k, l]) => `<button class="chip ${state.meal === k ? "active" : ""}" data-m="${k}">${l}</button>`)
      .join("");
    $("#dayChips").querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => { state.cafeDay = Number(c.dataset.d); renderDayMealChips(); renderCafeterias(); })
    );
    $("#mealChips").querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", () => { state.meal = c.dataset.m; renderDayMealChips(); renderCafeterias(); })
    );
  }

  function renderCafeterias() {
    const rows = CAFETERIAS.map((c) => {
      const b = buildingById(c.buildingId);
      return { c, b, m: state.userPos && b ? U.distance(state.userPos, b) : null };
    });
    if (state.userPos) rows.sort((x, y) => x.m - y.m);
    const maxM = Math.max(1, ...rows.map((r) => r.m || 0));

    $("#cafeteriaList").innerHTML = rows.map(({ c, b, m }, i) => {
      const open = U.isOpenNow(c.hours);
      const menu = U.getMenu(c, state.cafeDay, state.meal);
      const dist = m == null ? "" : `
        <div class="dist">
          <div class="dist-bar"><span style="width:${Math.max(6, (m / maxM) * 100)}%"></span></div>
          <b>${U.formatDistance(m)}</b> · 도보 ${U.walkMinutes(m)}분${i === 0 ? ' <span class="badge">가장 가까움</span>' : ""}
        </div>`;
      return `<li class="item" data-b="${esc(c.buildingId)}">
        <h3>${esc(c.name)} <span class="badge ${open ? "open" : "closed"}">${open ? "운영중" : "운영종료"}</span></h3>
        ${dist}
        <p>📍 ${esc(b?.name)} ${esc(c.floor || "")} · ${esc(c.price)}</p>
        <p>🕒 ${esc(c.hours)}</p>
        <p class="menu-line">🍚 ${menu.length ? esc(menu.join(", ")) : "등록된 메뉴 없음"}</p>
      </li>`;
    }).join("");

    $("#cafeteriaList").querySelectorAll(".item").forEach((li) =>
      li.addEventListener("click", () => selectBuilding(buildingById(li.dataset.b)))
    );

    CampusMap.showDistanceLines(
      state.userPos,
      state.userPos ? rows.filter((r) => r.b).map(({ c, b, m }) => ({ building: b, label: `${c.name} ${U.formatDistance(m)}` })) : []
    );
  }

  function setUserPos(pos, message) {
    state.userPos = pos;
    $("#locStatus").textContent = message;
    CampusMap.setUserLocation(pos);
    renderCafeterias();
  }

  $("#baseBuilding").addEventListener("change", (e) => {
    const b = buildingById(e.target.value);
    if (b) setUserPos({ lat: b.lat, lng: b.lng }, `📍 ${b.name} 기준 거리예요.`);
  });

  /**
   * 위치 요청
   * - iOS 앱(WKWebView) 안에서는 네이티브 위치(CoreLocation) 브릿지를 사용
   * - 브라우저에서는 navigator.geolocation 사용
   */
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

  $("#locateBtn").addEventListener("click", () => {
    $("#locStatus").textContent = "위치를 찾는 중...";
    requestLocation(
      ({ lat, lng, accuracy }) => {
        const pos = { lat, lng };
        const fromCenter = U.distance(pos, CAMPUS_CENTER);
        $("#baseBuilding").value = "";
        setUserPos(pos, fromCenter > 3000
          ? `⚠️ 캠퍼스에서 약 ${U.formatDistance(fromCenter)} 떨어져 있어요. 교내라면 건물을 직접 선택해 주세요.`
          : `📍 현재 위치 기준 거리예요. (정확도 ±${Math.round(accuracy)}m)`);
      },
      () => { $("#locStatus").textContent = "위치 권한이 거부됐거나 찾을 수 없어요. 건물을 선택해 주세요."; }
    );
  });

  /* -------------------- 분실물 -------------------- */
  function renderLost(query = "") {
    const type = $("#lostFilter").value;
    const q = query.trim().toLowerCase();
    const items = state.lostItems
      .filter((i) => type === "all" || i.type === type)
      .filter((i) => !q || `${i.title} ${i.place} ${i.desc}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    $("#lostList").innerHTML = items.length
      ? items.map((i) => `<li class="item" data-b="${esc(i.buildingId)}">
          <h3><span class="badge ${i.type === "lost" ? "lost" : ""}">${i.type === "lost" ? "분실" : "습득"}</span>${esc(i.title)}</h3>
          <p>📍 ${esc(buildingById(i.buildingId)?.name)} ${esc(i.place)}</p>
          ${i.desc ? `<p>${esc(i.desc)}</p>` : ""}
          <p>📞 ${esc(i.contact || "-")} · ${esc(i.date)}</p>
        </li>`).join("")
      : `<li class="empty">등록된 분실물이 없습니다</li>`;

    $("#lostList").querySelectorAll(".item").forEach((li) =>
      li.addEventListener("click", () => selectBuilding(buildingById(li.dataset.b)))
    );
  }
  $("#lostFilter").addEventListener("change", () => renderLost());

  /* -------------------- 제보 -------------------- */
  const REPORT_KIND = { new: "새 시설", edit: "정보 수정", menu: "학식", etc: "기타" };
  const REPORT_STATUS = { pending: "검토 대기", done: "반영 완료", rejected: "반려" };

  function renderReports() {
    $("#reportList").innerHTML = state.reports.length
      ? state.reports.slice().reverse().map((r) => `<li class="item">
          <h3><span class="badge">${REPORT_KIND[r.kind] || "기타"}</span>${esc(buildingById(r.buildingId)?.name)} ${esc(r.floor)}</h3>
          <p>${esc(r.content)}</p>
          <p>${esc(r.date)} · ${REPORT_STATUS[r.status] || "검토 대기"}</p>
        </li>`).join("")
      : `<li class="empty">아직 제보가 없습니다</li>`;
  }

  /* -------------------- 상세 카드 -------------------- */
  function selectBuilding(b) {
    if (!b) return;
    CampusMap.focus(b);

    const cafes = CAFETERIAS.filter((c) => c.buildingId === b.id);
    const losts = state.lostItems.filter((i) => i.buildingId === b.id);
    const dist = state.userPos ? U.distance(state.userPos, b) : null;

    $("#detailBody").innerHTML = `
      <h2>${esc(b.name)}</h2>
      ${dist != null ? `<p class="hint">📍 ${U.formatDistance(dist)} · 도보 ${U.walkMinutes(dist)}분</p>` : ""}
      ${b.floors.map((fl) => `<div class="floor"><strong>${esc(fl.floor)}</strong>
        ${fl.facilities.map((t) => `<span class="badge">${FACILITY_TYPES[t] || esc(t)}</span>`).join("")}
        ${fl.note ? `<p class="hint">${esc(fl.note)}</p>` : ""}</div>`).join("")}
      ${cafes.map((c) => {
        const menu = U.getMenu(c, todayIdx(), U.currentMeal());
        return `<div class="floor"><b>🍚 ${esc(c.name)}</b> <span class="hint">${esc(c.hours)}</span>
        <ul class="menu-list">${menu.length ? menu.map((m) => `<li>${esc(m)}</li>`).join("") : "<li>오늘 등록된 메뉴 없음</li>"}</ul></div>`;
      }).join("")}
      ${losts.length ? `<div class="floor"><b>🔎 분실물 ${losts.length}건</b></div>` : ""}
      <button class="primary-btn full" id="detailReport" style="margin-top:10px">이 건물 정보 수정 제보</button>
    `;
    $("#detailCard").classList.remove("hidden");
    $("#detailReport").addEventListener("click", () => openReport(b.id));
  }

  $("#detailClose").addEventListener("click", () => {
    $("#detailCard").classList.add("hidden");
    CampusMap.clearSelection();
  });

  /* -------------------- 모달 (분실물 / 제보) -------------------- */
  const today = () => ymd(new Date());

  $("#openLostBtn").addEventListener("click", () => { $("#lostModal").returnValue = ""; $("#lostModal").showModal(); });
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
      } catch (e) { alert(e.message); }
      renderLost();
    }
    form.reset();
  });

  function openReport(buildingId) {
    if (buildingId) $("#reportForm").buildingId.value = buildingId;
    $("#reportModal").returnValue = "";
    $("#reportModal").showModal();
  }
  $("#openReportBtn").addEventListener("click", () => openReport());
  $("#openReportBtn2").addEventListener("click", () => openReport());
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
      } catch (e) { alert(e.message); }
      renderReports();
      switchTab("report");
    }
    form.reset();
  });

  /* -------------------- 검색 -------------------- */
  function search() {
    const q = $("#searchInput").value;
    renderBuildings(q);
    renderLost(q);
    switchTab("facility");
  }
  $("#searchBtn").addEventListener("click", search);
  $("#searchInput").addEventListener("keydown", (e) => e.key === "Enter" && search());

  /* -------------------- 챗봇 -------------------- */
  function addChat(role, text, buildingId) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = esc(text);
    if (buildingId) {
      const btn = document.createElement("button");
      btn.className = "msg-link";
      btn.textContent = "🗺️ 지도에서 보기";
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
  $("#chatFab").addEventListener("click", () => {
    $("#chatPanel").classList.toggle("hidden");
    if (!chatGreeted) {
      chatGreeted = true;
      addChat("bot", "안녕하세요! 캠퍼스맵 챗봇이에요 🗺️\n오늘·내일 학식 메뉴, 가까운 식당, 편의시설 위치를 물어보세요.");
    }
    $("#chatInput").focus();
  });
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
    $("#baseBuilding").innerHTML = `<option value="">또는 지금 있는 건물 선택</option>${opts}`;
  }

  async function start() {
    CampusMap.init("map", CAMPUS_CENTER);

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
    state.cafeDay = [0, 6].includes(todayIdx()) ? 1 : todayIdx();

    fillBuildingSelects();
    renderFacilityFilters();
    renderBuildings();
    renderDayMealChips();
    renderCafeterias();
    renderLost();
    renderReports();

    // 메뉴 최신화: 5분마다 + 앱/탭으로 돌아올 때 (관리자 수정 / 날짜 변경 반영)
    if (Api.online) {
      setInterval(refreshMenus, 5 * 60 * 1000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshMenus());
    }
  }

  start();
})();
