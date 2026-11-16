/**
 * ============================================================
 *  지도 모듈 (CampusMap)
 * ============================================================
 *  app.js 는 아래 함수만 호출합니다. 함수 이름/인자만 유지하면
 *  내부 구현은 자유롭게 바꿔도 됩니다.
 *
 *    CampusMap.init(containerId, center, options)  지도 생성
 *        options: { logo: {lat,lng,name,src}, onMapClick(), insets() }
 *        insets(): 지도를 가리는 폭과 높이 { top, bottom, left } (px). 처음 보여줄 범위를 그 사이에 맞춤
 *    CampusMap.setMarkers(buildings, onClick)   건물 마커 표시 (기존 마커는 지움)
 *    CampusMap.setDimmed(ids)                   ids 에 없는 마커를 흐리게 (null 이면 모두 진하게)
 *    CampusMap.focus(building, { bottomInset }) 해당 건물로 이동 + 강조
 *        bottomInset: 화면 아래를 가리는 높이(px). 건물이 그 위쪽에 보이게 옮김
 *    CampusMap.clearSelection()                 강조 해제
 *    CampusMap.isReady()                        네이버 지도 사용 여부
 *    CampusMap.setUserLocation(pos)             내 위치 표시 ({lat,lng} 또는 null). 마커에 걸어서 몇 분이 붙음
 *    CampusMap.showDistanceLines(from, targets) 내 위치 → 식당 연결선 + 거리 라벨
 *        targets: [{ building, label }]  (빈 배열이면 선 지우기)
 *
 *  building 객체 형태: { id, name, lat, lng, type, ... }  (js/data.js 참고)
 *
 *  네이버 지도 키(js/config.js)가 없거나 인증이 실패하면 자동으로
 *  "임시 지도"로 바뀌어, 지도 없이도 나머지 기능이 동작합니다.
 * ============================================================
 */
