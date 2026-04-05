"""User management — SQLite on arturito."""
import sqlite3
import hashlib
import secrets
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import bcrypt

DB_PATH = Path("/home/arthur/daemon/data/users.db")
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

def get_db():
    db = sqlite3.connect(str(DB_PATH))
    db.row_factory = sqlite3.Row
    db.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        daemon_name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        last_login TEXT,
        settings TEXT DEFAULT '{}'
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")
    db.commit()
    return db

def hash_password(password):
    return "bcrypt:" + bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def check_password(stored, password):
    if stored.startswith("bcrypt:"):
        return bcrypt.checkpw(password.encode(), stored[7:].encode())
    # Legacy SHA-256 password detected — verify and migrate to bcrypt
    if ":" in stored:
        salt, h = stored.split(":", 1)
        if hashlib.sha256((salt + password).encode()).hexdigest() == h:
            # Password correct — migrate to bcrypt in-place
            _migrate_password_to_bcrypt(stored, password)
            return True
    return False

def _migrate_password_to_bcrypt(old_hash, password):
    """Migrate a legacy SHA-256 password to bcrypt on successful login."""
    try:
        db = get_db()
        new_hash = hash_password(password)
        db.execute("UPDATE users SET password_hash = ? WHERE password_hash = ?",
                   (new_hash, old_hash))
        db.commit()
    except Exception as e:
        # Migration failure is non-fatal — user can still log in
        print(f"[users] bcrypt migration failed: {e}")

def create_user(email, password, daemon_name):
    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (email, password_hash, daemon_name, created_at) VALUES (?, ?, ?, ?)",
            (email.lower(), hash_password(password), daemon_name.lower(), datetime.now(timezone.utc).isoformat())
        )
        db.commit()
        return {"ok": True, "daemon_name": daemon_name.lower()}
    except sqlite3.IntegrityError as e:
        if "email" in str(e):
            return {"ok": False, "error": "Email already registered"}
        if "daemon_name" in str(e):
            return {"ok": False, "error": "Daemon name already taken"}
        return {"ok": False, "error": str(e)}

def login(email_or_name, password):
    db = get_db()
    # Try email first, then daemon name
    user = db.execute("SELECT * FROM users WHERE email = ?", (email_or_name.lower(),)).fetchone()
    if not user:
        user = db.execute("SELECT * FROM users WHERE daemon_name = ?", (email_or_name.lower(),)).fetchone()
    if not user or not check_password(user["password_hash"], password):
        return None
    # Create session with 30-day expiry
    token = secrets.token_hex(32)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(days=30)).isoformat()
    db.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
               (token, user["id"], now.isoformat(), expires_at))
    db.execute("UPDATE users SET last_login = ? WHERE id = ?",
               (datetime.now(timezone.utc).isoformat(), user["id"]))
    db.commit()
    return {"token": token, "daemon_name": user["daemon_name"], "email": user["email"]}

def get_user_by_token(token):
    db = get_db()
    row = db.execute("""
        SELECT u.* FROM users u JOIN sessions s ON u.id = s.user_id
        WHERE s.token = ?
          AND (s.expires_at IS NULL OR s.expires_at > ?)
    """, (token, datetime.now(timezone.utc).isoformat())).fetchone()
    return dict(row) if row else None


def cleanup_expired_sessions():
    """Delete expired sessions. Call periodically."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    deleted = db.execute("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at <= ?", (now,)).rowcount
    db.commit()
    return deleted

def get_user_by_daemon_name(name):
    db = get_db()
    row = db.execute("SELECT id, email, daemon_name, created_at, settings FROM users WHERE daemon_name = ?",
                     (name.lower(),)).fetchone()
    return dict(row) if row else None

def list_users():
    db = get_db()
    return [dict(r) for r in db.execute("SELECT id, email, daemon_name, created_at, last_login FROM users ORDER BY created_at DESC").fetchall()]

if __name__ == "__main__":
    print("Users:", list_users())
