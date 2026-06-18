"""
财会结算管理系统 - 一体化服务器
================================
FastAPI 后端，提供票据OCR识别、结算记录CRUD、Excel导出、配置管理等功能。
基于 deploy-anywhere 模板，支持容器/K8s 部署。
"""

import re
import io
import json
import logging
from pathlib import Path
from datetime import datetime

from fastapi import FastAPI, UploadFile, File, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from pydantic import BaseModel
from typing import Optional

from database import (
    init_db, get_connection, get_setting, set_setting,
    get_settlement_rate, calc_settlement_amount, record_to_dict, get_now_iso
)
from ocr_service import recognize_invoice
from excel_service import export_to_excel

# ─── 日志配置 ──────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("server")

# ─── 项目配置 ──────────────────────────────────────────────
ROOT = Path(__file__).parent
DIST_DIR = ROOT / "frontend" / "dist"
SERVER_PORT = int(__import__('os').environ.get('SERVER_PORT', '9000'))  # 支持环境变量覆盖
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB 文件大小限制

# ─── 路径前缀剥离中间件 ────────────────────────────────────
UUID_PATTERN = re.compile(
    r'^/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
)
CUSTOM_PREFIX = __import__('os').environ.get('CUSTOM_PREFIX', '/caijie/')  # nginx 路径前缀，可通过环境变量覆盖


class StripPathPrefixMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        m = UUID_PATTERN.match(path)
        if m:
            new_path = path[m.end() - 1:]
            request.scope["path"] = new_path
            request.scope["raw_path"] = new_path.encode()
            return await call_next(request)
        if CUSTOM_PREFIX and CUSTOM_PREFIX != "/" and path.startswith(CUSTOM_PREFIX):
            new_path = path[len(CUSTOM_PREFIX) - 1:]
            request.scope["path"] = new_path
            request.scope["raw_path"] = new_path.encode()
        return await call_next(request)


# ─── FastAPI 应用 ──────────────────────────────────────────
app = FastAPI(title="财会结算管理系统", version="1.0.0")

app.add_middleware(StripPathPrefixMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 启动时初始化数据库
@app.on_event("startup")
async def startup():
    init_db()
    logger.info("数据库初始化完成")


# ════════════════════════════════════════════════════════════
#  请求模型定义
# ════════════════════════════════════════════════════════════

class RecordCreate(BaseModel):
    person_name: str = ""
    company_name: str = ""
    tax_number: str = ""
    original_amount: float
    entry_time: Optional[str] = None
    source_file: str = ""
    remark: str = ""


class RecordUpdate(BaseModel):
    person_name: Optional[str] = None
    company_name: Optional[str] = None
    tax_number: Optional[str] = None
    original_amount: Optional[float] = None
    entry_time: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str  # "paid" 或 "unpaid"


class SettingsUpdate(BaseModel):
    settlement_rate: Optional[float] = None
    recalc_unpaid: Optional[bool] = False


class CheckDup(BaseModel):
    company_name: str
    tax_number: str
    original_amount: float
    entry_time: str


# ════════════════════════════════════════════════════════════
#  API 路由
# ════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health_check():
    return JSONResponse({"status": "ok", "app": "财会结算管理系统"})


# ── 票据上传与OCR识别 ──────────────────────────────────────

@app.post("/api/upload")
async def upload_and_recognize(file: UploadFile = File(...)):
    """
    上传图片/PDF，使用 RapidOCR 识别票据内容，返回结构化数据。
    此接口仅做识别，不入库。用户需在前端确认/修改后再调用 POST /api/records 入库。
    """
    # 检查文件大小
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return JSONResponse(
            {"success": False, "error": f"文件大小超过限制（最大 {MAX_FILE_SIZE // 1024 // 1024}MB）"},
            status_code=400
        )

    # 调用 OCR 识别
    result = recognize_invoice(content, file.filename or "unknown")

    if not result["success"]:
        return JSONResponse({"success": False, "error": result["error"]}, status_code=422)

    # 附加当前结算比例
    data = result["data"]
    data["settlement_rate"] = get_settlement_rate()
    if data.get("original_amount"):
        data["settlement_amount"] = round(
            calc_settlement_amount(data["original_amount"], data["settlement_rate"]), 2
        )
    else:
        data["settlement_amount"] = None

    # 默认录入时间为当前时间
    data["entry_time"] = get_now_iso()

    return JSONResponse({"success": True, "data": data})


# ── 重复检测 ──────────────────────────────────────────────

@app.post("/api/records/check-dup")
async def check_duplicate(req: CheckDup):
    """
    检测是否已存在相似记录（公司名+税号+金额+日期匹配）。
    返回疑似重复的记录列表。
    """
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM settlements
            WHERE is_deleted = 0
              AND company_name = ?
              AND tax_number = ?
              AND ABS(original_amount - ?) < 0.01
              AND DATE(entry_time) = DATE(?)
            """,
            (req.company_name, req.tax_number, req.original_amount, req.entry_time)
        ).fetchall()

    return JSONResponse({
        "is_duplicate": len(rows) > 0,
        "matches": [record_to_dict(r) for r in rows]
    })


# ── 结算记录 CRUD ─────────────────────────────────────────

@app.post("/api/records")
async def create_record(req: RecordCreate):
    """新增结算记录"""
    rate = get_settlement_rate()
    settlement_amount = calc_settlement_amount(req.original_amount, rate)
    now = get_now_iso()
    entry_time = req.entry_time or now

    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO settlements
                (person_name, company_name, tax_number, original_amount,
                 settlement_rate, settlement_amount, entry_time, status,
                 source_file, remark, is_deleted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, 0, ?, ?)
            """,
            (req.person_name, req.company_name, req.tax_number, req.original_amount,
             rate, settlement_amount, entry_time, req.source_file, req.remark, now, now)
        )
        record_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    logger.info(f"新增结算记录 id={record_id}, company={req.company_name}, amount={req.original_amount}")
    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.get("/api/records")
