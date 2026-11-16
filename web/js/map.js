/**
 * ============================================================
 *  지도 모듈 (CampusMap)
 * ============================================================
 *  ★ 네이버 지도 API 담당 팀원이 작업할 파일입니다.
 *
 *  app.js 는 아래 5개 함수만 호출합니다. 함수 이름/인자만 유지하면
 *  내부 구현은 자유롭게 바꿔도 됩니다.
 *
 *    CampusMap.init(containerId, center)        지도 생성
 *    CampusMap.setMarkers(buildings, onClick)   건물 마커 표시 (기존 마커는 지움)
 *    CampusMap.focus(building)                  해당 건물로 이동 + 강조
 *    CampusMap.clearSelection()                 강조 해제
 *    CampusMap.isReady()                        네이버 지도 사용 여부
 *    CampusMap.setUserLocation(pos)             내 위치 표시 ({lat,lng} 또는 null)
 *    CampusMap.showDistanceLines(from, targets) 내 위치 → 식당 연결선 + 거리 라벨
 *        targets: [{ building, label }]  (빈 배열이면 선 지우기)
 *
 *  building 객체 형태: { id, name, lat, lng, ... }  (js/data.js 참고)
 *
 *  네이버 지도 스크립트(index.html <head>)가 없으면 자동으로
 *  "임시 지도"가 표시되어, 지도 없이도 나머지 기능을 개발할 수 있습니다.
 * ============================================================
 */
const CampusMap = (() => {
  let container = null;
  let map = null;          // naver.maps.Map 인스턴스
  let markers = [];        // { id, marker } 목록
  let selectedId = null;

  const hasNaver = () => typeof window.naver !== "undefined" && window.naver.maps;

  /* -------------------- 공개 함수 -------------------- */

  function init(containerId, center) {
    container = document.getElementById(containerId);

    if (hasNaver()) {
      // TODO(지도 담당): 네이버 지도 생성
      // map = new naver.maps.Map(container, {
      //   center: new naver.maps.LatLng(center.lat, center.lng),
      //   zoom: 17,
      // });
    } else {
      Placeholder.init(container, center);
    }
  }

  function setMarkers(buildings, onClick) {
    clearMarkers();

    if (hasNaver()) {
      // TODO(지도 담당): 건물마다 마커 생성 + 클릭 이벤트 연결
      // buildings.forEach((b) => {
      //   const marker = new naver.maps.Marker({
      //     position: new naver.maps.LatLng(b.lat, b.lng),
      //     map,
      //     title: b.name,
      //   });
      //   naver.maps.Event.addListener(marker, "click", () => onClick(b));
      //   markers.push({ id: b.id, marker });
      // });
    } else {
      Placeholder.setMarkers(buildings, onClick);
    }
  }

  function focus(building) {
    selectedId = building.id;

    if (hasNaver()) {
      // TODO(지도 담당): 지도 이동 + 선택 마커 강조
      // map.panTo(new naver.maps.LatLng(building.lat, building.lng));
      // map.setZoom(18);
    } else {
      Placeholder.highlight(building.id);
    }
  }

  function clearSelection() {
    selectedId = null;
    if (!hasNaver()) Placeholder.highlight(null);
    // TODO(지도 담당): 마커 강조 해제
  }

  function clearMarkers() {
    if (hasNaver()) {
      markers.forEach(({ marker }) => marker.setMap(null));
    }
    markers = [];
  }

  function setUserLocation(pos) {
    if (hasNaver()) {
      // TODO(지도 담당): 내 위치 마커 (파란 점)
      // if (userMarker) userMarker.setMap(null);
      // if (!pos) return;
      // userMarker = new naver.maps.Marker({
      //   position: new naver.maps.LatLng(pos.lat, pos.lng), map,
      //   icon: { content: '<div class="user-dot"></div>', anchor: new naver.maps.Point(9, 9) },
      // });
    } else {
      Placeholder.setUserLocation(pos);
    }
  }

  function showDistanceLines(from, targets) {
    if (hasNaver()) {
      // TODO(지도 담당): 연결선(Polyline) + 거리 라벨(InfoWindow 또는 Marker content)
      // lines.forEach((l) => l.setMap(null)); lines = [];
      // targets.forEach(({ building, label }) => {
      //   lines.push(new naver.maps.Polyline({
      //     map, strokeColor: "#ff6b00", strokeWeight: 3, strokeStyle: "shortdash",
      //     path: [new naver.maps.LatLng(from.lat, from.lng), new naver.maps.LatLng(building.lat, building.lng)],
      //   }));
      // });
    } else {
      Placeholder.showDistanceLines(from, targets);
    }
  }

  /* ----------------------------------------------------------
   *  임시 지도 (네이버 지도 연동 전 개발용)
   *  네이버 지도 연동이 끝나면 이 부분은 삭제해도 됩니다.
   * ---------------------------------------------------------- */
  const Placeholder = (() => {
    let root = null;
    let center = null;
    const SCALE = 60000; // 위경도 → 픽셀 환산 배율 (임시)

    const SVG_NS = "http://www.w3.org/2000/svg";
    let svg = null;
    let userDot = null;
    const dx = (p) => (p.lng - center.lng) * SCALE;
    const dy = (p) => -(p.lat - center.lat) * SCALE;

    function init(el, c) {
      center = c;
      root = document.createElement("div");
      root.className = "map-placeholder";
      root.innerHTML = '<div class="notice">🗺️ 네이버 지도 연동 전 임시 지도입니다</div>';
      svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "mock-lines");
      root.appendChild(svg);
      el.appendChild(root);
    }

    function setUserLocation(pos) {
      userDot?.remove();
      userDot = null;
      if (!pos) return;
      userDot = document.createElement("div");
      userDot.className = "user-dot";
      userDot.style.left = `calc(50% + ${dx(pos)}px)`;
      userDot.style.top = `calc(50% + ${dy(pos)}px)`;
      root.appendChild(userDot);
    }

    function showDistanceLines(from, targets) {
      svg.innerHTML = "";
      targets.forEach(({ building, label }) => {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("x1", dx(from)); line.setAttribute("y1", dy(from));
        line.setAttribute("x2", dx(building)); line.setAttribute("y2", dy(building));
        svg.appendChild(line);
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", (dx(from) + dx(building)) / 2);
        text.setAttribute("y", (dy(from) + dy(building)) / 2 - 4);
        text.textContent = label;
        svg.appendChild(text);
      });
    }

    function setMarkers(buildings, onClick) {
      root.querySelectorAll(".mock-marker").forEach((m) => m.remove());
      buildings.forEach((b) => {
        const btn = document.createElement("button");
        btn.className = "mock-marker";
        btn.dataset.id = b.id;
        btn.textContent = b.name;
        btn.style.left = `calc(50% + ${(b.lng - center.lng) * SCALE}px)`;
        btn.style.top = `calc(50% - ${(b.lat - center.lat) * SCALE}px)`;
        btn.addEventListener("click", () => onClick(b));
        root.appendChild(btn);
      });
    }

    function highlight(id) {
      root.querySelectorAll(".mock-marker").forEach((m) =>
        m.classList.toggle("selected", m.dataset.id === id)
      );
    }

    return { init, setMarkers, highlight, setUserLocation, showDistanceLines };
  })();

  return { init, setMarkers, focus, clearSelection, setUserLocation, showDistanceLines, isReady: hasNaver };
})();
