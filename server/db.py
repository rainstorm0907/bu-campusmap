"""DB 연결·초기화·변환 함수 (공통)"""
import json
import os
import sqlite3
from pathlib import Path

from flask import g

import feedback

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("CAMPUS_DB", BASE_DIR / "campus.db"))


def connect(path=None):
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """요청마다 하나의 연결 (요청이 끝나면 app.py 에서 닫음)"""
    if "db" not in g:
        g.db = connect()
    return g.db


def close_db(_=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_schema(conn):
    conn.executescript((BASE_DIR / "schema.sql").read_text(encoding="utf-8"))
    conn.commit()


# ---------------------------------------------------------------
#  DB 행 → 프론트엔드(js) 형태로 변환
#  ※ 프론트는 camelCase(buildingId 등)를 사용하므로 여기서 맞춰줌
# ---------------------------------------------------------------

def building_dict(conn, row):
    floors = conn.execute(
        "SELECT id, floor, note, places FROM floors WHERE building_id = ? ORDER BY sort_order, id", (row["id"],)
    ).fetchall()
    out_floors = []
    for f in floors:
        keys = [r["facility_key"] for r in conn.execute(
            "SELECT facility_key FROM floor_facilities WHERE floor_id = ? ORDER BY facility_key", (f["id"],))]
        floor = {"floor": f["floor"], "facilities": keys, "note": f["note"]}
        places = json.loads(f["places"] or "[]")
        if places:
            floor["places"] = places
        out_floors.append(floor)
    out = {
        "id": row["id"], "name": row["name"], "aliases": json.loads(row["aliases"] or "[]"),
        "lat": row["lat"], "lng": row["lng"], "type": row["type"], "imageUrl": row["image_url"], "floors": out_floors,
    }
    # 모르는 값은 빼서 보낸다 (화면은 없으면 표시하지 않음)
    if row["levels_above"] is not None:
        out["levels"] = [row["levels_above"], row["levels_below"] or 0]
    if row["elevator"] is not None:
        out["elevator"] = bool(row["elevator"])
    # 학생 참여 데이터 (없으면 키를 빼서 보냄)
    crowd = feedback.crowd_summary(conn, row["id"])
    if crowd:
        out["crowd"] = crowd
    rating = feedback.rating_summary(conn, row["id"])
    if rating:
        out["rating"] = rating
    return out


def cafeteria_dict(row):
    return {
        "id": row["id"], "name": row["name"], "buildingId": row["building_id"],
        "floor": row["floor"], "hours": row["hours"], "price": row["price"],
    }


def menu_dict(row):
    return {
        "cafeteriaId": row["cafeteria_id"], "date": row["date"], "meal": row["meal"],
        "items": json.loads(row["items"] or "[]"),
    }


def lost_dict(row):
    return {
        "id": row["id"], "type": row["type"], "title": row["title"], "buildingId": row["building_id"],
        "place": row["place"], "desc": row["description"], "contact": row["contact"],
        "imageUrl": row["image_url"], "resolved": bool(row["resolved"]), "date": row["date"],
    }


def report_dict(row):
    return {
        "id": row["id"], "kind": row["kind"], "buildingId": row["building_id"], "floor": row["floor"],
        "content": row["content"], "imageUrl": row["image_url"], "status": row["status"],
        "adminNote": row["admin_note"], "date": row["date"], "reviewedAt": row["reviewed_at"],
    }


def save_building_floors(conn, building_id, floors):
    """건물의 층/시설 정보를 통째로 교체"""
    conn.execute("DELETE FROM floors WHERE building_id = ?", (building_id,))
    for i, f in enumerate(floors or []):
        cur = conn.execute(
            "INSERT INTO floors (building_id, floor, note, places, sort_order) VALUES (?, ?, ?, ?, ?)",
            (building_id, f["floor"], f.get("note", ""), json.dumps(f.get("places") or [], ensure_ascii=False), i),
        )
        for key in f.get("facilities", []):
            conn.execute("INSERT OR IGNORE INTO floor_facilities (floor_id, facility_key) VALUES (?, ?)",
                         (cur.lastrowid, key))


def event_dict(row):
    """값이 없는 키는 빼고 보낸다 (화면은 없으면 표시하지 않음)"""
    out = {"id": row["id"], "cat": row["cat"], "title": row["title"], "start": row["start_date"],
           "end": row["end_date"], "due": row["due"], "place": row["place"]}
    return {k: v for k, v in out.items() if v not in (None, "")}
