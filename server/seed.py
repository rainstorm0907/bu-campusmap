"""
DB 초기화 + 예시 데이터 + 관리자 계정 생성

    python seed.py                       # DB 가 없을 때만 생성
    python seed.py --reset               # DB 를 지우고 새로 생성
    ADMIN_PASSWORD=비번 python seed.py    # 관리자 비밀번호 지정 (기본: admin1234)

예시 데이터는 web/js/data.js 와 같은 내용입니다.
실제 학교 자료가 더 모이면 아래 BUILDINGS / CAFETERIAS 를 교체하거나,
관리자 API(POST /api/buildings 등)로 넣으면 됩니다.
DB 구조(schema.sql)가 바뀌었으면 --reset 으로 다시 만드세요.
"""
import json
import os
import sys

from auth import hash_password
import menu_auto
from db import DB_PATH, connect, init_schema, save_building_floors

# ※ 아래 값은 web/js/data.js 와 같은 내용입니다. 한쪽을 바꾸면 다른 쪽도 같이 바꿔 주세요.
#   건물 좌표는 OpenStreetMap 의 백석대학교 건물 위치, 식당 이름·층·운영시간은 2번(데이터 담당) 자료.
FACILITY_TYPES = [('convenience', '편의점'),
 ('cafe', '카페'),
 ('printer', '프린터'),
 ('atm', 'ATM'),
 ('lounge', '라운지'),
 ('restroom', '화장실'),
 ('water', '정수기')]

BUILDINGS = [{'id': 'seungri',
  'name': '승리관',
  'lat': 36.841763,
  'lng': 127.185758,
  'aliases': [],
  'type': 'lecture',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['printer', 'restroom'], 'note': '', 'places': []},
             {'floor': '2층', 'facilities': ['water'], 'note': '', 'places': []}]},
 {'id': 'gym',
  'name': '체육관',
  'lat': 36.841366,
  'lng': 127.187434,
  'aliases': [],
  'type': 'sport',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['restroom', 'water'], 'note': '', 'places': []}]},
 {'id': 'johyung',
  'name': '조형관',
  'lat': 36.840894,
  'lng': 127.188438,
  'aliases': [],
  'type': 'art',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['cafe'], 'note': '', 'places': []},
             {'floor': '2층', 'facilities': ['restroom'], 'note': '', 'places': []}]},
 {'id': 'mokyang',
  'name': '목양관',
  'lat': 36.840874,
  'lng': 127.183654,
  'aliases': [],
  'type': 'lecture',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['atm', 'restroom'], 'note': '', 'places': []},
             {'floor': '2층', 'facilities': ['printer'], 'note': '', 'places': []}]},
 {'id': 'bokji',
  'name': '학생복지관',
  'lat': 36.840597,
  'lng': 127.182496,
  'aliases': ['복지관'],
  'type': 'food',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '지하 1층', 'facilities': ['convenience'], 'note': '편의점 08:00~22:00', 'places': ['편의점', '밀겨울']},
             {'floor': '1층', 'facilities': ['cafe', 'lounge'], 'note': '', 'places': []},
             {'floor': '2층', 'facilities': ['printer', 'restroom'], 'note': '', 'places': []}]},
 {'id': 'jinri',
  'name': '진리관',
  'lat': 36.840169,
  'lng': 127.184518,
  'aliases': [],
  'type': 'lecture',
  'levels': [5, 1],
  'elevator': False,
  'floors': [{'floor': '1층', 'facilities': [], 'note': '', 'places': ['서점', '문구점', '신한은행', '우편취급국', '보건실']},
             {'floor': '지하 1층', 'facilities': ['convenience'], 'note': '', 'places': ['편의점']}]},
 {'id': 'gyosu',
  'name': '교수회관',
  'lat': 36.839697,
  'lng': 127.184804,
  'aliases': [],
  'type': 'office',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['restroom'], 'note': '', 'places': ['교수회관 식당']}]},
 {'id': 'baekseokhall',
  'name': '백석홀',
  'lat': 36.839572,
  'lng': 127.182658,
  'aliases': [],
  'type': 'hall',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['cafe', 'restroom'], 'note': '', 'places': []}]},
 {'id': 'insung',
  'name': '인성관',
  'lat': 36.839405,
  'lng': 127.183558,
  'aliases': [],
  'type': 'lecture',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['printer'], 'note': '', 'places': []},
             {'floor': '2층', 'facilities': ['lounge', 'water'], 'note': '', 'places': []}]},
 {'id': 'bonbu',
  'name': '본부동',
  'lat': 36.83934,
  'lng': 127.185784,
  'aliases': [],
  'type': 'office',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['atm', 'restroom'], 'note': '학사지원팀', 'places': []},
             {'floor': '2층', 'facilities': ['water'], 'note': '', 'places': []}]},
 {'id': 'jihye',
  'name': '지혜관',
  'lat': 36.838751,
  'lng': 127.184338,
  'aliases': [],
  'type': 'lecture',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['printer', 'cafe'], 'note': '', 'places': []},
             {'floor': '2층', 'facilities': ['convenience', 'lounge'], 'note': '', 'places': []}]},
 {'id': 'art',
  'name': '예술대학동',
  'lat': 36.838723,
  'lng': 127.187577,
  'aliases': [],
  'type': 'art',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['restroom', 'water'], 'note': '', 'places': []}]},
 {'id': 'jayu',
  'name': '자유관',
  'lat': 36.838462,
  'lng': 127.183223,
  'aliases': [],
  'type': 'lecture',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['printer', 'water'], 'note': '', 'places': []}]},
 {'id': 'library',
  'name': '백석학술정보관',
  'lat': 36.837766,
  'lng': 127.184041,
  'aliases': ['도서관', '학술정보관'],
  'type': 'library',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['cafe', 'printer', 'water'], 'note': '대출, 반납', 'places': []},
             {'floor': '3층', 'facilities': ['lounge', 'restroom'], 'note': '열람실', 'places': []}]},
 {'id': 'global',
  'name': '글로벌 외식산업관',
  'lat': 36.837551,
  'lng': 127.185125,
  'aliases': ['외식산업관'],
  'type': 'food',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['convenience', 'atm'], 'note': '', 'places': ['안골식당']},
             {'floor': '2층', 'facilities': ['cafe'], 'note': '', 'places': []}]},
 {'id': 'dorm',
  'name': '백석생활관',
  'lat': 36.842568,
  'lng': 127.185143,
  'aliases': ['생활관', '기숙사'],
  'type': 'dorm',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': [], 'note': '', 'places': ['백석생활관 식당']}]},
 {'id': 'changjo',
  'name': '창조관',
  'lat': 36.837402,
  'lng': 127.182419,
  'aliases': [],
  'type': 'lecture',
  'levels': None,
  'elevator': None,
  'floors': [{'floor': '1층', 'facilities': ['atm'], 'note': '', 'places': []},
             {'floor': '4층', 'facilities': ['printer', 'lounge'], 'note': '실습실', 'places': []}]}]

