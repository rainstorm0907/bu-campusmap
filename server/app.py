"""
캠퍼스맵 백엔드 서버 (Flask + SQLite)
담당: 1번 (DB 설계 · 인증 · 공통 API · 배포)

실행:
    pip install -r requirements.txt
    python seed.py            # 최초 1회: DB 생성 + 예시 데이터 + 관리자 계정
    python app.py             # http://localhost:8000

같은 서버가 web/ 폴더도 함께 제공하므로, 브라우저로 http://localhost:8000 을 열면
프론트(js/api.js)가 자동으로 이 API 를 사용합니다.
"""
import json
import os
import re
import uuid
from datetime import date, datetime
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

import hashlib

import auth
import chatbot
import feedback
import menu_auto
import routing
from db import (BASE_DIR, building_dict, cafeteria_dict, close_db, event_dict, get_db, lost_dict, menu_dict,
                report_dict, save_building_floors)
from ratelimit import RateLimiter

WEB_DIR = BASE_DIR.parent / "web"
UPLOAD_DIR = Path(os.environ.get("CAMPUS_UPLOADS", BASE_DIR / "uploads"))
ALLOWED_IMAGE = {"jpg", "jpeg", "png", "gif", "webp", "heic"}

app = Flask(__name__, static_folder=None)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-only-change-me")
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 업로드 최대 5MB
app.json.ensure_ascii = False
app.teardown_appcontext(close_db)


# ================================================================
#  공통: CORS, 에러 응답, 입력 검사
# ================================================================

@app.after_request
def cors(res):
    # iOS 앱(file://)이나 다른 주소에서 띄운 웹도 API 를 쓸 수 있게 허용
    res.headers["Access-Control-Allow-Origin"] = "*"
    res.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    res.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    return res


@app.before_request
def preflight():
    if request.method == "OPTIONS":
        return "", 204


_menus_filled_on = None


@app.before_request
def fill_menus_daily():
    """날짜가 바뀐 뒤 첫 요청에서 이번 주 빈 메뉴를 채운다 (menu_auto.py)"""
    global _menus_filled_on
    today = date.today()
    if _menus_filled_on != today:
        menu_auto.fill_week(get_db(), today)
        _menus_filled_on = today


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


@app.errorhandler(ApiError)
def handle_api_error(e):
    return jsonify(error=e.message), e.status


@app.errorhandler(HTTPException)
def handle_http_error(e):
    if request.path.startswith("/api/"):
        return jsonify(error=e.description), e.code
    return e


def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("JSON 형식의 요청 본문이 필요해요.")
    return data


def text(data, key, required=False, max_len=500, default=""):
    v = data.get(key, default)
    v = "" if v is None else str(v).strip()
    if required and not v:
        raise ApiError(f"'{key}' 값을 입력해 주세요.")
    if len(v) > max_len:
        raise ApiError(f"'{key}' 는 {max_len}자 이하로 입력해 주세요.")
    return v


def choice(data, key, options, default=None):
    v = data.get(key, default)
    if v not in options:
        raise ApiError(f"'{key}' 는 {', '.join(options)} 중 하나여야 해요.")
    return v


def valid_date(s, key="date"):
    try:
        return date.fromisoformat(s).isoformat()
    except (TypeError, ValueError):
        raise ApiError(f"'{key}' 는 YYYY-MM-DD 형식이어야 해요.")


def building_exists(bid):
    if bid and not get_db().execute("SELECT 1 FROM buildings WHERE id = ?", (bid,)).fetchone():
        raise ApiError("존재하지 않는 건물이에요.", 404)
    return bid or None


# ================================================================
#  상태 확인 / 인증
# ================================================================

@app.get("/api/health")
def health():
    get_db().execute("SELECT 1")
    return jsonify(ok=True, time=datetime.now().isoformat(timespec="seconds"))


