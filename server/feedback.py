"""
학생 참여 데이터: 혼잡도 · 평가

화면이 원래 쓰던 모양 그대로 만들어 준다 (web/js/app.js 의 b.crowd, b.rating).

    crowd  = {"level": "busy", "label": "조금 붐벼요", "minutesAgo": 5, "confirms": 7, "votes": 9}
    rating = {"score": 4.1, "count": 12,
              "parts": [["시설 상태", 4.2], ["깨끗함", 4.3], ["자리 여유", 2.6]],
              "reviews": [["2026학년도 2학기, 3일 전", "콘센트가 많아요"], ...]}
"""
from datetime import datetime

CROWD_WINDOW_MIN = 60       # 최근 60분 동안 누른 것만 반영
CROWD_REVOTE_MIN = 10       # 같은 사람이 같은 건물에 10분 안에 다시 누르면 새로 세지 않고 바꿈
REVIEW_PARTS = [("facility", "시설 상태"), ("clean", "깨끗함"), ("space", "자리 여유")]
REVIEWS_SHOWN = 20          # 건물 화면에 보여줄 최근 한줄평 수

CROWD_LABELS = {"busy": "붐벼요", "busy_some": "조금 붐벼요", "calm": "한산해요"}


def _parse(ts):
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")


def _ago_sql(minutes):
    return f"datetime('now', 'localtime', '-{int(minutes)} minutes')"


# ---------------------------------------------------------------- 혼잡도

def add_crowd_vote(conn, building_id, level, client):
    """같은 사람이 10분 안에 다시 누르면 이전 표를 고친다 (한 사람이 여러 번 눌러 숫자 부풀리기 방지)"""
    prev = conn.execute(
        f"""SELECT id FROM crowd_votes WHERE building_id = ? AND client = ? AND created_at >= {_ago_sql(CROWD_REVOTE_MIN)}
            ORDER BY id DESC LIMIT 1""", (building_id, client)).fetchone()
    if prev:
        conn.execute("UPDATE crowd_votes SET level = ?, created_at = datetime('now','localtime') WHERE id = ?",
                     (level, prev["id"]))
    else:
        conn.execute("INSERT INTO crowd_votes (building_id, level, client) VALUES (?, ?, ?)",
                     (building_id, level, client))


def crowd_summary(conn, building_id):
    """최근 60분 표가 없으면 None (화면은 '지금 붐벼요 / 한산해요' 버튼만 보여줌)"""
    rows = conn.execute(
        f"""SELECT level, created_at FROM crowd_votes
            WHERE building_id = ? AND created_at >= {_ago_sql(CROWD_WINDOW_MIN)}""", (building_id,)).fetchall()
    if not rows:
        return None
    busy = sum(1 for r in rows if r["level"] == "busy")
    calm = len(rows) - busy
    if busy > calm:
        level, label = "busy", CROWD_LABELS["busy"] if busy >= 2 * max(calm, 1) else CROWD_LABELS["busy_some"]
    elif calm > busy:
        level, label = "calm", CROWD_LABELS["calm"]
    else:  # 동점이면 가장 최근 표를 따름
        latest = max(rows, key=lambda r: r["created_at"])
        level = latest["level"]
        label = CROWD_LABELS["busy_some"] if level == "busy" else CROWD_LABELS["calm"]
    newest = max(_parse(r["created_at"]) for r in rows)
    return {
        "level": level, "label": label,
        "minutesAgo": max(0, int((datetime.now() - newest).total_seconds() // 60)),
        "confirms": busy if level == "busy" else calm,
        "votes": len(rows),
    }


# ---------------------------------------------------------------- 평가

def semester_label(d):
    """3~8월 = 1학기, 9~2월 = 2학기 (1·2월은 전년도 2학기)"""
    if 3 <= d.month <= 8:
        return f"{d.year}학년도 1학기"
    return f"{d.year if d.month >= 9 else d.year - 1}학년도 2학기"


def relative_label(d, now=None):
    days = ((now or datetime.now()).date() - d.date()).days
    if days <= 0:
        return "오늘"
    if days < 7:
        return f"{days}일 전"
    if days < 30:
        return f"{days // 7}주 전"
    if days < 365:
        return f"{days // 30}개월 전"
    return f"{days // 365}년 전"


def when_label(ts):
    d = _parse(ts)
    return f"{semester_label(d)}, {relative_label(d)}"


def review_dict(row):
    return {
        "id": row["id"], "buildingId": row["building_id"],
        "scores": {k: row[k] for k, _ in REVIEW_PARTS},
        "text": row["text"], "date": row["created_at"][:10], "when": when_label(row["created_at"]),
    }


def rating_summary(conn, building_id):
    """평가가 하나도 없으면 None (화면은 '아직 평가가 없어요')"""
    agg = conn.execute(
        "SELECT COUNT(*) AS n, AVG(facility) AS facility, AVG(clean) AS clean, AVG(space) AS space "
        "FROM reviews WHERE building_id = ?", (building_id,)).fetchone()
    if not agg["n"]:
        return None
    parts = [[label, round(agg[key], 1)] for key, label in REVIEW_PARTS]
    texts = conn.execute(
        "SELECT created_at, text FROM reviews WHERE building_id = ? AND text != '' ORDER BY id DESC LIMIT ?",
        (building_id, REVIEWS_SHOWN)).fetchall()
    return {
        "score": round(sum(agg[k] for k, _ in REVIEW_PARTS) / len(REVIEW_PARTS), 1),
        "count": agg["n"],
        "parts": parts,
        "reviews": [[when_label(r["created_at"]), r["text"]] for r in texts],
    }
