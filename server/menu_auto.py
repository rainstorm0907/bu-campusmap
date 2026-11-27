"""
학식 메뉴 자동 채우기
- 2번(데이터 담당)이 만든 update_menu.py 를 이 서버(SQLite)로 옮긴 것.
- 실제 메뉴를 가져오는 방법(크롤링 또는 관리자 직접 입력)을 정하기 전까지 무작위 메뉴를 넣는다.
    - 같은 (날짜, 식당)은 항상 같은 메뉴, 날짜가 바뀌면 다른 메뉴
    - 주말 미운영, 점심만
- 비어 있는 칸만 채운다. 관리자가 PUT /api/menus 로 넣은 메뉴는 덮어쓰지 않는다.
- 서버(app.py)가 날짜가 바뀐 뒤 첫 요청에서 fill_week() 를 부른다. 직접 돌릴 때: python menu_auto.py
- 실제 메뉴를 쓰게 되면 fetch_menus() 만 바꾸면 된다.
"""
import json
import random
from datetime import date, timedelta

MEAL = "lunch"

RICE = ["쌀밥", "흑미밥", "잡곡밥", "보리밥", "기장밥"]
SOUP = ["된장국", "미역국", "콩나물국", "어묵국", "북엇국", "김치찌개", "순두부찌개", "부대찌개",
        "육개장", "떡국", "미소국", "감자국", "청국장", "소고기무국"]
MAIN = ["제육볶음", "돈까스", "닭갈비", "불고기", "고등어구이", "치킨마요", "오징어볶음", "갈비찜",
        "닭볶음탕", "함박스테이크", "탕수육", "생선까스", "카레", "떡갈비", "훈제오리", "마파두부"]
SIDE = ["계란말이", "시금치나물", "감자조림", "어묵볶음", "잡채", "두부조림", "멸치볶음", "콩나물무침",
        "김말이튀김", "오이무침", "숙주나물", "메추리알장조림", "샐러드", "떡볶이", "도라지무침"]
KIMCHI = ["배추김치", "깍두기", "총각김치", "열무김치", "단무지"]


def random_menu(cafeteria_id, target):
    """밥 + 국 + 메인 + 반찬 2개 + 김치 (같은 입력이면 항상 같은 결과)"""
    rng = random.Random(f"{target.isoformat()}-{cafeteria_id}-{MEAL}")
    return [rng.choice(RICE), rng.choice(SOUP), rng.choice(MAIN), *rng.sample(SIDE, 2), rng.choice(KIMCHI)]


def fetch_menus(conn, target):
    """해당 날짜 메뉴: [{"cafeteria_id": "c1", "meal": "lunch", "items": [...]}, ...]"""
    if target.weekday() >= 5:  # 주말 미운영
        return []
    ids = [r[0] for r in conn.execute("SELECT id FROM cafeterias ORDER BY id")]
    return [{"cafeteria_id": cid, "meal": MEAL, "items": random_menu(cid, target)} for cid in ids]


def week_days(today=None):
    """화면에 보이는 주의 월~금. 주말이면 화면처럼 다음 주 월~금"""
    today = today or date.today()
    monday = today - timedelta(days=today.weekday())
    if today.weekday() >= 5:
        monday += timedelta(days=7)
    return [monday + timedelta(days=d) for d in range(5)]


def fill_week(conn, today=None):
    """이번 주 빈 메뉴를 채우고 넣은 개수를 돌려준다"""
    count = 0
    for d in week_days(today):
        for m in fetch_menus(conn, d):
            cur = conn.execute("INSERT OR IGNORE INTO menus (cafeteria_id, date, meal, items) VALUES (?, ?, ?, ?)",
                               (m["cafeteria_id"], d.isoformat(), m["meal"], json.dumps(m["items"], ensure_ascii=False)))
            count += cur.rowcount
    conn.commit()
    return count


if __name__ == "__main__":
    from db import connect
    days = week_days()
    print(f"{days[0]} ~ {days[-1]}: 메뉴 {fill_week(connect())}건 채움")
