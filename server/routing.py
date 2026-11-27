"""
차량 이동 시간: 네이버 지도 Directions 5 (실시간 교통 반영)

키는 코드에 넣지 않고 환경변수나 server/.env 파일(깃에 안 올라감)에서 읽어요.
    NAVER_MAP_KEY_ID=...   # NCP 콘솔 > Maps Application 의 Client ID (지도 띄우는 키와 같음)
    NAVER_MAP_KEY=...      # 같은 Application 의 Client Secret
그 Application 에서 Directions 5 를 켜 두어야 해요.

네이버 응답(밀리초, 미터)을 분, 미터로 바꿔서 돌려줘요. 같은 경로는 3분 동안 다시 묻지 않아요.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# 새 Maps 서비스 주소가 먼저, 예전(AI·NAVER API) 주소는 예비
HOSTS = [
    "https://maps.apigw.ntruss.com/map-direction/v1/driving",
    "https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving",
]
CACHE_SEC = 180
_cache = {}


def _load_env_file():
    env = Path(__file__).with_name(".env")
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()


class RouteError(Exception):
    pass


def configured():
    return bool(os.environ.get("NAVER_MAP_KEY_ID") and os.environ.get("NAVER_MAP_KEY"))


def driving(from_lat, from_lng, to_lat, to_lng):
    """→ {"carMin": int, "distanceM": int, "at": "2026-11-27T22:30:00"}  실패하면 RouteError"""
    if not configured():
        raise RouteError("네이버 길찾기 키가 설정되지 않았어요 (NAVER_MAP_KEY_ID, NAVER_MAP_KEY)")
    key = (round(from_lat, 5), round(from_lng, 5), round(to_lat, 5), round(to_lng, 5))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SEC:
        return hit[1]

    query = urllib.parse.urlencode({
        "start": f"{from_lng},{from_lat}",   # 네이버는 경도,위도 순서
        "goal": f"{to_lng},{to_lat}",
        "option": "trafast",                 # 실시간 빠른 길
    }, safe=",")
    headers = {
        "x-ncp-apigw-api-key-id": os.environ["NAVER_MAP_KEY_ID"],
        "x-ncp-apigw-api-key": os.environ["NAVER_MAP_KEY"],
    }
    last = None
    for host in HOSTS:
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{host}?{query}", headers=headers), timeout=6) as res:
                data = json.loads(res.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            last = f"네이버 길찾기 요청 실패 ({e.code})"
            if e.code in (401, 403, 404):  # 이 주소에 권한이 없으면 다음 주소로
                continue
            raise RouteError(last)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            raise RouteError(f"네이버 길찾기에 연결하지 못했어요 ({e})")
    else:
        raise RouteError(last or "네이버 길찾기 요청 실패")

    if data.get("code") != 0:
        raise RouteError(data.get("message") or f"경로를 찾지 못했어요 (code {data.get('code')})")
    summary = data["route"]["trafast"][0]["summary"]
    result = {
        "carMin": max(1, round(summary["duration"] / 60000)),
        "distanceM": int(summary["distance"]),
        "at": data.get("currentDateTime"),
    }
    _cache[key] = (time.time(), result)
    return result