@app.post("/api/auth/login")
def login():
    data = body()
    result = auth.login(text(data, "username", True), text(data, "password", True))
    if not result:
        raise ApiError("아이디 또는 비밀번호가 틀렸어요.", 401)
    token, user = result
    return jsonify(token=token, user=user, expiresIn=auth.TOKEN_MAX_AGE)


@app.get("/api/auth/me")
@auth.admin_required
def me():
    return jsonify(dict(g.user))


# ================================================================
#  편의시설 종류 / 건물
# ================================================================

@app.get("/api/facility-types")
def facility_types():
    rows = get_db().execute("SELECT key, label FROM facility_types ORDER BY rowid").fetchall()
    return jsonify({r["key"]: r["label"] for r in rows})


@app.get("/api/buildings")
def list_buildings():
    db = get_db()
    return jsonify([building_dict(db, r) for r in db.execute("SELECT * FROM buildings ORDER BY id")])


@app.get("/api/buildings/<bid>")
def get_building(bid):
    db = get_db()
    row = db.execute("SELECT * FROM buildings WHERE id = ?", (bid,)).fetchone()
    if not row:
        raise ApiError("존재하지 않는 건물이에요.", 404)
    return jsonify(building_dict(db, row))


def _building_payload(data, partial=False):
    out = {}
    if not partial or "name" in data:
        out["name"] = text(data, "name", True, 50)
    for k in ("lat", "lng"):
        if not partial or k in data:
            try:
                out[k] = float(data[k])
            except (KeyError, TypeError, ValueError):
                raise ApiError(f"'{k}' 좌표(숫자)가 필요해요.")
    if "aliases" in data:
        out["aliases"] = json.dumps([str(a) for a in data.get("aliases") or []], ensure_ascii=False)
    if "type" in data:
        out["type"] = text(data, "type", True, 20)
    if "levels" in data:
        levels = data.get("levels")
        if levels is None:
            out["levels_above"], out["levels_below"] = None, None
        else:
            try:
                out["levels_above"], out["levels_below"] = int(levels[0]), int(levels[1] if len(levels) > 1 else 0)
            except (TypeError, ValueError, IndexError):
                raise ApiError("'levels' 는 [지상 층수, 지하 층수] 형태여야 해요.")
    if "elevator" in data:
        out["elevator"] = None if data.get("elevator") is None else (1 if data.get("elevator") else 0)
    if "imageUrl" in data:
        out["image_url"] = data.get("imageUrl") or None
    return out


def _check_floors(floors):
    if floors is None:
        return
    if not isinstance(floors, list):
        raise ApiError("'floors' 는 배열이어야 해요.")
    keys = {r["key"] for r in get_db().execute("SELECT key FROM facility_types")}
    for f in floors:
        if not isinstance(f, dict) or not str(f.get("floor", "")).strip():
            raise ApiError("각 층에는 'floor' 값이 필요해요.")
        bad = [k for k in f.get("facilities", []) if k not in keys]
        if bad:
            raise ApiError(f"알 수 없는 시설 종류: {', '.join(bad)}")


