"""
호출 횟수 제한 (메모리 방식, 서버 프로세스 하나 기준)

혼잡도·평가처럼 누구나 보낼 수 있는 API 를 한 사람이 계속 부르지 못하게 막아요.

    limiter = RateLimiter(per_ip=(5, 3600), total=(2000, 86400))
    ok, retry_after = limiter.hit(ip)

- per_ip=(5, 3600): 한 사용자(IP)당 1시간에 5번
- total=(2000, 86400): 서버 전체 하루 2000번
- gunicorn 워커가 여러 개면 워커마다 따로 셉니다 (워커 2개면 실제 한도는 최대 2배).
"""
import threading
import time
from collections import deque


class RateLimiter:
    def __init__(self, per_ip, total):
        self.ip_max, self.ip_window = per_ip
        self.total_max, self.total_window = total
        self._ips = {}
        self._all = deque()
        self._lock = threading.Lock()

    @staticmethod
    def _trim(q, now, window):
        while q and now - q[0] >= window:
            q.popleft()

    def hit(self, ip):
        """허용되면 (True, 0), 막히면 (False, 몇 초 뒤 다시 시도)"""
        now = time.monotonic()
        with self._lock:
            q = self._ips.setdefault(ip, deque())
            self._trim(q, now, self.ip_window)
            self._trim(self._all, now, self.total_window)
            if len(q) >= self.ip_max:
                return False, max(1, int(self.ip_window - (now - q[0])) + 1)
            if len(self._all) >= self.total_max:
                return False, max(1, int(self.total_window - (now - self._all[0])) + 1)
            q.append(now)
            self._all.append(now)
            if len(self._ips) > 5000:  # 오래 안 온 IP 정리 (메모리가 계속 늘지 않게)
                for k in [k for k, v in self._ips.items() if not v or now - v[-1] >= self.ip_window]:
                    del self._ips[k]
            return True, 0