const CampusMap = (() => {
  const U = CampusUtil;
  let container = null;
  let opts = {};
  let engine = null;            // NaverEngine 또는 Placeholder
  let buildings = [];
  let onMarkerClick = () => {};
  let selectedId = null;
  let dimmed = null;            // Set 또는 null
  let userPos = null;
  let lastLines = null;

  const hasNaver = () => typeof window.naver !== "undefined" && window.naver.maps && window.naver.maps.Map;

  /* -------------------- 마커 모양 (두 지도 공통) -------------------- */
  const GLYPH = {
    lecture: "M12 4L2 9l10 5 10-5zM6 11.5V15c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5l-6 3z",
    food: "M7 2v8a2 2 0 0 0 2 2v10h2V12a2 2 0 0 0 2-2V2h-1.5v6h-1V2h-1v6h-1V2zM16 2c-1.7 0-3 2-3 5v5h2v10h2V2z",
    sport: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 0 1 6.9 6H13V5.1zM11 5.1V11H5.1A7 7 0 0 1 11 5.1zM5.1 13H11v5.9A7 7 0 0 1 5.1 13zm7.9 5.9V13h5.9a7 7 0 0 1-5.9 5.9z",
    art: "M12 3a9 9 0 0 0 0 18c1 0 1.5-.8 1.5-1.5 0-.9-.8-1.2-.8-2 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zM7 12.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
    hall: "M9 3v10.6A4 4 0 1 0 11 17V7h6V3z",
    library: "M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z",
    office: "M4 21V5l8-3 8 3v16h-6v-5h-4v5zM8 8h2v2H8zm6 0h2v2h-2zm-6 4h2v2H8zm6 0h2v2h-2z",
  };
  const typeOf = (b) => (typeof BUILDING_TYPES !== "undefined" && BUILDING_TYPES[b.type]) || ["#4A7DFF", "건물"];
  const glyph = (t) => GLYPH[t] || GLYPH.lecture;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function markerHTML(b) {
    const on = selectedId === b.id;
    const dim = dimmed && !dimmed.has(b.id);
    const color = on ? "#03C75A" : typeOf(b)[0];
    const size = on ? 17 : 13;
    const mins = userPos ? `<span class="mk-min">${U.walkMinutes(U.distance(userPos, b))}분</span>` : "";
    return `<div class="mk${on ? " on" : ""}${dim ? " dim" : ""}" data-id="${esc(b.id)}">
      <span class="mk-dot" style="background:${color}"><svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${glyph(b.type)}" fill="#fff" fill-rule="evenodd"/></svg></span>
      <span class="mk-name">${esc(b.name)}</span>${mins}</div>`;
  }
  const logoHTML = (l) => `<div class="mk-logo"><span>${esc(l.name)}</span><i><img src="${esc(l.src)}" alt=""></i></div>`;
  const userHTML = () => '<div class="user-dot"></div>';

  /* -------------------- 공개 함수 -------------------- */

  function init(containerId, center, options = {}) {
    container = document.getElementById(containerId);
    opts = { ...options, center };
    if (hasNaver() && window.MAP_STATUS !== "failed") {
      engine = NaverEngine;
      engine.init(container, opts);
      // 인증이 실패하면 네이버가 빈 지도만 남기므로 임시 지도로 바꾼다
      window.onNaverMapFail = switchToPlaceholder;
      setTimeout(() => { if (engine === NaverEngine && !container.querySelector(".mk")) switchToPlaceholder(); }, 3000);
    } else {
      usePlaceholder();
    }
  }

  function usePlaceholder() {
    engine = Placeholder;
    engine.init(container, opts);
  }

  function switchToPlaceholder() {
    if (engine !== NaverEngine) return;
    NaverEngine.destroy();
    usePlaceholder();
    redraw();
    if (userPos) engine.setUserLocation(userPos);
    if (lastLines) engine.showDistanceLines(...lastLines);
    const b = buildings.find((x) => x.id === selectedId);
    if (b) engine.focus(b, lastFocusOpts);
  }

  function redraw() { engine.setMarkers(buildings, (b) => onMarkerClick(b)); }

  function setMarkers(list, onClick) {
    buildings = list.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng)); // 좌표 없는 건물은 목록에서만
    onMarkerClick = onClick;
    redraw();
  }

  function setDimmed(ids) {
    dimmed = ids ? new Set(ids) : null;
    redraw();
  }

  let lastFocusOpts = {};
  function focus(building, focusOpts = {}) {
    selectedId = building.id;
    lastFocusOpts = focusOpts;
    redraw();
    engine.focus(building, focusOpts);
  }

  function clearSelection() {
    selectedId = null;
    redraw();
  }

  function setUserLocation(pos) {
    userPos = pos;
    engine.setUserLocation(pos);
    redraw();
  }

  function showDistanceLines(from, targets) {
    lastLines = [from, targets];
    engine.showDistanceLines(from, targets);
  }

  /* ----------------------------------------------------------
   *  네이버 지도
   * ---------------------------------------------------------- */
  const NaverEngine = (() => {
    let map = null;
    let markers = [];
    let extras = [];       // 로고, 내 위치
    let userMarker = null;
    let lines = [];
    const LL = (p) => new naver.maps.LatLng(p.lat, p.lng);
    const html = (content) => ({ content, anchor: new naver.maps.Point(0, 0) });

    function init(el, o) {
      map = new naver.maps.Map(el, {
        center: LL(o.center), zoom: 17, minZoom: 15,
        mapDataControl: false, scaleControl: false,
        logoControl: true, logoControlOptions: { position: naver.maps.Position.LEFT_CENTER },
      });
      if (o.logo) extras.push(new naver.maps.Marker({ map, position: LL(o.logo), zIndex: 5, clickable: false, icon: html(logoHTML(o.logo)) }));
      naver.maps.Event.addListener(map, "click", () => o.onMapClick && o.onMapClick());
    }
    function destroy() {
      markers.forEach((m) => m.setMap(null));
      extras.forEach((m) => m.setMap(null));
      lines.forEach((l) => l.setMap(null));
      userMarker?.setMap(null);
      map?.destroy();
      markers = []; extras = []; lines = []; userMarker = null; map = null;
      container.innerHTML = "";
    }
    function setMarkers(list, onClick) {
      markers.forEach((m) => m.setMap(null));
      markers = list.map((b) => {
        const m = new naver.maps.Marker({ map, position: LL(b), zIndex: selectedId === b.id ? 20 : 10, icon: html(markerHTML(b)) });
        naver.maps.Event.addListener(m, "click", () => onClick(b));
        return m;
      });
    }
    function focus(b, { bottomInset = 0 } = {}) {
      const proj = map.getProjection();
      const pt = proj.fromCoordToOffset(LL(b));
      map.panTo(proj.fromOffsetToCoord(new naver.maps.Point(pt.x, pt.y + bottomInset / 2)));
    }
    function setUserLocation(pos) {
      userMarker?.setMap(null);
      userMarker = pos ? new naver.maps.Marker({ map, position: LL(pos), zIndex: 15, clickable: false, icon: html(userHTML()) }) : null;
    }
    function showDistanceLines(from, targets) {
      lines.forEach((l) => l.setMap(null));
      lines = from ? targets.map(({ building }) => new naver.maps.Polyline({
        map, path: [LL(from), LL(building)], strokeColor: "#FF7A2F", strokeWeight: 3, strokeStyle: "shortdash",
      })) : [];
    }
    return { init, destroy, setMarkers, focus, setUserLocation, showDistanceLines };
  })();

  /* ----------------------------------------------------------
   *  임시 지도 (네이버 지도 키가 없거나 인증 실패 시)
   *  실제 좌표를 실제 거리 비율 그대로 화면에 옮깁니다. 손가락으로 끌어서 옮길 수 있습니다.
   * ---------------------------------------------------------- */
  const Placeholder = (() => {
    let baseY = 0.31;      // 건물들 가운데를 둘 높이 (화면 높이 비율)
    let baseX = 0.5;       // 건물들 가운데를 둘 가로 위치 (화면 폭 비율)
    const LABEL_W = 80;    // 마커 오른쪽에 붙는 이름 폭
    let PX_PER_M = 0.6;
    let pinned = [];       // 좌표에 붙은 요소들 (배율이 바뀌면 다시 놓는다)
    const SVG_NS = "http://www.w3.org/2000/svg";
    let root, layer, svg, center, userEl = null;
    let pan = { x: 0, y: 0 };
    const xy = (p) => ({
      x: (p.lng - center.lng) * 111320 * Math.cos((center.lat * Math.PI) / 180) * PX_PER_M,
      y: -(p.lat - center.lat) * 110950 * PX_PER_M,
    });
    const place = (el, p) => { const q = xy(p); el.style.left = `${q.x}px`; el.style.top = `${q.y}px`; };
    const pin = (el, p) => { pinned.push([el, p]); place(el, p); layer.appendChild(el); };

    /** 캠퍼스 모양 (js/campus-shapes.js, OpenStreetMap) 을 지금 배율로 그린다 */
    function drawShapes(sh) {
      const d = (pts, close) => pts.map(([lat, lng], i) => { const q = xy({ lat, lng }); return `${i ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join("") + (close ? "Z" : "");
      const area = (list, cls) => list.map((pts) => `<path class="${cls}" d="${d(pts, true)}"/>`).join("");
      const z = PX_PER_M / 0.5; // 확대할수록 길도 조금 굵게
      const ROAD_W = Object.fromEntries(Object.entries({ tertiary: 8, secondary: 9, primary: 10, residential: 5, unclassified: 5, service: 3.2 }).map(([k, v]) => [k, +(v * Math.min(2.2, Math.max(0.8, z))).toFixed(1)]));
      const roads = sh.roads.slice().sort((a, b) => (ROAD_W[a.k] || 5) - (ROAD_W[b.k] || 5));
      const casing = roads.map((r) => `<path class="road-case" stroke-width="${(ROAD_W[r.k] || 3.2) + 1.6}" d="${d(r.p)}"/>`).join("");
      const fill = roads.map((r) => `<path class="road ${r.k === "tertiary" || r.k === "secondary" || r.k === "primary" ? "major" : ""}" stroke-width="${ROAD_W[r.k] || 3.2}" d="${d(r.p)}"/>`).join("");
      root.querySelector(".ph-shapes").innerHTML =
        area(sh.campus, "campus") + area(sh.grass, "grass") + area(sh.pitch, "pitch") + area(sh.water, "water") + area(sh.parking, "parking") +
        casing + fill + sh.paths.map((p) => `<path class="path" d="${d(p)}"/>`).join("") +
        sh.buildings.map((b) => `<path class="bldg" d="${d(b.p, true)}"/>`).join("");
    }

    /** 건물 전체가 시트 위 보이는 칸에 들어오도록 배율과 가운데를 정한다 */
    function fit(list) {
      if (!list.length) return;
      const lat = list.map((b) => b.lat), lng = list.map((b) => b.lng);
      center = { lat: (Math.min(...lat) + Math.max(...lat)) / 2, lng: (Math.min(...lng) + Math.max(...lng)) / 2 };
      const wM = (Math.max(...lng) - Math.min(...lng)) * 111320 * Math.cos((center.lat * Math.PI) / 180);
      const hM = (Math.max(...lat) - Math.min(...lat)) * 110950;
      const H = root.clientHeight;
      const W = root.clientWidth;
      const ins = { top: 0, bottom: H * 0.5, left: 0, ...(opts.insets && opts.insets()) };
      const free = Math.max(120, H - ins.top - ins.bottom - 40); // 보이는 칸 (이름 높이 여유 빼고)
      baseY = (ins.top + (H - ins.bottom)) / 2 / H;
      baseX = (ins.left + W) / 2 / W;
      PX_PER_M = fitScale = Math.min((W - ins.left - 40 - LABEL_W) / wM, free / hM, 1.2);
      pan = { x: -LABEL_W / 2, y: 0 };
      if (typeof CAMPUS_SHAPES !== "undefined") drawShapes(CAMPUS_SHAPES);
      else {
        // 모양 자료가 없으면 건물 범위보다 조금 넓은 타원으로 캠퍼스를 표시
        const cw = wM * PX_PER_M + 150, ch = hM * PX_PER_M + 110;
        Object.assign(root.querySelector(".ph-campus").style, { width: `${cw}px`, height: `${ch}px`, left: `${-cw / 2 + 20}px`, top: `${-ch / 2}px` });
      }
      pinned.forEach(([el, p]) => place(el, p));
      applyPan(false);
    }
    const applyPan = (animate) => {
      layer.style.transition = animate ? "transform .35s ease" : "none";
      layer.style.transform = `translate(${root.clientWidth * baseX + pan.x}px, ${root.clientHeight * baseY + pan.y}px)`;
    };

    function init(el, o) {
      center = o.center;
      el.innerHTML = "";
      root = document.createElement("div");
      root.className = "map-placeholder";
      root.innerHTML = '<div class="notice">네이버 지도 연결 전 임시 지도</div><div class="ph-layer"><div class="ph-campus"></div><svg class="ph-shapes"></svg><svg class="mock-lines"></svg></div>';
      el.appendChild(root);
      setTimeout(() => root.querySelector(".notice")?.classList.add("gone"), 4000);
      layer = root.querySelector(".ph-layer");
      svg = root.querySelector(".mock-lines");
      pinned = [];
      if (o.logo) {
        const logo = document.createElement("div");
        logo.className = "ph-pin";
        logo.innerHTML = logoHTML(o.logo);
        pin(logo, o.logo);
      }
      applyPan(false);
      // 한 손가락: 끌어서 옮기기, 그냥 누르면 지도 탭 / 두 손가락: 벌리고 오므려 확대, 축소 / 마우스 휠: 확대, 축소
      const ptrs = new Map();
      let start = null, moved = false, pinchD = 0;
      const local = (x, y) => { const r = root.getBoundingClientRect(); return [x - r.left, y - r.top]; };
      const pinchInfo = () => {
        const [a, b] = [...ptrs.values()];
        return { d: Math.hypot(a.x - b.x, a.y - b.y), m: local((a.x + b.x) / 2, (a.y + b.y) / 2) };
      };
      root.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".mk")) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) { pinchD = pinchInfo().d; moved = true; start = null; return; }
        start = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        moved = false;
      });
      root.addEventListener("pointermove", (e) => {
        if (!ptrs.has(e.pointerId)) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 2) {
          const { d, m } = pinchInfo();
          if (pinchD) zoomBy(d / pinchD, m[0], m[1]);
          pinchD = d;
          return;
        }
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (moved) { touched = true; pan = { x: start.px + dx, y: start.py + dy }; applyPan(false); }
      });
      const up = (e) => {
        const wasTap = start && !moved && ptrs.size === 1 && !e.target.closest(".mk");
        ptrs.delete(e.pointerId);
        if (wasTap) o.onMapClick && o.onMapClick();
        if (ptrs.size === 1) { const [p] = [...ptrs.values()]; start = { x: p.x, y: p.y, px: pan.x, py: pan.y }; }
        else start = null;
        pinchD = 0;
      };
      root.addEventListener("pointerup", up);
      root.addEventListener("pointercancel", up);
      root.addEventListener("wheel", (e) => {
        e.preventDefault();
        const [fx, fy] = local(e.clientX, e.clientY);
        zoomBy(Math.exp(-e.deltaY * 0.0025), fx, fy);
      }, { passive: false });
    }

    let fitted = false, touched = false;
    let fitScale = 0.6, lastLines = null;

    /** 화면의 (fx, fy) 점을 그대로 둔 채 k 배 확대 */
    function zoomBy(k, fx, fy) {
      const next = Math.min(fitScale * 5, Math.max(fitScale * 0.7, PX_PER_M * k));
      k = next / PX_PER_M;
      if (Math.abs(k - 1) < 0.001) return;
      const W = root.clientWidth, H = root.clientHeight;
      const tx = W * baseX + pan.x, ty = H * baseY + pan.y;
      pan = { x: fx - (fx - tx) * k - W * baseX, y: fy - (fy - ty) * k - H * baseY };
      PX_PER_M = next;
      touched = true;
      redrawAll();
    }
    function redrawAll() {
      pinned.forEach(([el, p]) => place(el, p));
      if (typeof CAMPUS_SHAPES !== "undefined") drawShapes(CAMPUS_SHAPES);
      if (lastLines) showDistanceLines(...lastLines);
      applyPan(false);
    }
    function setMarkers(list, onClick) {
      if (!fitted && list.length) {
        fitted = true;
        fit(list);
        // 앱 안 웹 화면은 처음에 안전 여백이 늦게 들어와서, 자리 잡은 뒤 한 번 더 맞춘다
        const refit = () => { if (!touched && !selectedId) fit(buildings); };
        setTimeout(refit, 400);
        window.addEventListener("resize", refit);
      }
      pinned = pinned.filter(([el]) => !el.classList.contains("b"));
      layer.querySelectorAll(".ph-pin.b").forEach((m) => m.remove());
      list.forEach((b) => {
        const el = document.createElement("div");
        el.className = "ph-pin b";
        el.innerHTML = markerHTML(b);
        if (selectedId === b.id) el.style.zIndex = 5;
        el.firstElementChild.addEventListener("click", (e) => { e.stopPropagation(); onClick(b); });
        pin(el, b);
      });
    }

    function focus(b, { bottomInset = 0 } = {}) {
      const q = xy(b);
      const h = root.clientHeight;
      const left = (opts.insets && opts.insets().left) || 0;
      // 건물이 가려지지 않은 부분의 가운데쯤 오도록
      const targetY = (h - bottomInset) * 0.5;
      pan = { x: (left + root.clientWidth) / 2 - root.clientWidth * baseX - q.x, y: targetY - h * baseY - q.y };
      applyPan(true);
    }

    function setUserLocation(pos) {
      if (userEl) { userEl.remove(); pinned = pinned.filter(([el]) => el !== userEl); }
      userEl = null;
      if (!pos) return;
      userEl = document.createElement("div");
      userEl.className = "ph-pin";
      userEl.innerHTML = userHTML();
      pin(userEl, pos);
    }

    function showDistanceLines(from, targets) {
      lastLines = [from, targets];
      svg.innerHTML = "";
      if (!from) return;
      targets.forEach(({ building, label }) => {
        const a = xy(from), b = xy(building);
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
        line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
        svg.appendChild(line);
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", (a.x + b.x) / 2);
        text.setAttribute("y", (a.y + b.y) / 2 - 4);
        text.textContent = label;
        svg.appendChild(text);
      });
    }

    return { init, setMarkers, focus, setUserLocation, showDistanceLines };
  })();

  return {
    init, setMarkers, setDimmed, focus, clearSelection, setUserLocation, showDistanceLines,
    isReady: () => engine === NaverEngine,
  };
})();
