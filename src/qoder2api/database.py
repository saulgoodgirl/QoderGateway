import json
import os
import sqlite3
from pathlib import Path
from typing import Any

from .env import load_dotenv

load_dotenv()

DB_PATH = Path(os.getenv("DB_PATH", str(Path.home() / ".qoder" / "qoder2api.db")))


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
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
                api_enabled INTEGER DEFAULT 1,
                api_mode TEXT DEFAULT 'all',
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

        # Migration: ensure api_mode, api_enabled, region columns exist
        try:
            cur = conn.execute("PRAGMA table_info(accounts)")
            cols = [c["name"] for c in cur.fetchall()]
            if "api_mode" not in cols:
                conn.execute("ALTER TABLE accounts ADD COLUMN api_mode TEXT DEFAULT 'all'")
            if "api_enabled" not in cols:
                conn.execute("ALTER TABLE accounts ADD COLUMN api_enabled INTEGER DEFAULT 1")
            if "region" not in cols:
                conn.execute("ALTER TABLE accounts ADD COLUMN region TEXT DEFAULT 'cn'")
            if "last_checkin_cycle" not in cols:
                conn.execute("ALTER TABLE accounts ADD COLUMN last_checkin_cycle TEXT")
            if "checkin_streak" not in cols:
                conn.execute("ALTER TABLE accounts ADD COLUMN checkin_streak INTEGER DEFAULT 1")
            if "total_claim_days" not in cols:
                conn.execute("ALTER TABLE accounts ADD COLUMN total_claim_days INTEGER DEFAULT 1")
            # Sync api_mode with api_enabled for any accounts where api_enabled was set to 0
            conn.execute("UPDATE accounts SET api_mode = 'disabled' WHERE api_enabled = 0 AND (api_mode IS NULL OR api_mode = 'all')")
        except Exception:
            pass
        
        # Allowed API Keys Table (for proxy routing auth)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS allowed_keys (
                api_key TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                account_uid TEXT DEFAULT ''
            )
            """
        )

        # Migration: ensure name and account_uid exist on allowed_keys
        try:
            cur_keys = conn.execute("PRAGMA table_info(allowed_keys)")
            k_cols = [c["name"] for c in cur_keys.fetchall()]
            if "name" not in k_cols:
                conn.execute("ALTER TABLE allowed_keys ADD COLUMN name TEXT DEFAULT ''")
            if "account_uid" not in k_cols:
                conn.execute("ALTER TABLE allowed_keys ADD COLUMN account_uid TEXT DEFAULT ''")
        except Exception:
            pass
        
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
