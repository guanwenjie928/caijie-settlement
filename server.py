"""
财会结算管理系统 - 一体化服务器
================================
FastAPI 后端：票据OCR识别、结算记录CRUD、人员统计、税务模拟、Excel导出。
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
    get_profit_rate, get_tax_rate, calc_amounts, derive_status, record_to_dict, get_now_iso
)
from ocr_service import recognize_invoice
from excel_service import export_to_excel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("server")

ROOT = Path(__file__).parent
DIST_DIR = ROOT / "frontend" / "dist"
SERVER_PORT = int(__import__('os').environ.get('SERVER_PORT', '9000'))
MAX_FILE_SIZE = 10 * 1024 * 1024

UUID_PATTERN = re.compile(
    r'^/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
)
CUSTOM_PREFIX = __import__('os').environ.get('CUSTOM_PREFIX', '/caijie/')


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


app = FastAPI(title="财会结算管理系统", version="2.0.0")
app.add_middleware(StripPathPrefixMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    init_db()
    logger.info("数据库初始化完成")


# ════════════════════════════════════════════════════════════
#  请求模型
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
    settled_amount: Optional[float] = None
    entry_time: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None

class StatusUpdate(BaseModel):
    status: str

class SettingsUpdate(BaseModel):
    profit_rate: Optional[float] = None
    tax_rate: Optional[float] = None
    recalc_unpaid: Optional[bool] = False

class CheckDup(BaseModel):
    company_name: str
    tax_number: str
    original_amount: float
    entry_time: str

class TaxSimInput(BaseModel):
    """税务模拟器输入"""
    quarterly_revenue: float        # 季度佣金收入
    employee_count: int = 0          # 员工人数
    monthly_salary: float = 0        # 月均工资
    special_deduction: float = 0     # 人均月专项附加扣除
    social_rate: float = 0.155       # 社保公积金比例（企业部分）
    other_cost: float = 0            # 其他季度成本
    profit_margin: float = 0.04      # 利润率（佣金业务的利润分成）


# ════════════════════════════════════════════════════════════
#  基础接口
# ════════════════════════════════════════════════════════════

@app.get("/api/health")
async def health_check():
    return JSONResponse({"status": "ok", "app": "财会结算管理系统"})


# ── 票据上传与OCR识别 ──────────────────────────────────────

@app.post("/api/upload")
async def upload_and_recognize(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return JSONResponse({"success": False, "error": f"文件超过{MAX_FILE_SIZE // 1024 // 1024}MB限制"}, status_code=400)

    result = recognize_invoice(content, file.filename or "unknown")
    if not result["success"]:
        return JSONResponse({"success": False, "error": result["error"]}, status_code=422)

    data = result["data"]
    profit_rate = get_profit_rate()
    tax_rate = get_tax_rate()
    data["profit_rate"] = profit_rate
    data["tax_rate"] = tax_rate

    if data.get("original_amount"):
        amounts = calc_amounts(data["original_amount"], profit_rate, tax_rate)
        data.update(amounts)

    data["entry_time"] = get_now_iso()
    return JSONResponse({"success": True, "data": data})


# ── 重复检测 ──────────────────────────────────────────────

@app.post("/api/records/check-dup")
async def check_duplicate(req: CheckDup):
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT * FROM settlements WHERE is_deleted = 0
               AND company_name = ? AND tax_number = ?
               AND ABS(original_amount - ?) < 0.01
               AND DATE(entry_time) = DATE(?)""",
            (req.company_name, req.tax_number, req.original_amount, req.entry_time)
        ).fetchall()
    return JSONResponse({"is_duplicate": len(rows) > 0, "matches": [record_to_dict(r) for r in rows]})


# ── 结算记录 CRUD ─────────────────────────────────────────

