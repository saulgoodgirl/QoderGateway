import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from .env import load_dotenv

load_dotenv()

DB_PATH = Path(os.getenv("DB_PATH", str(Path.home() / ".qoder" / "qoder2api.db")))


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        # Accounts Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                uid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                user_type TEXT,
                security_oauth_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                last_status TEXT DEFAULT 'ok',
                last_error TEXT,
                quota INTEGER DEFAULT 0,
                is_quota_exceeded INTEGER DEFAULT 0,
                plan TEXT,
                user_tag TEXT,
                next_reset_at INTEGER
            )
            """
        )
        
        # Allowed API Keys Table (for proxy routing auth)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS allowed_keys (
                api_key TEXT PRIMARY KEY
            )
            """
        )
        
        # Global Settings Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        
        # Set default gateway token if not present
        res = conn.execute("SELECT value FROM settings WHERE key = 'gateway_token'").fetchone()
        if not res:
            default_token = os.getenv("QODER_ADMIN_PASSWORD", "admin").strip() or "admin"
            conn.execute("INSERT INTO settings (key, value) VALUES ('gateway_token', ?)", (default_token,))
            
        res_auth = conn.execute("SELECT value FROM settings WHERE key = 'auth_required'").fetchone()
        if not res_auth:
            conn.execute("INSERT INTO settings (key, value) VALUES ('auth_required', '0')")

        # token_expires_at 列（幂等：已存在则忽略）
        try:
            conn.execute("ALTER TABLE accounts ADD COLUMN token_expires_at TEXT")
        except Exception:
            pass

        # region 列（幂等：已存在则忽略，默认 cn）
        try:
            conn.execute("ALTER TABLE accounts ADD COLUMN region TEXT DEFAULT 'cn'")
        except Exception:
            pass


init_db()