async def list_records(
    status: Optional[str] = Query(None, description="按状态筛选: paid/unpaid"),
    company_name: Optional[str] = Query(None, description="按公司名模糊搜索"),
    person_name: Optional[str] = Query(None, description="按人名模糊搜索"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=500, description="每页条数"),
    include_deleted: bool = Query(False, description="是否包含已删除记录"),
):
    """查询结算记录列表，支持多条件筛选和分页"""
    conditions = []
    params = []

    if not include_deleted:
        conditions.append("is_deleted = 0")
    else:
        conditions.append("is_deleted = 1")

    if status and status in ("paid", "unpaid"):
        conditions.append("status = ?")
        params.append(status)

    if company_name:
        conditions.append("company_name LIKE ?")
        params.append(f"%{company_name}%")

    if person_name:
        conditions.append("person_name LIKE ?")
        params.append(f"%{person_name}%")

    if start_date:
        conditions.append("DATE(entry_time) >= DATE(?)")
        params.append(start_date)

    if end_date:
        conditions.append("DATE(entry_time) <= DATE(?)")
        params.append(end_date)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    offset = (page - 1) * page_size

    with get_connection() as conn:
        # 总数
        count_sql = f"SELECT COUNT(*) as total FROM settlements WHERE {where_clause}"
        total = conn.execute(count_sql, params).fetchone()["total"]

        # 分页数据
        list_sql = f"""
            SELECT * FROM settlements WHERE {where_clause}
            ORDER BY created_at DESC LIMIT ? OFFSET ?
        """
        rows = conn.execute(list_sql, params + [page_size, offset]).fetchall()

    # 统计信息
    all_records = [record_to_dict(r) for r in rows]
    total_original = sum(r["original_amount"] or 0 for r in all_records)
    total_settlement = sum(r["settlement_amount"] or 0 for r in all_records)

    return JSONResponse({
        "success": True,
        "data": all_records,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "total_original": round(total_original, 2),
            "total_settlement": round(total_settlement, 2),
            "count": len(all_records),
        }
    })


@app.get("/api/records/{record_id}")
async def get_record(record_id: int):
    """获取单条记录详情"""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    if not row:
        return JSONResponse({"success": False, "error": "记录不存在"}, status_code=404)

    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.put("/api/records/{record_id}")
async def update_record(record_id: int, req: RecordUpdate):
    """修改记录，如果金额变化则自动重算结算金额"""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 0", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在或已删除"}, status_code=404)

        updates = []
        params = []

        # 构建动态更新
        if req.person_name is not None:
            updates.append("person_name = ?")
            params.append(req.person_name)
        if req.company_name is not None:
            updates.append("company_name = ?")
            params.append(req.company_name)
        if req.tax_number is not None:
            updates.append("tax_number = ?")
            params.append(req.tax_number)
        if req.entry_time is not None:
            updates.append("entry_time = ?")
            params.append(req.entry_time)
        if req.remark is not None:
            updates.append("remark = ?")
            params.append(req.remark)

        # 金额变化时重算结算金额
        if req.original_amount is not None:
            updates.append("original_amount = ?")
            params.append(req.original_amount)
            # 使用记录原有的结算比例（快照）
            old_rate = row["settlement_rate"]
            new_amount = calc_settlement_amount(req.original_amount, old_rate)
            updates.append("settlement_amount = ?")
            params.append(new_amount)

        # 状态变化
        if req.status is not None and req.status in ("paid", "unpaid"):
            updates.append("status = ?")
            params.append(req.status)
            if req.status == "paid":
                updates.append("settled_time = ?")
                params.append(get_now_iso())
            else:
                updates.append("settled_time = NULL")

        if not updates:
            return JSONResponse({"success": True, "data": record_to_dict(row), "message": "无更新内容"})

        updates.append("updated_at = ?")
        params.append(get_now_iso())
        params.append(record_id)

        conn.execute(f"UPDATE settlements SET {', '.join(updates)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    logger.info(f"更新结算记录 id={record_id}")
    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.put("/api/records/{record_id}/status")
async def update_status(record_id: int, req: StatusUpdate):
    """切换结算状态"""
    if req.status not in ("paid", "unpaid"):
        return JSONResponse({"success": False, "error": "状态值无效，必须是 paid 或 unpaid"}, status_code=400)

    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 0", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在或已删除"}, status_code=404)

        settled_time = get_now_iso() if req.status == "paid" else None
        conn.execute(
            "UPDATE settlements SET status = ?, settled_time = ?, updated_at = ? WHERE id = ?",
            (req.status, settled_time, get_now_iso(), record_id)
        )
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.delete("/api/records/{record_id}")
async def delete_record(record_id: int):
    """软删除记录"""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 0", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在或已删除"}, status_code=404)

        conn.execute("UPDATE settlements SET is_deleted = 1, updated_at = ? WHERE id = ?", (get_now_iso(), record_id))

    logger.info(f"软删除结算记录 id={record_id}")
    return JSONResponse({"success": True, "message": "记录已删除，可在已删除记录中恢复"})