@app.post("/api/buildings")
@auth.admin_required
def create_building():
    data = body()
    bid = text(data, "id", True, 20)
    if not re.fullmatch(r"[A-Za-z0-9_-]+", bid):
        raise ApiError("'id' 는 영문·숫자·_- 만 쓸 수 있어요.")
    p = _building_payload(data)
    _check_floors(data.get("floors"))
    db = get_db()
    if db.execute("SELECT 1 FROM buildings WHERE id = ?", (bid,)).fetchone():
        raise ApiError("이미 있는 건물 id 예요.", 409)
    db.execute("""INSERT INTO buildings (id, name, lat, lng, aliases, type, levels_above, levels_below, elevator, image_url)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
               (bid, p["name"], p["lat"], p["lng"], p.get("aliases", "[]"), p.get("type", "lecture"),
                p.get("levels_above"), p.get("levels_below"), p.get("elevator"), p.get("image_url")))
    save_building_floors(db, bid, data.get("floors"))
    db.commit()
    return get_building(bid), 201


@app.put("/api/buildings/<bid>")
@auth.admin_required
def update_building(bid):
    building_exists(bid)
    data = body()
    p = _building_payload(data, partial=True)
    _check_floors(data.get("floors"))
    db = get_db()
    if p:
        sets = ", ".join(f"{k} = ?" for k in p)
        db.execute(f"UPDATE buildings SET {sets}, updated_at = datetime('now','localtime') WHERE id = ?",
                   (*p.values(), bid))
    if "floors" in data:
        save_building_floors(db, bid, data["floors"])
    db.commit()
    return get_building(bid)


@app.delete("/api/buildings/<bid>")
@auth.admin_required
def delete_building(bid):
    building_exists(bid)
    db = get_db()
    if db.execute("SELECT 1 FROM cafeterias WHERE building_id = ?", (bid,)).fetchone():
        raise ApiError("이 건물에 식당이 있어요. 식당을 먼저 옮기거나 삭제해 주세요.", 409)
    db.execute("DELETE FROM buildings WHERE id = ?", (bid,))
    db.commit()
    return jsonify(ok=True)


# ================================================================
#  식당 / 메뉴
# ================================================================

@app.get("/api/cafeterias")
def list_cafeterias():
    return jsonify([cafeteria_dict(r) for r in get_db().execute("SELECT * FROM cafeterias ORDER BY id")])


@app.post("/api/cafeterias")
@auth.admin_required
def create_cafeteria():
    data = body()
    cid = text(data, "id", True, 20)
    db = get_db()
    if db.execute("SELECT 1 FROM cafeterias WHERE id = ?", (cid,)).fetchone():
        raise ApiError("이미 있는 식당 id 예요.", 409)
    db.execute("INSERT INTO cafeterias (id, name, building_id, floor, hours, price) VALUES (?, ?, ?, ?, ?, ?)",
               (cid, text(data, "name", True, 50), building_exists(text(data, "buildingId", True)),
                text(data, "floor", max_len=10), text(data, "hours", max_len=100), text(data, "price", max_len=50)))
    db.commit()
    return jsonify(cafeteria_dict(db.execute("SELECT * FROM cafeterias WHERE id = ?", (cid,)).fetchone())), 201


@app.put("/api/cafeterias/<cid>")
@auth.admin_required
def update_cafeteria(cid):
    db = get_db()
    row = db.execute("SELECT * FROM cafeterias WHERE id = ?", (cid,)).fetchone()
    if not row:
        raise ApiError("존재하지 않는 식당이에요.", 404)
    data = body()
    cur = cafeteria_dict(row)
    cur.update({k: data[k] for k in ("name", "buildingId", "floor", "hours", "price") if k in data})
    building_exists(cur["buildingId"])
    db.execute("UPDATE cafeterias SET name=?, building_id=?, floor=?, hours=?, price=? WHERE id=?",
               (cur["name"], cur["buildingId"], cur["floor"], cur["hours"], cur["price"], cid))
    db.commit()
    return jsonify(cur)


@app.delete("/api/cafeterias/<cid>")
@auth.admin_required
def delete_cafeteria(cid):
    db = get_db()
    db.execute("DELETE FROM cafeterias WHERE id = ?", (cid,))
    db.commit()
    return jsonify(ok=True)


@app.get("/api/menus")
def list_menus():
    """?from=YYYY-MM-DD&to=YYYY-MM-DD (&cafeteriaId=c1) — 없으면 오늘"""
    today = date.today().isoformat()
    start = valid_date(request.args.get("from", today), "from")
    end = valid_date(request.args.get("to", start), "to")
    sql, args = "SELECT * FROM menus WHERE date BETWEEN ? AND ?", [start, end]
    if request.args.get("cafeteriaId"):
        sql += " AND cafeteria_id = ?"
        args.append(request.args["cafeteriaId"])
    rows = get_db().execute(sql + " ORDER BY date, cafeteria_id, meal", args).fetchall()
    return jsonify([menu_dict(r) for r in rows])


@app.put("/api/menus")
@auth.admin_required
def upsert_menus():
    """메뉴 등록/수정 (여러 개 한 번에). 같은 식당·날짜·끼니가 있으면 덮어씀.
    본문: { "menus": [ { cafeteriaId, date, meal, items: [...] }, ... ] }
    items 가 빈 배열이면 해당 끼니 메뉴를 삭제합니다.
    """
    menus = body().get("menus")
    if not isinstance(menus, list) or not menus:
        raise ApiError("'menus' 배열이 필요해요.")
    db = get_db()
    cafes = {r["id"] for r in db.execute("SELECT id FROM cafeterias")}
    saved = 0
    for m in menus:
        if m.get("cafeteriaId") not in cafes:
            raise ApiError(f"존재하지 않는 식당: {m.get('cafeteriaId')}", 404)
        d = valid_date(m.get("date"))
        meal = choice(m, "meal", ("breakfast", "lunch", "dinner"))
        items = [str(x).strip() for x in (m.get("items") or []) if str(x).strip()]
        if not items:
            db.execute("DELETE FROM menus WHERE cafeteria_id=? AND date=? AND meal=?", (m["cafeteriaId"], d, meal))
            continue
        db.execute(
            """INSERT INTO menus (cafeteria_id, date, meal, items) VALUES (?, ?, ?, ?)
               ON CONFLICT (cafeteria_id, date, meal)
               DO UPDATE SET items = excluded.items, updated_at = datetime('now','localtime')""",
            (m["cafeteriaId"], d, meal, json.dumps(items, ensure_ascii=False)))
        saved += 1
    db.commit()
    return jsonify(ok=True, saved=saved)


# ================================================================
#  일정 (조회는 누구나, 수정은 관리자)
# ================================================================

EVENT_CATS = ("academic", "club", "festival", "event")


def _event_values(data, cur=None):
    """POST 는 전체, PUT 은 보낸 값만 바꿈 (cur: 기존 값)"""
    cur = cur or {}
    v = {
        "cat": choice(data, "cat", EVENT_CATS) if "cat" in data or not cur else cur["cat"],
        "title": text(data, "title", True, 100) if "title" in data or not cur else cur["title"],
        "due": text(data, "due", max_len=30) if "due" in data else cur.get("due", ""),
        "place": text(data, "place", max_len=100) if "place" in data else cur.get("place", ""),
    }
    for key, col in (("start", "start_date"), ("end", "end_date")):
        if key in data:
            v[col] = valid_date(data[key], key) if data[key] else None
        else:
            v[col] = cur.get(col)
    if not (v["start_date"] or v["end_date"]):
        raise ApiError("'start' 나 'end' 중 하나는 있어야 해요.")
    if v["start_date"] and v["end_date"] and v["start_date"] > v["end_date"]:
        raise ApiError("'start' 가 'end' 보다 늦어요.")
    return v


@app.get("/api/events")
def list_events():
    """?cat=academic  ?from=YYYY-MM-DD (그 날 이후 끝나는 일정만)"""
    sql, args = "SELECT * FROM events WHERE 1=1", []
    if request.args.get("cat"):
        sql += " AND cat = ?"
        args.append(choice(request.args, "cat", EVENT_CATS))
    if request.args.get("from"):
        sql += " AND COALESCE(end_date, start_date) >= ?"
        args.append(valid_date(request.args["from"], "from"))
    rows = get_db().execute(sql + " ORDER BY COALESCE(start_date, end_date), id", args).fetchall()
    return jsonify([event_dict(r) for r in rows])


@app.post("/api/events")
@auth.admin_required
def create_event():
    v = _event_values(body())
    db = get_db()
    cur = db.execute("INSERT INTO events (cat, title, start_date, end_date, due, place) VALUES (?,?,?,?,?,?)",
                     (v["cat"], v["title"], v["start_date"], v["end_date"], v["due"], v["place"]))
    db.commit()
    return jsonify(event_dict(db.execute("SELECT * FROM events WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/events/<int:eid>")
@auth.admin_required
def update_event(eid):
    db = get_db()
    row = db.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
    if not row:
        raise ApiError("존재하지 않는 일정이에요.", 404)
    v = _event_values(body(), dict(row))
    db.execute("""UPDATE events SET cat=?, title=?, start_date=?, end_date=?, due=?, place=?,
                  updated_at=datetime('now','localtime') WHERE id=?""",
               (v["cat"], v["title"], v["start_date"], v["end_date"], v["due"], v["place"], eid))
    db.commit()
    return jsonify(event_dict(db.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()))


@app.delete("/api/events/<int:eid>")
@auth.admin_required
def delete_event(eid):
    db = get_db()
    if db.execute("DELETE FROM events WHERE id = ?", (eid,)).rowcount == 0:
        raise ApiError("존재하지 않는 일정이에요.", 404)
    db.commit()
    return jsonify(ok=True)


# ================================================================
#  학생 참여: 혼잡도 · 평가 (계산은 feedback.py)
#  결과는 GET /api/buildings 의 crowd, rating 에도 같이 들어감
# ================================================================

crowd_limiter = RateLimiter(per_ip=(30, 60), total=(20000, 86400))
review_limiter = RateLimiter(per_ip=(5, 3600), total=(2000, 86400))


def client_ip():
    # 배포 서비스(프록시) 뒤에서는 TRUST_PROXY=1 로 켜야 실제 사용자 IP 를 봄
    if os.environ.get("TRUST_PROXY") == "1" and request.headers.get("X-Forwarded-For"):
        return request.headers["X-Forwarded-For"].split(",")[0].strip()
    return request.remote_addr or "unknown"


def client_key():
    """같은 사람인지 구분하는 값. IP 를 그대로 저장하지 않고 암호화해서 앞 16자리만 씀"""
    raw = (app.config["SECRET_KEY"] + client_ip()).encode()
    return hashlib.sha256(raw).hexdigest()[:16]


def limited(limiter):
    ok, retry = limiter.hit(client_ip())
    if not ok:
        res = jsonify(error="요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
        res.headers["Retry-After"] = str(retry)
        return res, 429
    return None


@app.post("/api/buildings/<bid>/crowd")
def vote_crowd(bid):
    """본문: { level: "busy" | "calm" } → { crowd }"""
    building_exists(bid)
    level = choice(body(), "level", ("busy", "calm"))
    blocked = limited(crowd_limiter)
    if blocked:
        return blocked
    db = get_db()
    feedback.add_crowd_vote(db, bid, level, client_key())
    db.commit()
    return jsonify(crowd=feedback.crowd_summary(db, bid))


@app.delete("/api/buildings/<bid>/crowd")
@auth.admin_required
def reset_crowd(bid):
    building_exists(bid)
    db = get_db()
    n = db.execute("DELETE FROM crowd_votes WHERE building_id = ?", (bid,)).rowcount
    db.commit()
    return jsonify(ok=True, deleted=n)


def _score(scores, key):
    v = scores.get(key)
    if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 5:
        raise ApiError(f"'scores.{key}' 는 1~5 사이 정수여야 해요.")
    return v


@app.get("/api/buildings/<bid>/reviews")
def building_reviews(bid):
    building_exists(bid)
    rows = get_db().execute("SELECT * FROM reviews WHERE building_id = ? ORDER BY id DESC", (bid,)).fetchall()
    return jsonify([feedback.review_dict(r) for r in rows])


@app.post("/api/buildings/<bid>/reviews")
def create_review(bid):
    """본문: { scores: {facility, clean, space} (1~5), text?: "한줄평" } → { review, rating }"""
    building_exists(bid)
    data = body()
    scores = data.get("scores")
    if not isinstance(scores, dict):
        raise ApiError("'scores' 가 필요해요. 예: {\"facility\": 4, \"clean\": 5, \"space\": 3}")
    vals = [_score(scores, k) for k, _ in feedback.REVIEW_PARTS]
    review_text = text(data, "text", max_len=300)
    blocked = limited(review_limiter)
    if blocked:
        return blocked
    db = get_db()
    cur = db.execute("INSERT INTO reviews (building_id, facility, clean, space, text, client) VALUES (?,?,?,?,?,?)",
                     (bid, *vals, review_text, client_key()))
    db.commit()
    row = db.execute("SELECT * FROM reviews WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(review=feedback.review_dict(row), rating=feedback.rating_summary(db, bid)), 201


@app.get("/api/reviews")
@auth.admin_required
def all_reviews():
    """관리자 화면용 전체 평가 목록. ?buildingId= 로 거르기"""
    sql, args = "SELECT * FROM reviews", []
    if request.args.get("buildingId"):
        sql += " WHERE building_id = ?"
        args.append(request.args["buildingId"])
    return jsonify([feedback.review_dict(r) for r in get_db().execute(sql + " ORDER BY id DESC", args)])


@app.delete("/api/reviews/<int:rid>")
@auth.admin_required
def delete_review(rid):
    db = get_db()
    if db.execute("DELETE FROM reviews WHERE id = ?", (rid,)).rowcount == 0:
        raise ApiError("존재하지 않는 평가예요.", 404)
    db.commit()
    return jsonify(ok=True)


# ================================================================
#  분실물
# ================================================================

@app.get("/api/lost")
def list_lost():
    """기본: 해결 안 된 것만. ?all=1 이면 전체"""
    sql = "SELECT * FROM lost_items"
    if request.args.get("all") != "1":
        sql += " WHERE resolved = 0"
    return jsonify([lost_dict(r) for r in get_db().execute(sql + " ORDER BY date DESC, id DESC")])


@app.post("/api/lost")
def create_lost():
    data = body()
    db = get_db()
    cur = db.execute(
        "INSERT INTO lost_items (type, title, building_id, place, description, contact, image_url) VALUES (?,?,?,?,?,?,?)",
        (choice(data, "type", ("lost", "found")), text(data, "title", True, 100),
         building_exists(text(data, "buildingId")), text(data, "place", max_len=100),
         text(data, "desc", max_len=1000), text(data, "contact", max_len=200), data.get("imageUrl") or None))
    db.commit()
    return jsonify(lost_dict(db.execute("SELECT * FROM lost_items WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.patch("/api/lost/<int:lid>")
@auth.admin_required
def update_lost(lid):
    db = get_db()
    db.execute("UPDATE lost_items SET resolved = ? WHERE id = ?", (1 if body().get("resolved") else 0, lid))
    db.commit()
    row = db.execute("SELECT * FROM lost_items WHERE id = ?", (lid,)).fetchone()
    if not row:
        raise ApiError("존재하지 않는 분실물이에요.", 404)
    return jsonify(lost_dict(row))


@app.delete("/api/lost/<int:lid>")
@auth.admin_required
def delete_lost(lid):
    db = get_db()
    db.execute("DELETE FROM lost_items WHERE id = ?", (lid,))
    db.commit()
    return jsonify(ok=True)


# ================================================================
#  수정 제보 → 관리자 승인
# ================================================================

@app.get("/api/reports")
def list_reports():
    """?status=pending|done|rejected 로 거르기 가능 (관리자 승인 화면용)"""
    sql, args = "SELECT * FROM reports", []
    if request.args.get("status"):
        sql += " WHERE status = ?"
        args.append(request.args["status"])
    return jsonify([report_dict(r) for r in get_db().execute(sql + " ORDER BY id", args)])


@app.post("/api/reports")
def create_report():
    data = body()
    db = get_db()
    cur = db.execute(
        "INSERT INTO reports (kind, building_id, floor, content, image_url) VALUES (?,?,?,?,?)",
        (choice(data, "kind", ("new", "edit", "menu", "etc"), "etc"), building_exists(text(data, "buildingId")),
         text(data, "floor", max_len=10), text(data, "content", True, 1000), data.get("imageUrl") or None))
    db.commit()
    return jsonify(report_dict(db.execute("SELECT * FROM reports WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.patch("/api/reports/<int:rid>")
@auth.admin_required
def review_report(rid):
    """본문: { status: "done" | "rejected" | "pending", adminNote?: "..." }
    ※ 실제 건물 정보 반영은 PUT /api/buildings/<id> 로 따로 합니다."""
    data = body()
    status = choice(data, "status", ("pending", "done", "rejected"))
    db = get_db()
    cur = db.execute(
        "UPDATE reports SET status=?, admin_note=?, reviewed_by=?, reviewed_at=datetime('now','localtime') WHERE id=?",
        (status, text(data, "adminNote", max_len=500), g.user["id"], rid))
    if cur.rowcount == 0:
        raise ApiError("존재하지 않는 제보예요.", 404)
    db.commit()
    return jsonify(report_dict(db.execute("SELECT * FROM reports WHERE id = ?", (rid,)).fetchone()))


# ================================================================
#  사진 업로드 (분실물·제보·건물 사진 공용)
# ================================================================

@app.post("/api/uploads")
def upload():
    """multipart/form-data, 필드 이름: file → { url: "/uploads/xxxx.jpg" }"""
    f = request.files.get("file")
    if not f or not f.filename:
        raise ApiError("'file' 이 필요해요.")
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED_IMAGE:
        raise ApiError("이미지 파일(jpg, png, gif, webp, heic)만 올릴 수 있어요.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    f.save(UPLOAD_DIR / name)
    return jsonify(url=f"/uploads/{name}"), 201


@app.get("/uploads/<path:name>")
def uploaded(name):
    return send_from_directory(UPLOAD_DIR, name)


# ================================================================
#  길찾기: 차량 이동 시간 (네이버 Directions 5, 실시간 교통) → routing.py
# ================================================================

CAMPUS = (36.8397504, 127.1850643)


def _point(name):
    try:
        lat, lng = (float(x) for x in request.args.get(name, "").split(","))
    except ValueError:
        raise ApiError(f"{name} 는 '위도,경도' 형식이어야 해요")
    # 캠퍼스 근처(약 5km)만 허용 → 키를 다른 용도로 쓰지 못하게
    if abs(lat - CAMPUS[0]) > 0.045 or abs(lng - CAMPUS[1]) > 0.056:
        raise ApiError("캠퍼스 근처 위치만 찾을 수 있어요")
    return lat, lng


@app.get("/api/route")
def route():
    """?from=위도,경도&to=위도,경도 → {carMin, distanceM, at, source: "naver"}"""
    a, b = _point("from"), _point("to")
    try:
        return jsonify(source="naver", **routing.driving(a[0], a[1], b[0], b[1]))
    except routing.RouteError as e:
        raise ApiError(str(e), 503)


# ================================================================
#  챗봇 (4번 담당: chatbot.py 의 answer() 를 교체)
# ================================================================

@app.post("/api/chat")
def chat():
    data = body()
    message = text(data, "message", True, 300)
    result = chatbot.answer(get_db(), message, data.get("userPos"))
    db = get_db()
    db.execute("INSERT INTO chat_logs (message, answer) VALUES (?, ?)", (message, result.get("text", "")))
    db.commit()
    return jsonify(result)


# ================================================================
#  웹(프론트) 파일 제공
# ================================================================

@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:path>")
def web_files(path):
    if path.startswith("api/"):
        raise ApiError("없는 API 주소예요.", 404)
    return send_from_directory(WEB_DIR, path)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=os.environ.get("DEBUG") == "1")
