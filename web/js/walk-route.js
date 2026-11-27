/**
 * ============================================================
 *  걷는 길 찾기 (CampusWalk)
 * ============================================================
 *  OpenStreetMap 캠퍼스 길(js/campus-shapes.js 의 roads, paths)을 이어 그래프로 만들고
 *  두 지점 사이 가장 짧은 길을 찾는다. 네이버는 도보 길찾기 API 를 공개하지 않아서 직접 계산.
 *
 *    CampusWalk.route(from, to)
 *      from, to: { lat, lng, id?, name? }
 *      → { points: [{lat,lng}], meters, minutes, steps: [{ text, meters?, turn?, at? }], via: [건물 이름] }
 *        at: 회전 안내가 출발점에서 몇 m 지점인지 (현재 위치 안내에 씀)
 *        길 데이터가 없거나 이어지지 않으면 null (그때는 직선거리 예상값을 씀)
 *
 *  OSM 에 없는 지름길(건물 사이 통로, 계단 등)은 모르기 때문에 실제보다 돌아갈 수 있어요.
 *  길이 빠졌으면 OpenStreetMap 에 추가하고 campus-shapes.js 를 다시 받으면 돼요.
 * ============================================================
 */
const CampusWalk = (() => {
  const U = CampusUtil;
  const SNAP_M = 4;              // 이 거리 안의 점은 같은 교차점으로 봄
  const GAP_M = 25;              // 끊긴 길: 이 거리 안이면 걸어서 건너갈 수 있다고 봄 (OSM 에 빠진 연결)
  const DIRECT_M = 140;          // 이보다 가까운 두 곳은 길이 없어도 바로 걸어갈 수 있다고 봄 (광장, 잔디)
  const DETOUR = 1.2;            // 길이 아닌 곳을 걸을 때 거리 가중치
  const NO_WALK = new Set(["motorway", "trunk", "motorway_link", "trunk_link"]);
  let graph = null;

  /* ---------- 그래프 만들기 (처음 한 번) ---------- */
  function build() {
    if (graph) return graph;
    if (typeof CAMPUS_SHAPES === "undefined") return null;
    const nodes = [];            // { lat, lng, edges: [[to, m]] }
    const grid = new Map();      // 약 5m 칸 → 그 칸의 점 번호들
    const cell = (p) => `${Math.round(p.lat * 20000)},${Math.round(p.lng * 16000)}`;

    function nodeAt(p) {
      const [cy, cx] = cell(p).split(",").map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const i of grid.get(`${cy + dy},${cx + dx}`) || []) {
          if (U.distance(nodes[i], p) <= SNAP_M) return i;
        }
      }
      const i = nodes.push({ lat: p.lat, lng: p.lng, edges: [] }) - 1;
      const k = cell(p);
      grid.set(k, [...(grid.get(k) || []), i]);
      return i;
    }
    function link(a, b) {
      if (a === b) return;
      const m = U.distance(nodes[a], nodes[b]);
      nodes[a].edges.push([b, m]);
      nodes[b].edges.push([a, m]);
    }

    const ways = [
      ...(CAMPUS_SHAPES.roads || []).filter((r) => !NO_WALK.has(r.k)).map((r) => r.p),
      ...(CAMPUS_SHAPES.paths || []),
    ];
    for (const way of ways) {
      let prev = null;
      for (const [lat, lng] of way) {
        const i = nodeAt({ lat, lng });
        if (prev !== null) link(prev, i);
        prev = i;
      }
    }
    // OSM 에서 끊겨 있는 가까운 길끼리 이어 준다 (서로 다른 길의 점끼리만)
    const near = new Map();
    const bucket = (p) => `${Math.round(p.lat * 4000)},${Math.round(p.lng * 3200)}`; // 약 28m 칸
    nodes.forEach((p, i) => { const k = bucket(p); near.set(k, [...(near.get(k) || []), i]); });
    nodes.forEach((p, i) => {
      const [cy, cx] = bucket(p).split(",").map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const j of near.get(`${cy + dy},${cx + dx}`) || []) {
          if (j <= i || p.edges.some(([t]) => t === j)) continue;
          const m = U.distance(p, nodes[j]);
          if (m <= GAP_M && m > SNAP_M) {
            p.edges.push([j, m * DETOUR]);
            nodes[j].edges.push([i, m * DETOUR]);
          }
        }
      }
    });
    graph = { nodes };
    return graph;
  }

  /* ---------- 건물에서 가장 가까운 길 위의 점 ---------- */
  // 위도, 경도를 m 단위 평면으로 (캠퍼스 정도 크기에서는 충분히 정확)
  const M_LAT = 111320;
  const mLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

  /** 가장 가까운 길 위의 점들 (가까운 순, 가장 가까운 것보다 40m 이상 먼 건 뺌, 최대 4개) */
  function snapsOnGraph(p) {
    const { nodes } = graph;
    const kx = mLng(p.lat);
    const all = [];
    nodes.forEach((a, i) => {
      for (const [j] of a.edges) {
        if (j < i) continue;
        const b = nodes[j];
        const ax = (a.lng - p.lng) * kx, ay = (a.lat - p.lat) * M_LAT;
        const bx = (b.lng - p.lng) * kx, by = (b.lat - p.lat) * M_LAT;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const x = ax + t * dx, y = ay + t * dy;
        all.push({ d: Math.hypot(x, y), i, j, lat: p.lat + y / M_LAT, lng: p.lng + x / kx });
      }
    });
    all.sort((a, b) => a.d - b.d);
    if (!all.length) return [];
    return all.filter((x) => x.d <= all[0].d + 40).slice(0, 4);
  }

  /* ---------- 가장 짧은 길 (다익스트라) ---------- */
  function shortest(src, dst) {
    const { nodes } = graph;
    const n = nodes.length + 2;
    const S = nodes.length, T = nodes.length + 1; // 출발, 도착 가상 점
    const extra = new Map([[S, []], [T, []]]);
    const edgesOf = (i) => (i >= nodes.length ? extra.get(i) : [...nodes[i].edges, ...(extra.get(i) || [])]);
    // 출발, 도착을 주변 길 여러 곳에 잇는다. 경로에는 실제로 고른 길 위의 점을 넣음
    const via = new Map(); // "가상점>길점" → 길 위의 붙는 점
    const attach = (v, snaps) => {
      for (const snap of snaps) {
        const mid = { lat: snap.lat, lng: snap.lng };
        for (const end of [snap.i, snap.j]) {
          const w = snap.d * DETOUR + U.distance(mid, nodes[end]);
          extra.get(v).push([end, w]);
          extra.set(end, [...(extra.get(end) || []), [v, w]]);
          const key = `${v}>${end}`;
          if (!via.has(key) || via.get(key).w > w) via.set(key, { w, mid });
        }
      }
    };
    attach(S, src.snaps);
    attach(T, dst.snaps);

    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[S] = 0;
    const heap = [[0, S]];
    while (heap.length) {
      // 작은 그래프라 단순 이진 힙
      const [d, u] = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let k = 0; ;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[k], heap[m]] = [heap[m], heap[k]];
          k = m;
        }
      }
      if (done[u]) continue;
      done[u] = 1;
      if (u === T) break;
      for (const [v, w] of edgesOf(u)) {
        const nd = d + w;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          heap.push([nd, v]);
          for (let k = heap.length - 1; k > 0;) {
            const p = (k - 1) >> 1;
            if (heap[p][0] <= heap[k][0]) break;
            [heap[k], heap[p]] = [heap[p], heap[k]];
            k = p;
          }
        }
      }
    }
    if (!Number.isFinite(dist[T])) return null;
    const ids = [];
    for (let v = T; v !== -1; v = prev[v]) ids.push(v);
    ids.reverse();
    const pts = [];
    ids.forEach((i, k) => {
      if (i === S) return pts.push(via.get(`${S}>${ids[k + 1]}`).mid);
      if (i === T) return pts.push(via.get(`${T}>${ids[k - 1]}`).mid);
      pts.push({ lat: nodes[i].lat, lng: nodes[i].lng });
    });
    return { points: pts, meters: dist[T] };
  }

  /* ---------- 말로 된 안내 ---------- */
  const bearing = (a, b) => (Math.atan2((b.lng - a.lng) * mLng(a.lat), (b.lat - a.lat) * M_LAT) * 180) / Math.PI;
  const turnOf = (deg) => {
    const d = ((deg + 540) % 360) - 180; // -180 ~ 180, + 는 오른쪽
    const a = Math.abs(d);
    if (a < 50) return null;
    return a > 150 ? "되돌아서" : d > 0 ? "오른쪽으로" : "왼쪽으로";
  };
  const round10 = (m) => Math.max(10, Math.round(m / 10) * 10);

  function landmark(p, skip) {
    let best = null;
    for (const b of BUILDINGS) {
      if (skip.has(b.id)) continue;
      const d = U.distance(p, b);
      if (d < 75 && (!best || d < best.d)) best = { b, d };
    }
    return best?.b;
  }

  function describe(points, from, to) {
    // 짧게 꺾인 점들을 묶어 "구간"으로 (같은 방향이면 하나로)
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const m = U.distance(a, b);
      if (m < 0.5) continue;
      const br = bearing(a, b);
      const last = legs[legs.length - 1];
      if (last && (Math.abs(((br - last.br + 540) % 360) - 180) < 50 || m < 20)) {
        last.m += m;
        last.end = b;
      } else {
        legs.push({ br, m, start: a, end: b });
      }
    }
    const skip = new Set([from.id, to.id].filter(Boolean));
    const steps = [{ text: `${from.name || "출발지"}에서 출발`, at: 0, pos: points[0] }];
    let walked = 0; // 출발점에서 이 구간 시작까지 거리 → 회전 안내의 "몇 m 앞"
    legs.forEach((leg, i) => {
      if (i > 0) {
        walked += legs[i - 1].m;
        const turn = turnOf(leg.br - legs[i - 1].br);
        const lm = landmark(leg.start, skip);
        if (turn) steps.push({ text: `${lm ? `${lm.name} 앞에서 ` : ""}${turn} 돌기`, turn: turn.startsWith("오른") ? "right" : turn.startsWith("왼") ? "left" : "back", at: walked, pos: leg.start });
      }
      const prev = steps[steps.length - 1];
      if (prev.meters != null && !prev.turn) prev.meters += leg.m;
      else steps.push({ text: "", meters: leg.m });
    });
    steps.forEach((s) => { if (s.meters != null) s.text = `약 ${round10(s.meters)}m 걷기`; });
    const total = legs.reduce((sum, l) => sum + l.m, 0);
    steps.push({ text: `${to.name || "도착지"} 도착`, at: total, pos: points[points.length - 1] });

    // 지나가는 건물 (길에서 40m 안, 지나는 순서대로)
    const via = [];
    for (const p of points) {
      for (const b of BUILDINGS) {
        if (skip.has(b.id) || via.includes(b.name)) continue;
        if (U.distance(p, b) < 55) via.push(b.name);
      }
    }
    return { steps, via: via.slice(0, 4) };
  }

  /* ---------- 밖으로 ---------- */
  const cache = new Map();
  function route(from, to) {
    if (!from || !to || !build() || !graph.nodes.length) return null;
    const key = [from.lat, from.lng, to.lat, to.lng].map((x) => x.toFixed(6)).join(",");
    if (cache.has(key)) return cache.get(key);
    const src = { ...from, snaps: snapsOnGraph(from) };
    const dst = { ...to, snaps: snapsOnGraph(to) };
    let res = null;
    // 길에서 너무 먼 곳(150m 넘게)은 OSM 길로 안내하기 어려움
    if (src.snaps.length && dst.snaps.length && src.snaps[0].d < 150 && dst.snaps[0].d < 150) {
      let found = shortest(src, dst);
      const straight = U.distance(from, to);
      // 아주 가까우면 길을 따라 도는 것보다 바로 건너가는 게 나을 수 있음
      if (straight < DIRECT_M && (!found || straight * DETOUR < found.meters)) found = { points: [], meters: straight * DETOUR };
      if (found) {
        const points = [{ lat: from.lat, lng: from.lng }, ...found.points, { lat: to.lat, lng: to.lng }];
        const meters = found.meters;
        res = { points, meters, minutes: Math.max(1, Math.ceil(meters / 67)), ...describe(points, from, to) };
      }
    }
    cache.set(key, res);
    return res;
  }

  return { route };
})();