@app.post("/api/records/{record_id}/restore")
async def restore_record(record_id: int):
    """恢复软删除的记录"""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 1", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在或未被删除"}, status_code=404)

        conn.execute("UPDATE settlements SET is_deleted = 0, updated_at = ? WHERE id = ?", (get_now_iso(), record_id))
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    return JSONResponse({"success": True, "data": record_to_dict(row)})


# ── Excel 导出 ────────────────────────────────────────────

@app.get("/api/export")
async def export_records(
    status: Optional[str] = Query(None),
    company_name: Optional[str] = Query(None),
    person_name: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """导出结算记录为 Excel 文件"""
    conditions = ["is_deleted = 0"]
    params = []

    if status and status in ("paid", "unpaid"):
        conditions.append("status = ?")
        params.append(status)
    if company_name:
        conditions.append("company_name LIKE ?")
        params.append(f"%{company_name}%")
    if person_name:
        conditions.append("person_name LIKE ?")
        params.append(f"%{person_name}%")
    if start_date:
        conditions.append("DATE(entry_time) >= DATE(?)")
        params.append(start_date)
    if end_date:
        conditions.append("DATE(entry_time) <= DATE(?)")
        params.append(end_date)

    where_clause = " AND ".join(conditions)

    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM settlements WHERE {where_clause} ORDER BY created_at DESC",
            params
        ).fetchall()

    records = [record_to_dict(r) for r in rows]
    excel_bytes = export_to_excel(records)

    import urllib.parse
    filename = f"settlement_records_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    encoded_filename = urllib.parse.quote(filename)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"}
    )


# ── 配置管理 ──────────────────────────────────────────────

@app.get("/api/settings")
async def get_settings():
    """获取系统配置"""
    return JSONResponse({
        "success": True,
        "data": {
            "settlement_rate": get_settlement_rate(),
        }
    })


@app.put("/api/settings")
async def update_settings(req: SettingsUpdate):
    """
    更新系统配置。
    如果修改了结算比例且 recalc_unpaid=True，会重算所有未结清记录的结算金额。
    """
    changes = {}

    if req.settlement_rate is not None:
        if req.settlement_rate < 0 or req.settlement_rate > 1:
            return JSONResponse({"success": False, "error": "结算比例必须在 0~1 之间"}, status_code=400)

        old_rate = get_settlement_rate()
        set_setting("settlement_rate", str(req.settlement_rate))
        changes["settlement_rate"] = {"old": old_rate, "new": req.settlement_rate}

        # 重算所有未结清记录
        if req.recalc_unpaid:
            with get_connection() as conn:
                rows = conn.execute(
                    "SELECT id, original_amount FROM settlements WHERE status = 'unpaid' AND is_deleted = 0"
                ).fetchall()

                recalculated = 0
                for row in rows:
                    new_amount = calc_settlement_amount(row["original_amount"], req.settlement_rate)
                    conn.execute(
                        "UPDATE settlements SET settlement_rate = ?, settlement_amount = ?, updated_at = ? WHERE id = ?",
                        (req.settlement_rate, new_amount, get_now_iso(), row["id"])
                    )
                    recalculated += 1

            changes["recalculated_count"] = recalculated
            logger.info(f"重算 {recalculated} 条未结清记录的结算金额，新比例={req.settlement_rate}")

    return JSONResponse({"success": True, "data": {"settlement_rate": get_settlement_rate()}, "changes": changes})


# ════════════════════════════════════════════════════════════
#  前端静态文件 & SPA fallback
# ════════════════════════════════════════════════════════════

@app.get("/{path:path}")
async def serve_frontend(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "API endpoint not found"}, status_code=404)

    file_path = DIST_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)

    index_path = DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)

    return JSONResponse(
        {"message": "前端文件未找到，请先构建: cd frontend && npm run build"},
        status_code=404,
    )


# ─── 启动入口 ──────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    init_db()
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT)
