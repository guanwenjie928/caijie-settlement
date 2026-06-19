"""
数据库管理模块
===============
SQLite 数据库初始化、连接管理和 CRUD。
结算逻辑: 盈利(profit_rate) + 税费(tax_rate) + 结算给他人(剩余)
"""

import sqlite3
from datetime import datetime
from pathlib import Path
from contextlib import contextmanager

DB_PATH = Path(__file__).parent / "data.db"


def get_now_iso() -> str:
    return datetime.now().isoformat()


def init_db():
    """初始化数据库，创建表和默认配置"""
    with get_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS settlements (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                person_name         TEXT NOT NULL DEFAULT '',
                company_name        TEXT NOT NULL DEFAULT '',
                tax_number          TEXT NOT NULL DEFAULT '',
                original_amount     REAL NOT NULL DEFAULT 0,
                profit_rate         REAL NOT NULL DEFAULT 0.04,
                tax_rate            REAL NOT NULL DEFAULT 0.01,
                profit_amount       REAL NOT NULL DEFAULT 0,
                tax_amount          REAL NOT NULL DEFAULT 0,
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
            CREATE INDEX IF NOT EXISTS idx_settlements_person ON settlements(person_name);
            CREATE INDEX IF NOT EXISTS idx_settlements_company ON settlements(company_name);
            CREATE INDEX IF NOT EXISTS idx_settlements_is_deleted ON settlements(is_deleted);

            CREATE TABLE IF NOT EXISTS settings (
                key     TEXT PRIMARY KEY,
                value   TEXT NOT NULL
            );

            INSERT OR IGNORE INTO settings (key, value) VALUES ('profit_rate', '0.04');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '0.01');
            INSERT OR IGNORE INTO settings (key, value) VALUES ('app_name', '财会结算管理系统');
        """)

        # 迁移旧数据：如果存在 settlement_rate 列，转换为新结构
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(settlements)").fetchall()]
            if "settlement_rate" in cols and "profit_rate" not in cols:
                conn.executescript("""
                    ALTER TABLE settlements ADD COLUMN profit_rate REAL DEFAULT 0.04;
                    ALTER TABLE settlements ADD COLUMN tax_rate REAL DEFAULT 0.01;
                    ALTER TABLE settlements ADD COLUMN profit_amount REAL DEFAULT 0;
                    ALTER TABLE settlements ADD COLUMN tax_amount REAL DEFAULT 0;
                """)
                # 旧数据: settlement_rate=0.05 → profit_rate=0.04, tax_rate=0.01
                conn.execute("UPDATE settlements SET profit_rate = 0.04, tax_rate = 0.01 WHERE profit_rate IS NULL OR profit_rate = 0")
                conn.execute("""
                    UPDATE settlements SET
                        profit_amount = original_amount * 0.04,
                        tax_amount = original_amount * 0.01,
                        settlement_amount = original_amount * 0.95
                    WHERE is_deleted = 0
                """)
                logger.info("数据库迁移完成: settlement_rate → profit_rate + tax_rate")
        except Exception:
            pass  # 新数据库，无需迁移

        conn.commit()

        # 修复历史数据：校验 profit + tax + settlement ≈ original，不一致则重算
        bad_rows = conn.execute(
            "SELECT id, original_amount, profit_rate, tax_rate, "
            "profit_amount, tax_amount, settlement_amount FROM settlements "
            "WHERE is_deleted = 0 AND original_amount > 0 AND "
            "ABS(profit_amount + tax_amount + settlement_amount - original_amount) > 0.01"
        ).fetchall()
        if bad_rows:
            for row in bad_rows:
                amounts = calc_amounts(row["original_amount"], row["profit_rate"], row["tax_rate"])
                conn.execute(
                    "UPDATE settlements SET profit_amount=?, tax_amount=?, settlement_amount=? WHERE id=?",
                    (amounts["profit_amount"], amounts["tax_amount"], amounts["settlement_amount"], row["id"])
                )
            conn.commit()
            import logging
            logging.getLogger("database").info(f"修复了 {len(bad_rows)} 条历史数据的金额计算（三项之和不等于原始金额）")


@contextmanager
def get_connection():
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
    with get_connection() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key: str, value: str):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value)
        )


def get_profit_rate() -> float:
    return float(get_setting("profit_rate", "0.04"))


def get_tax_rate() -> float:
    return float(get_setting("tax_rate", "0.01"))


def calc_amounts(original_amount: float, profit_rate: float, tax_rate: float) -> dict:
    """
    计算盈利、税费、结算金额。
    settlement = original × (1 - profit_rate - tax_rate)
    """
    profit = round(original_amount * profit_rate, 4)
    tax = round(original_amount * tax_rate, 4)
    settlement = round(original_amount * (1 - profit_rate - tax_rate), 4)
    return {
        "profit_amount": profit,
        "tax_amount": tax,
        "settlement_amount": settlement,
    }


def record_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "person_name": row["person_name"],
        "company_name": row["company_name"],
        "tax_number": row["tax_number"],
        "original_amount": row["original_amount"],
        "profit_rate": row["profit_rate"],
        "tax_rate": row["tax_rate"],
        "profit_amount": round(row["profit_amount"], 2),
        "tax_amount": round(row["tax_amount"], 2),
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