@app.post("/api/records")
async def create_record(req: RecordCreate):
    profit_rate = get_profit_rate()
    tax_rate = get_tax_rate()
    amounts = calc_amounts(req.original_amount, profit_rate, tax_rate)
    now = get_now_iso()
    entry_time = req.entry_time or now

    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO settlements
               (person_name, company_name, tax_number, original_amount,
                profit_rate, tax_rate, profit_amount, tax_amount, settlement_amount,
                entry_time, status, source_file, remark, is_deleted, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, 0, ?, ?)""",
            (req.person_name, req.company_name, req.tax_number, req.original_amount,
             profit_rate, tax_rate, amounts["profit_amount"], amounts["tax_amount"],
             amounts["settlement_amount"], entry_time, req.source_file, req.remark, now, now)
        )
        record_id = cursor.lastrowid
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    logger.info(f"新增记录 id={record_id}, amount={req.original_amount}, settlement={amounts['settlement_amount']}")
    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.get("/api/records")
async def list_records(
    status: Optional[str] = Query(None),
    company_name: Optional[str] = Query(None),
    person_name: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    include_deleted: bool = Query(False),
):
    conditions = []
    params = []
    if not include_deleted:
        conditions.append("is_deleted = 0")
    else:
        conditions.append("is_deleted = 1")
    if status and status in ("paid", "unpaid", "settling"):
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
        total = conn.execute(f"SELECT COUNT(*) as total FROM settlements WHERE {where_clause}", params).fetchone()["total"]
        rows = conn.execute(
            f"SELECT * FROM settlements WHERE {where_clause} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [page_size, offset]
        ).fetchall()

        # 统计卡片：汇总全部符合条件的记录（不只是当前页）
        summary_row = conn.execute(f"""
            SELECT
                COALESCE(SUM(original_amount), 0)   AS total_original,
                COALESCE(SUM(profit_amount), 0)     AS total_profit,
                COALESCE(SUM(tax_amount), 0)         AS total_tax,
                COALESCE(SUM(settlement_amount), 0)  AS total_settlement,
                COALESCE(SUM(settled_amount), 0)     AS total_settled
            FROM settlements WHERE {where_clause}
        """, params).fetchone()

    all_records = [record_to_dict(r) for r in rows]
    return JSONResponse({
        "success": True,
        "data": all_records,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "total_original": round(summary_row["total_original"], 2),
            "total_profit": round(summary_row["total_profit"], 2),
            "total_tax": round(summary_row["total_tax"], 2),
            "total_settlement": round(summary_row["total_settlement"], 2),
            "total_settled": round(summary_row["total_settled"], 2),
            "count": total,
        }
    })


@app.get("/api/records/{record_id}")
async def get_record(record_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()
    if not row:
        return JSONResponse({"success": False, "error": "记录不存在"}, status_code=404)
    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.put("/api/records/{record_id}")
async def update_record(record_id: int, req: RecordUpdate):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 0", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在或已删除"}, status_code=404)

        updates = []
        params = []
        for field in ["person_name", "company_name", "tax_number", "entry_time", "remark"]:
            val = getattr(req, field)
            if val is not None:
                updates.append(f"{field} = ?")
                params.append(val)

        if req.original_amount is not None:
            updates.append("original_amount = ?")
            params.append(req.original_amount)
            old_profit_rate = row["profit_rate"]
            old_tax_rate = row["tax_rate"]
            amounts = calc_amounts(req.original_amount, old_profit_rate, old_tax_rate)
            updates.append("profit_amount = ?")
            params.append(amounts["profit_amount"])
            updates.append("tax_amount = ?")
            params.append(amounts["tax_amount"])
            updates.append("settlement_amount = ?")
            params.append(amounts["settlement_amount"])

        # 已结金额更新 + 自动推断状态
        if req.settled_amount is not None:
            updates.append("settled_amount = ?")
            params.append(req.settled_amount)
            # 根据 settled_amount 推断 status
            settlement_val = amounts["settlement_amount"] if req.original_amount is not None else row["settlement_amount"]
            new_status = derive_status(req.settled_amount, settlement_val)
            updates.append("status = ?")
            params.append(new_status)
            if new_status == "paid":
                updates.append("settled_time = ?")
                params.append(get_now_iso())
            else:
                updates.append("settled_time = NULL")
        elif req.status is not None and req.status in ("paid", "unpaid", "settling"):
            updates.append("status = ?")
            params.append(req.status)
            if req.status == "paid":
                updates.append("settled_time = ?")
                params.append(get_now_iso())
                updates.append("settled_amount = ?")
                params.append(row["settlement_amount"])
            elif req.status == "unpaid":
                updates.append("settled_time = NULL")
                updates.append("settled_amount = ?")
                params.append(0)
            else:  # settling — 保持当前 settled_amount，清除 settled_time
                updates.append("settled_time = NULL")

        if not updates:
            return JSONResponse({"success": True, "data": record_to_dict(row), "message": "无更新内容"})

        updates.append("updated_at = ?")
        params.append(get_now_iso())
        params.append(record_id)
        conn.execute(f"UPDATE settlements SET {', '.join(updates)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()

    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.put("/api/records/{record_id}/status")
async def update_status(record_id: int, req: StatusUpdate):
    if req.status not in ("paid", "unpaid", "settling"):
        return JSONResponse({"success": False, "error": "状态值无效"}, status_code=400)
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 0", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在"}, status_code=404)

        if req.status == "paid":
            settled_time = get_now_iso()
            settled_amount = row["settlement_amount"]
        elif req.status == "unpaid":
            settled_time = None
            settled_amount = 0
        else:  # settling — 保持当前 settled_amount，清除 settled_time
            settled_time = None
            settled_amount = row["settled_amount"] if row["settled_amount"] > 0 else 0

        conn.execute(
            "UPDATE settlements SET status = ?, settled_time = ?, settled_amount = ?, updated_at = ? WHERE id = ?",
            (req.status, settled_time, settled_amount, get_now_iso(), record_id)
        )
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()
    return JSONResponse({"success": True, "data": record_to_dict(row)})


@app.delete("/api/records/{record_id}")
async def delete_record(record_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 0", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在"}, status_code=404)
        conn.execute("UPDATE settlements SET is_deleted = 1, updated_at = ? WHERE id = ?", (get_now_iso(), record_id))
    return JSONResponse({"success": True, "message": "已删除，可恢复"})


@app.post("/api/records/{record_id}/restore")
async def restore_record(record_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM settlements WHERE id = ? AND is_deleted = 1", (record_id,)).fetchone()
        if not row:
            return JSONResponse({"success": False, "error": "记录不存在或未删除"}, status_code=404)
        conn.execute("UPDATE settlements SET is_deleted = 0, updated_at = ? WHERE id = ?", (get_now_iso(), record_id))
        row = conn.execute("SELECT * FROM settlements WHERE id = ?", (record_id,)).fetchone()
    return JSONResponse({"success": True, "data": record_to_dict(row)})


# ════════════════════════════════════════════════════════════
#  人员统计 API
# ════════════════════════════════════════════════════════════

@app.get("/api/stats/by-person")
async def stats_by_person(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    group_by: str = Query("month", description="month 或 quarter"),
):
    """按人名维度统计：金额、已结清/未结清、时间分布"""
    conditions = ["is_deleted = 0"]
    params = []
    if start_date:
        conditions.append("DATE(entry_time) >= DATE(?)")
        params.append(start_date)
    if end_date:
        conditions.append("DATE(entry_time) <= DATE(?)")
        params.append(end_date)
    where_clause = " AND ".join(conditions)

    with get_connection() as conn:
        # 每人汇总
        summary_rows = conn.execute(f"""
            SELECT
                person_name,
                COUNT(*) as record_count,
                SUM(original_amount) as total_original,
                SUM(profit_amount) as total_profit,
                SUM(tax_amount) as total_tax,
                SUM(settlement_amount) as total_settlement,
                SUM(settled_amount) as total_settled,
                SUM(CASE WHEN status = 'paid' THEN settlement_amount ELSE 0 END) as paid_amount,
                SUM(CASE WHEN status = 'settling' THEN settlement_amount ELSE 0 END) as settling_amount,
                SUM(CASE WHEN status = 'unpaid' THEN settlement_amount ELSE 0 END) as unpaid_amount,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'settling' THEN 1 ELSE 0 END) as settling_count,
                SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_count
            FROM settlements WHERE {where_clause}
            GROUP BY person_name
            ORDER BY total_settlement DESC
        """, params).fetchall()

        # 时间维度明细
        if group_by == "quarter":
            period_expr = "strftime('%Y', entry_time) || 'Q' || ((cast(strftime('%m', entry_time) as int) - 1) / 3 + 1)"
        else:
            period_expr = "strftime('%Y-%m', entry_time)"

        detail_rows = conn.execute(f"""
            SELECT
                person_name,
                {period_expr} as period,
                COUNT(*) as count,
                SUM(original_amount) as original,
                SUM(profit_amount) as profit,
                SUM(tax_amount) as tax,
                SUM(settlement_amount) as settlement,
                SUM(settled_amount) as settled,
                SUM(CASE WHEN status = 'paid' THEN settlement_amount ELSE 0 END) as paid,
                SUM(CASE WHEN status = 'settling' THEN settlement_amount ELSE 0 END) as settling,
                SUM(CASE WHEN status = 'unpaid' THEN settlement_amount ELSE 0 END) as unpaid
            FROM settlements WHERE {where_clause}
            GROUP BY person_name, period
            ORDER BY person_name, period
        """, params).fetchall()

    # 组装结果
    person_map = {}
    for r in summary_rows:
        person_map[r["person_name"]] = {
            "person_name": r["person_name"],
            "total_original": round(r["total_original"] or 0, 2),
            "total_profit": round(r["total_profit"] or 0, 2),
            "total_tax": round(r["total_tax"] or 0, 2),
            "total_settlement": round(r["total_settlement"] or 0, 2),
            "total_settled": round(r["total_settled"] or 0, 2),
            "paid_amount": round(r["paid_amount"] or 0, 2),
            "settling_amount": round(r["settling_amount"] or 0, 2),
            "unpaid_amount": round(r["unpaid_amount"] or 0, 2),
            "record_count": r["record_count"],
            "paid_count": r["paid_count"],
            "settling_count": r["settling_count"],
            "unpaid_count": r["unpaid_count"],
            "periods": [],
        }

    for r in detail_rows:
        if r["person_name"] in person_map:
            person_map[r["person_name"]]["periods"].append({
                "period": r["period"],
                "count": r["count"],
                "original": round(r["original"] or 0, 2),
                "profit": round(r["profit"] or 0, 2),
                "tax": round(r["tax"] or 0, 2),
                "settlement": round(r["settlement"] or 0, 2),
                "settled": round(r["settled"] or 0, 2),
                "paid": round(r["paid"] or 0, 2),
                "settling": round(r["settling"] or 0, 2),
                "unpaid": round(r["unpaid"] or 0, 2),
            })

    return JSONResponse({"success": True, "data": list(person_map.values())})


# ════════════════════════════════════════════════════════════
#  税务模拟 API
# ════════════════════════════════════════════════════════════

# 个人所得税七级累进速算表（年度累计）
IIT_BRACKETS = [
    (36000, 0.03, 0),
    (144000, 0.10, 2520),
    (300000, 0.20, 16920),
    (420000, 0.25, 31920),
    (660000, 0.30, 52920),
    (960000, 0.35, 85920),
    (float('inf'), 0.45, 181920),
]

def calc_iit_annual(taxable_income: float) -> float:
    """计算年度个税"""
    if taxable_income <= 0:
        return 0
    for limit, rate, deduction in IIT_BRACKETS:
        if taxable_income <= limit:
            return round(taxable_income * rate - deduction, 2)
    return 0


@app.post("/api/tax/simulate")
async def tax_simulate(req: TaxSimInput):
    """
    税务模拟器：输入季度佣金等参数，计算增值税、企税、个税、实际利润。
    """
    Q = req.quarterly_revenue
    N = req.employee_count
    S = req.monthly_salary
    D = req.special_deduction
    R = req.social_rate
    C = req.other_cost
    P = req.profit_margin

    # 1. 增值税
    VAT_QUARTERLY_THRESHOLD = 300000
    if Q <= VAT_QUARTERLY_THRESHOLD:
        vat = 0
        vat_exempt = True
    else:
        vat = round(Q * 0.01, 2)
        vat_exempt = False

    # 2. 附加税费（六税两费减半: 12% × 50% = 6%）
    surtax = round(vat * 0.06, 2)

    # 3. 印花税（佣金合同 0.05% × 50%减半 = 0.025%）
    stamp = round(Q * 0.00025, 2)

    # 4. 工资支出（季度）
    salary_total = N * S * 3

    # 5. 社保公积金（企业部分，季度）
    social_enterprise = round(N * S * R * 3, 2)

    # 6. 个人所得税（单人月）
    social_personal = S * 0.105  # 个人部分约10.5%
    monthly_taxable = max(0, S - 5000 - D - social_personal)
    # 简化：按月计算，不累计（月均）
    annual_taxable = monthly_taxable * 12
    iit_annual_single = calc_iit_annual(annual_taxable)
    iit_monthly_single = round(iit_annual_single / 12, 2)
    iit_quarter_total = round(iit_monthly_single * 3 * N, 2)

    # 7. 企业所得税（年度预缴，按季度分摊）
    annual_revenue = Q * 4
    annual_gross_profit = annual_revenue * P
    annual_deductible = (surtax + stamp) * 4 + social_enterprise * 4 + C * 4
    annual_taxable_income = max(0, annual_gross_profit - annual_deductible)

    if annual_taxable_income <= 3000000:
        cit_annual = round(annual_taxable_income * 0.05, 2)
        is_small_micro = True
    else:
        cit_annual = round(annual_taxable_income * 0.25, 2)
        is_small_micro = False
    cit_quarter = round(cit_annual / 4, 2)

    # 8. 实际利润（季度）
    quarter_gross_profit = Q * P
    quarter_total_tax = vat + surtax + stamp + cit_quarter
    net_profit = quarter_gross_profit - surtax - stamp - social_enterprise - cit_quarter - C

    # 9. 税负率
    tax_burden = round(quarter_total_tax / Q * 100, 4) if Q > 0 else 0

    # 10. 预警
    vat_used_pct = round(Q / VAT_QUARTERLY_THRESHOLD * 100, 1)
    cit_annual_used_pct = round(annual_taxable_income / 3000000 * 100, 1)

    return JSONResponse({
        "success": True,
        "data": {
            # 输入回显
            "input": {
                "quarterly_revenue": Q,
                "employee_count": N,
                "monthly_salary": S,
                "profit_margin": P,
            },
            # 增值税
            "vat": {
                "amount": vat,
                "exempt": vat_exempt,
                "quarterly_threshold": VAT_QUARTERLY_THRESHOLD,
                "used_percent": vat_used_pct,
                "remaining": round(VAT_QUARTERLY_THRESHOLD - Q, 2),
                "status": "green" if vat_used_pct < 80 else ("yellow" if vat_used_pct < 100 else "red"),
            },
            # 附加税费
            "surtax": surtax,
            "stamp": stamp,
            # 工资 & 社保
            "salary_total": salary_total,
            "social_enterprise": social_enterprise,
            # 个税
            "iit": {
                "monthly_per_person": iit_monthly_single,
                "quarterly_total": iit_quarter_total,
                "monthly_taxable": round(monthly_taxable, 2),
                "bracket_info": {"annual_taxable": round(annual_taxable, 2), "annual_tax": iit_annual_single},
            },
            # 企业所得税
            "cit": {
                "quarterly": cit_quarter,
                "annual": cit_annual,
                "annual_taxable_income": round(annual_taxable_income, 2),
                "is_small_micro": is_small_micro,
                "threshold": 3000000,
                "used_percent": cit_annual_used_pct,
                "status": "green" if cit_annual_used_pct < 80 else ("yellow" if cit_annual_used_pct < 100 else "red"),
            },
            # 利润
            "profit": {
                "quarter_gross": round(quarter_gross_profit, 2),
                "quarter_total_tax": round(quarter_total_tax, 2),
                "quarter_net": round(net_profit, 2),
                "annual_net_estimate": round(net_profit * 4, 2),
                "net_margin": round(net_profit / Q * 100, 2) if Q > 0 else 0,
            },
            # 税负率对比
            "tax_burden": {
                "actual_rate": tax_burden,
                "reserved_rate": round(req.tax_rate if hasattr(req, 'tax_rate') else 1.0, 2),
                "sufficient": tax_burden <= 1.0,
                "gap": round(tax_burden - 1.0, 4),
            },
            # 汇总
            "summary": {
                "quarterly_revenue": Q,
                "total_tax": round(quarter_total_tax, 2),
                "total_cost": round(salary_total + social_enterprise + C + surtax + stamp, 2),
                "net_profit": round(net_profit, 2),
            }
        }
    })


@app.get("/api/tax/knowledge")
async def tax_knowledge():
    """返回税务知识库结构化数据"""
    return JSONResponse({
        "success": True,
        "data": {
            "company": {
                "name": "深圳市此刻的文化有限公司",
                "type": "小微企业 / 小规模纳税人",
                "location": "深圳市",
                "business": "佣金/居间服务",
            },
            "vat": {
                "title": "增值税（小规模纳税人）",
                "policy": "季度销售额 ≤ 30万元免征；超过则全额按1%征收",
                "threshold_monthly": 100000,
                "threshold_quarterly": 300000,
                "rate": 0.01,
                "deadline": "2027年12月31日",
                "note": "超过30万后，全部销售额按1%征收（不是仅超出部分）",
            },
            "cit": {
                "title": "企业所得税（小型微利企业）",
                "policy": "年应纳税所得额 ≤ 300万，减按25%计入，按20%税率，实际5%",
                "threshold_annual": 3000000,
                "effective_rate": 0.05,
                "deadline": "2027年12月31日",
                "conditions": ["年应纳税所得额 ≤ 300万", "从业人数 ≤ 300人", "资产总额 ≤ 5000万"],
                "note": "2023年起取消100万/300万梯度，300万以内统一5%",
            },
            "iit": {
                "title": "个人所得税（员工工资代扣）",
                "threshold_monthly": 5000,
                "threshold_annual": 60000,
                "brackets": [
                    {"level": 1, "range": "≤ 36,000", "rate": "3%", "deduction": 0},
                    {"level": 2, "range": "36,000 ~ 144,000", "rate": "10%", "deduction": 2520},
                    {"level": 3, "range": "144,000 ~ 300,000", "rate": "20%", "deduction": 16920},
                    {"level": 4, "range": "300,000 ~ 420,000", "rate": "25%", "deduction": 31920},
                    {"level": 5, "range": "420,000 ~ 660,000", "rate": "30%", "deduction": 52920},
                    {"level": 6, "range": "660,000 ~ 960,000", "rate": "35%", "deduction": 85920},
                    {"level": 7, "range": "> 960,000", "rate": "45%", "deduction": 181920},
                ],
                "special_deductions": [
                    {"name": "子女教育", "amount": "2000元/月/子女"},
                    {"name": "3岁以下婴幼儿照护", "amount": "2000元/月/孩"},
                    {"name": "继续教育", "amount": "400元/月"},
                    {"name": "住房贷款利息", "amount": "1000元/月"},
                    {"name": "住房租金（深圳）", "amount": "1500元/月"},
                    {"name": "赡养老人", "amount": "独生子女3000元 / 非独生≤1500元"},
                ],
            },
            "surtax": {
                "title": "附加税费（六税两费减半）",
                "items": ["城建税 7%", "教育费附加 3%", "地方教育附加 2%"],
                "reduction": "减半征收（实际6%）",
                "deadline": "2027年12月31日",
            },
            "stamp": {
                "title": "印花税（佣金合同）",
                "rate": "0.05%",
                "reduction": "减半征收（实际0.025%）",
            },
        }
    })


# ── Excel 导出 ────────────────────────────────────────────

@app.get("/api/export")
async def export_records(
    status: Optional[str] = Query(None),
    company_name: Optional[str] = Query(None),
    person_name: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    conditions = ["is_deleted = 0"]
    params = []
    if status and status in ("paid", "unpaid", "settling"):
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
        rows = conn.execute(f"SELECT * FROM settlements WHERE {where_clause} ORDER BY created_at DESC", params).fetchall()

    records = [record_to_dict(r) for r in rows]
    excel_bytes = export_to_excel(records)

    import urllib.parse
    filename = f"settlement_records_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    encoded = urllib.parse.quote(filename)
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"}
    )


# ── 配置管理 ──────────────────────────────────────────────

@app.get("/api/settings")
async def get_settings():
    return JSONResponse({
        "success": True,
        "data": {
            "profit_rate": get_profit_rate(),
            "tax_rate": get_tax_rate(),
        }
    })


@app.put("/api/settings")
async def update_settings(req: SettingsUpdate):
    changes = {}

    if req.profit_rate is not None:
        if req.profit_rate < 0 or req.profit_rate > 1:
            return JSONResponse({"success": False, "error": "盈利比例必须在 0~1 之间"}, status_code=400)
        old = get_profit_rate()
        set_setting("profit_rate", str(req.profit_rate))
        changes["profit_rate"] = {"old": old, "new": req.profit_rate}

    if req.tax_rate is not None:
        if req.tax_rate < 0 or req.tax_rate > 1:
            return JSONResponse({"success": False, "error": "税费比例必须在 0~1 之间"}, status_code=400)
        old = get_tax_rate()
        set_setting("tax_rate", str(req.tax_rate))
        changes["tax_rate"] = {"old": old, "new": req.tax_rate}

    if req.recalc_unpaid:
        profit_rate = get_profit_rate()
        tax_rate = get_tax_rate()
        with get_connection() as conn:
            rows = conn.execute("SELECT id, original_amount FROM settlements WHERE status = 'unpaid' AND is_deleted = 0").fetchall()
            for row in rows:
                amounts = calc_amounts(row["original_amount"], profit_rate, tax_rate)
                conn.execute(
                    "UPDATE settlements SET profit_rate=?, tax_rate=?, profit_amount=?, tax_amount=?, settlement_amount=?, updated_at=? WHERE id=?",
                    (profit_rate, tax_rate, amounts["profit_amount"], amounts["tax_amount"], amounts["settlement_amount"], get_now_iso(), row["id"])
                )
        changes["recalculated"] = len(rows)

    return JSONResponse({"success": True, "data": {"profit_rate": get_profit_rate(), "tax_rate": get_tax_rate()}, "changes": changes})


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
    return JSONResponse({"message": "前端文件未找到，请先构建"}, status_code=404)


if __name__ == "__main__":
    import uvicorn
    init_db()
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT)
