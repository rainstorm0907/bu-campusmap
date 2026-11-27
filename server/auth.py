"""관리자 인증 (토큰 방식)

- POST /api/auth/login 으로 받은 token 을
  요청 헤더에 `Authorization: Bearer <token>` 으로 넣으면 관리자 API 사용 가능
- 학생 기능(조회, 분실물 등록, 제보)은 로그인 없이 사용
"""
from functools import wraps

from flask import current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db

TOKEN_MAX_AGE = 60 * 60 * 12  # 12시간


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="campus-admin")


def hash_password(pw):
    return generate_password_hash(pw)


def login(username, password):
    """성공 시 (token, user) / 실패 시 None"""
    user = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return None
    token = _serializer().dumps({"uid": user["id"]})
    return token, {"id": user["id"], "username": user["username"], "role": user["role"]}


def current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = _serializer().loads(header[7:], max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return get_db().execute("SELECT id, username, role FROM users WHERE id = ?", (data["uid"],)).fetchone()


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify(error="관리자 로그인이 필요해요."), 401
        g.user = user
        return fn(*args, **kwargs)
    return wrapper
