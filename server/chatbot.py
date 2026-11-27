"""
서버 챗봇 (기본 규칙 버전)
★ 4번(AI 챗봇) 담당이 이 파일의 answer() 를 LLM 버전으로 교체하면 됩니다.

약속(인터페이스):
    answer(db, message, user_pos) -> {"text": str, "buildingId": str | None}
      - db: sqlite3 연결 (db.py 의 변환 함수 사용 가능)
      - user_pos: {"lat": float, "lng": float} 또는 None
      - buildingId 를 넣으면 앱에서 "지도에서 보기" 버튼이 생깁니다.

LLM API 키는 환경변수(예: OPENAI_API_KEY / ANTHROPIC_API_KEY)로만 읽고, 코드에 넣지 마세요.
"""
import json
from datetime import date, datetime, timedelta

DAY = ["월", "화", "수", "목", "금", "토", "일"]


def _has(t, words):
    return any(w in t for w in words)


def _menu(db, t):
    d = date.today()
    label = "오늘"
    if "내일" in t:
        d, label = d + timedelta(days=1), "내일"
    if _has(t, ["저녁", "석식"]):
        meal = "dinner"
    elif _has(t, ["점심", "중식"]):
        meal = "lunch"
    else:
        meal = "dinner" if datetime.now().hour >= 15 else "lunch"
    rows = db.execute(
        """SELECT c.name, m.items FROM cafeterias c
           LEFT JOIN menus m ON m.cafeteria_id = c.id AND m.date = ? AND m.meal = ?
           ORDER BY c.id""", (d.isoformat(), meal)).fetchall()
    lines = [f"• {r['name']}\n   {', '.join(json.loads(r['items'])) if r['items'] else '등록된 메뉴 없음'}" for r in rows]
    meal_label = "점심" if meal == "lunch" else "저녁"
    return {"text": f"🍚 {label}({DAY[d.weekday()]}) {meal_label} 메뉴예요.\n" + "\n".join(lines)}


def _facility(db, t):
    for f in db.execute("SELECT key, label FROM facility_types"):
        if f["label"] in t:
            rows = db.execute(
                """SELECT b.id, b.name, fl.floor FROM floor_facilities ff
                   JOIN floors fl ON fl.id = ff.floor_id JOIN buildings b ON b.id = fl.building_id
                   WHERE ff.facility_key = ? ORDER BY b.id, fl.sort_order""", (f["key"],)).fetchall()
            if not rows:
                return {"text": f"등록된 {f['label']} 정보가 아직 없어요."}
            return {"text": f"{f['label']} 위치예요.\n" + "\n".join(f"• {r['name']} {r['floor']}" for r in rows),
                    "buildingId": rows[0]["id"]}
    return None


def _building(db, t):
    for b in db.execute("SELECT id, name, aliases FROM buildings"):
        names = [b["name"], *json.loads(b["aliases"] or "[]")]
        if any(n and n in t for n in names):
            floors = db.execute("SELECT floor, note FROM floors WHERE building_id = ? ORDER BY sort_order", (b["id"],))
            lines = [f"• {f['floor']}{' - ' + f['note'] if f['note'] else ''}" for f in floors]
            return {"text": f"🏢 {b['name']} 층별 정보예요.\n" + "\n".join(lines), "buildingId": b["id"]}
    return None


def answer(db, message, user_pos=None):
    t = message.replace(" ", "")
    if _has(t, ["학식", "메뉴", "밥", "점심", "저녁", "중식", "석식", "뭐먹"]):
        return _menu(db, t)
    return (_facility(db, t) or _building(db, t) or
            {"text": "잘 이해하지 못했어요 😅\n예) 오늘 점심 뭐야? / 프린터 어디 있어? / 도서관 층별 정보"})
