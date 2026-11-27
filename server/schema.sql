-- 캠퍼스맵 DB 스키마 (SQLite)
-- 담당: 1번 (DB 및 서버 공통 기능)

PRAGMA foreign_keys = ON;

-- 관리자 계정 (학생은 로그인 없이 조회·제보 가능)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 건물 (지도 마커)
CREATE TABLE IF NOT EXISTS buildings (
  id         TEXT PRIMARY KEY,               -- 예: b1
  name       TEXT NOT NULL,
  aliases    TEXT NOT NULL DEFAULT '[]',     -- JSON 배열: ["도서관", "중도"]
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  type       TEXT NOT NULL DEFAULT 'lecture', -- 마커 종류: lecture, food, dorm, ... (web/js/data.js BUILDING_TYPES)
  levels_above INTEGER,                      -- 지상 층수 (모르면 NULL)
  levels_below INTEGER,                      -- 지하 층수 (모르면 NULL)
  elevator   INTEGER,                        -- 1 있음, 0 없음, NULL 모름
  image_url  TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 편의시설 종류 (카테고리 필터)
CREATE TABLE IF NOT EXISTS facility_types (
  key   TEXT PRIMARY KEY,                    -- 예: printer
  label TEXT NOT NULL                        -- 예: 프린터
);

-- 층
CREATE TABLE IF NOT EXISTS floors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id TEXT    NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor       TEXT    NOT NULL,              -- 예: B1, 1F
  note        TEXT    NOT NULL DEFAULT '',
  places      TEXT    NOT NULL DEFAULT '[]', -- JSON 배열: 건물 카드에 보일 이름 ["서점", "신한은행"]
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (building_id, floor)
);

-- 층별 시설 (다대다)
CREATE TABLE IF NOT EXISTS floor_facilities (
  floor_id     INTEGER NOT NULL REFERENCES floors(id) ON DELETE CASCADE,
  facility_key TEXT    NOT NULL REFERENCES facility_types(key),
  PRIMARY KEY (floor_id, facility_key)
);

-- 식당
CREATE TABLE IF NOT EXISTS cafeterias (
  id          TEXT PRIMARY KEY,              -- 예: c1
  name        TEXT NOT NULL,
  building_id TEXT NOT NULL REFERENCES buildings(id),
  floor       TEXT NOT NULL DEFAULT '',
  hours       TEXT NOT NULL DEFAULT '',      -- "11:00 ~ 14:00 / 17:00 ~ 19:00"
  price       TEXT NOT NULL DEFAULT ''
);

-- 날짜별 메뉴 (관리자 등록)
CREATE TABLE IF NOT EXISTS menus (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cafeteria_id  TEXT NOT NULL REFERENCES cafeterias(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,               -- YYYY-MM-DD
  meal          TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner')),
  items         TEXT NOT NULL DEFAULT '[]',  -- JSON 배열
  updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (cafeteria_id, date, meal)
);
CREATE INDEX IF NOT EXISTS idx_menus_date ON menus(date);

-- 분실물 / 습득물
CREATE TABLE IF NOT EXISTS lost_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK (type IN ('lost', 'found')),
  title       TEXT NOT NULL,
  building_id TEXT REFERENCES buildings(id) ON DELETE SET NULL,
  place       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  contact     TEXT NOT NULL DEFAULT '',
  image_url   TEXT,
  resolved    INTEGER NOT NULL DEFAULT 0,    -- 1 = 주인 찾음
  date        TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 학생 수정 제보 → 관리자 승인
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('new', 'edit', 'menu', 'etc')),
  building_id TEXT REFERENCES buildings(id) ON DELETE SET NULL,
  floor       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  image_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected')),
  admin_note  TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id),
  date        TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- 챗봇 질문 기록 (4번 분석·개선용)
CREATE TABLE IF NOT EXISTS chat_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message    TEXT NOT NULL,
  answer     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