CAFETERIAS = [{'id': 'c1', 'name': '백석생활관 식당', 'buildingId': 'dorm', 'floor': '1층', 'hours': '11:00 ~ 18:00', 'price': ''},
 {'id': 'c2', 'name': '교수회관 식당', 'buildingId': 'gyosu', 'floor': '1층', 'hours': '08:30 ~ 17:00', 'price': ''},
 {'id': 'c3', 'name': '안골식당', 'buildingId': 'global', 'floor': '1층', 'hours': '10:30 ~ 14:00', 'price': ''},
 {'id': 'c4', 'name': '밀겨울', 'buildingId': 'bokji', 'floor': '지하 1층', 'hours': '08:30 ~ 17:00', 'price': ''}]

LOST_ITEMS = [('found', '파란색 텀블러', 'library', '3층 열람실', '', '도서관 안내데스크'), ('lost', '학생증', 'jihye', '2층 편의점 근처', '이름 김OO', '오픈채팅')]


def seed(conn):
    conn.executemany("INSERT OR IGNORE INTO facility_types (key, label) VALUES (?, ?)", FACILITY_TYPES)
    for b in BUILDINGS:
        levels = b["levels"] or [None, None]
        elevator = None if b["elevator"] is None else int(b["elevator"])
        conn.execute(
            """INSERT INTO buildings (id, name, lat, lng, aliases, type, levels_above, levels_below, elevator)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (b["id"], b["name"], b["lat"], b["lng"], json.dumps(b["aliases"], ensure_ascii=False), b["type"],
             levels[0], levels[1], elevator))
        save_building_floors(conn, b["id"], b["floors"])

    for c in CAFETERIAS:
        conn.execute("INSERT INTO cafeterias (id, name, building_id, floor, hours, price) VALUES (?,?,?,?,?,?)",
                     (c["id"], c["name"], c["buildingId"], c["floor"], c["hours"], c["price"]))
    menu_auto.fill_week(conn)  # 이번 주 메뉴 (서버가 켜져 있으면 날짜가 바뀔 때마다 다시 채움)

    conn.executemany(
        "INSERT INTO lost_items (type, title, building_id, place, description, contact) VALUES (?,?,?,?,?,?)",
        LOST_ITEMS)

    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin1234")
    conn.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')",
                 (username, hash_password(password)))
    conn.commit()
    print(f"관리자 계정: {username} / {password}  (배포 전 꼭 ADMIN_PASSWORD 로 바꾸세요)")


if __name__ == "__main__":
    if "--reset" in sys.argv and DB_PATH.exists():
        DB_PATH.unlink()
    if DB_PATH.exists():
        print(f"이미 DB 가 있어요: {DB_PATH}  (다시 만들려면 --reset)")
        sys.exit(0)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = connect()
    init_schema(conn)
    seed(conn)
    print(f"DB 생성 완료: {DB_PATH}")
