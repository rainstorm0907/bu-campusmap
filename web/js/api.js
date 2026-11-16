/**
 * 서버(API) 연결
 * - 서버(server/app.py)로 열면 자동으로 같은 주소의 API 를 사용합니다.
 * - iOS 앱에서는 Swift(AppConfig.apiBaseURL)가 window.CAMPUS_API_BASE 를 넣어줍니다.
 * - 서버에 연결할 수 없으면 Api.online = false → js/data.js 예시 데이터로 동작합니다.
 */
const Api = (() => {
  const base =
    typeof window.CAMPUS_API_BASE === "string"
      ? window.CAMPUS_API_BASE.replace(/\/$/, "")
      : location.protocol.startsWith("http") ? "" : null;
  let online = false;

  async function request(method, path, body, headers = {}) {
    if (base === null) throw new Error("API 서버 주소가 없어요.");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function init() {
    if (base === null) return (online = false);
    try {
      await request("GET", "/api/health");
      online = true;
    } catch {
      online = false;
    }
    return online;
  }

  return {
    init,
    request,
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    get online() { return online; },
  };
})();
