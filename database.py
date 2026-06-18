"""
数据库管理模块
===============
负责 SQLite 数据库的初始化、连接管理和基础 CRUD 操作。
使用软删除机制，删除的记录可通过 is_deleted 字段恢复。
"""

import sqlite3
import json
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "data.db"


def get_now_iso() -> str:
    """返回当前时间的 ISO 格式字符串"""
    return datetime.now().isoformat()


def init_db():
    """初始化数据库，创建所有表和默认配置"""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS settlements (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                person_name         TEXT NOT NULL DEFAULT '',
                company_name        TEXT NOT NULL DEFAULT '',
                tax_number          TEXT NOT NULL DEFAULT '',
                original_amount     REAL NOT NULL DEFAULT 0,
                settlement_rate     REAL NOT NULL DEFAULT 0.05,
                settlement_amount   REAL NOT NULL DEFAULT 0,
                entry_time          TEXT NOT NULL,
                status              TEXT NOT NULL DEFAULT 'unpaid',
                settled_time        TEXT,
                source_file         TEXT DEFAULT '',
                remark              TEXT DEFAULT '',
                is_deleted          INTEGER NOT NULL DEFAULT 0,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
            CREATE INDEX IF NOT EXISTS idx_settlements_company ON settlements(company_name);
            CREATE INDEX IF NOT EXISTS idx_settlements_is_deleted ON settlements(is_deleted);

            CREATE TABLE IF NOT EXISTS settings (
                key     TEXT PRIMARY KEY,
                value   TEXT NOT NULL
            );

            INSERT OR IGNORE INTO settings (key, value) VALUES ('settlement_rate', '0.05');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('app_name', '财会结算管理系统');
        """)
        conn.commit()


@contextmanager
def get_connection():
    """获取数据库连接的上下文管理器"""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_setting(key: str, default: str = "") -> str:
    """获取单个配置项"""
    with get_connection() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key: str, value: str):
    """设置配置项"""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value)
        )


def get_settlement_rate() -> float:
    """获取当前结算比例"""
    return float(get_setting("settlement_rate", "0.05"))


def calc_settlement_amount(original_amount: float, rate: float) -> float:
    """
    计算结算金额，存储保留4位小数，展示时四舍五入到2位。
    """
    return round(original_amount * rate, 4)


def record_to_dict(row: sqlite3.Row) -> dict:
    """将数据库行转换为字典"""
    return {
        "id": row["id"],
        "person_name": row["person_name"],
        "company_name": row["company_name"],
        "tax_number": row["tax_number"],
        "original_amount": row["original_amount"],
        "settlement_rate": row["settlement_rate"],
        "settlement_amount": round(row["settlement_amount"], 2),
        "entry_time": row["entry_time"],
        "status": row["status"],
        "settled_time": row["settled_time"],
        "source_file": row["source_file"],
        "remark": row["remark"],
        "is_deleted": row["is_deleted"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
