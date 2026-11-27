/**
 * 서비스 워커: 앱 파일을 캐시해서 오프라인에서도 화면이 열리게 함
 * 파일을 수정한 뒤 배포할 때는 CACHE 버전을 올려주세요.
 */
const CACHE = "campusmap-v17";
const FILES = [
  "./", "./index.html", "./css/style.css",
  "./js/data.js", "./js/utils.js", "./js/api.js", "./js/campus-shapes.js", "./js/walk-route.js", "./js/map.js", "./js/chatbot.js", "./js/app.js",
  "./js/config.js", "./manifest.webmanifest", "./icons/icon.svg", "./icons/bu-emblem.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/brands/cu.svg", "./icons/brands/gs25.svg", "./icons/brands/7eleven.svg", "./icons/brands/emart24.svg", "./icons/brands/shinhan.svg", "./icons/brands/kb.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// 우리 파일: 네트워크 우선 → 실패 시 캐시 / 외부(네이버 지도 등): 그대로 통과
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return; // API·관리자는 항상 최신 (캐시 안 함)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
