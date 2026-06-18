"""
OCR 识别服务模块
================
使用 RapidOCR (ONNX Runtime) 进行中文票据文字识别，
支持图片(PNG/JPG)和PDF两种格式输入。

识别流程:
  1. PDF → PyMuPDF 转图片；图片直接使用
  2. RapidOCR 提取全部文字
  3. 正则后处理提取关键字段（金额、公司名、税号、人名）
  4. 税号18位格式校验 + 金额格式化

依赖: rapidocr-onnxruntime, PyMuPDF, Pillow
"""

import re
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── OCR 引擎懒加载 ──────────────────────────────────────────
# 首次调用时初始化，避免启动时加载模型导致卡顿
_ocr_engine = None


def _get_ocr_engine():
    """懒加载 RapidOCR 引擎"""
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        logger.info("正在初始化 RapidOCR 引擎...")
        _ocr_engine = RapidOCR()
        logger.info("RapidOCR 引擎初始化完成")
    return _ocr_engine


# ── PDF 转图片 ──────────────────────────────────────────────

def _pdf_to_images(pdf_bytes: bytes) -> list[bytes]:
    """
    将 PDF 每页转换为 PNG 图片字节。
    使用 PyMuPDF (fitz) 进行渲染，DPI=200 兼顾清晰度和性能。
    """
    import fitz  # PyMuPDF

    images = []
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    for page in doc:
        # 200 DPI 渲染，保证OCR识别率
        mat = fitz.Matrix(200 / 72, 200 / 72)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        images.append(img_bytes)

    doc.close()
    return images


# ── 正则提取规则 ────────────────────────────────────────────
# 针对中国增值税发票的常见格式

# 金额: 匹配 "¥1234.56" 或 "￥1234.56" 或 "1234.56"
# 优先匹配 "价税合计" 后的金额，其次匹配 "金额" 后的金额
# 同时兼容半角¥(U+00A5)和全角￥(U+FFE5)
AMOUNT_PATTERNS = [
    # 价税合计（大写）¥小写金额 — 最可靠
    re.compile(r'价税合计[^¥￥\d]*[¥￥]?\s*([\d,]+\.?\d*)', re.DOTALL),
    # 金额栏目
    re.compile(r'金额[^¥￥\d]*[¥￥]?\s*([\d,]+\.?\d*)', re.DOTALL),
    # 合计金额
    re.compile(r'合计[^¥￥\d]*[¥￥]?\s*([\d,]+\.?\d*)', re.DOTALL),
    # 直接匹配 ¥/￥ 符号后的金额（兜底）
    re.compile(r'[¥￥]\s*([\d,]+\.?\d*)'),
]

# 税号: 18位统一社会信用代码（字母+数字）
# 兼容中文冒号"："和ASCII冒号":"
TAX_NUMBER_PATTERNS = [
    # 统一社会信用代码/纳税人识别号：xxx
    re.compile(r'统一社会信用代码[/纳税人识别号]*[：:\s]*([A-Z0-9]{15,20})'),
    re.compile(r'纳税人识别号[：:\s]*([A-Z0-9]{15,20})'),
    re.compile(r'税\s*号[：:\s]*([A-Z0-9]{15,20})'),
    # 兜底: 任意18位字母数字组合
    re.compile(r'\b([A-Z0-9]{18})\b'),
]

# 公司名: 匹配 "名称：" 后的中文公司名
# 兼容中文冒号"："和ASCII冒号":"
COMPANY_PATTERNS = [
    # 销售方名称优先（通常是需要结算的对象）
    re.compile(r'销售方.*?名称[：:\s]*([\u4e00-\u9fa5（）()]+(?:有限公司|股份有限公司|有限责任公司|集团|合伙企业|个体工商户|工作室|中心|院|所|厂|店))', re.DOTALL),
    # 通用名称匹配
    re.compile(r'名称[：:\s]*([\u4e00-\u9fa5（）()]+(?:有限公司|股份有限公司|有限责任公司|集团|合伙企业|个体工商户|工作室|中心|院|所|厂|店))'),
    re.compile(r'收款方[：:\s]*([\u4e00-\u9fa5（）()]+)'),
    re.compile(r'开票方[：:\s]*([\u4e00-\u9fa5（）()]+)'),
]

# 人名: 通常出现在 "收款人" "复核" "开票人" 等字段后
# 兼容中文冒号"："和ASCII冒号":"
PERSON_PATTERNS = [
    re.compile(r'收款人[：:\s]*([\u4e00-\u9fa5]{2,4})'),
    re.compile(r'开票人[：:\s]*([\u4e00-\u9fa5]{2,4})'),
    re.compile(r'复核人[：:\s]*([\u4e00-\u9fa5]{2,4})'),
    re.compile(r'联系人[：:\s]*([\u4e00-\u9fa5]{2,4})'),
    re.compile(r'经办人[：:\s]*([\u4e00-\u9fa5]{2,4})'),
]


def _extract_first(text: str, patterns: list[re.Pattern]) -> Optional[str]:
    """使用正则列表依次匹配，返回第一个匹配结果"""
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            result = match.group(1).strip()
            # 清理金额中的逗号
            if patterns is AMOUNT_PATTERNS:
                result = result.replace(',', '')
            return result
    return None


def _validate_tax_number(tax_number: str) -> bool:
    """
    校验统一社会信用代码（18位）。
    规则: 18位，由大写字母和数字组成。
    """
    if not tax_number:
        return False
    if len(tax_number) != 18:
        return False
    if not re.match(r'^[A-Z0-9]{18}$', tax_number):
        return False
    return True


def _parse_amount(text: str) -> Optional[float]:
    """从文本中提取金额并转换为 float"""
    raw = _extract_first(text, AMOUNT_PATTERNS)
    if raw is None:
        return None
    try:
        # 清理可能的非数字字符
        cleaned = re.sub(r'[^\d.]', '', raw)
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def _parse_invoice_text(full_text: str) -> dict:
    """
    从 OCR 识别出的完整文本中提取结构化字段。
    返回字典包含: person_name, company_name, tax_number, original_amount
    任何字段提取失败都会返回 None，由前端提示用户手动填写。
    """
    result = {
        "person_name": None,
        "company_name": None,
        "tax_number": None,
        "original_amount": None,
        "raw_text": full_text[:2000],  # 保留前2000字符供调试
    }

    # 提取各字段
    person = _extract_first(full_text, PERSON_PATTERNS)
    company = _extract_first(full_text, COMPANY_PATTERNS)
    tax_number = _extract_first(full_text, TAX_NUMBER_PATTERNS)
    amount = _parse_amount(full_text)

    # 赋值 + 校验标记
    result["person_name"] = person
    result["company_name"] = company
    result["tax_number"] = tax_number
    result["tax_number_valid"] = _validate_tax_number(tax_number) if tax_number else False
    result["original_amount"] = amount

    return result


# ── 主入口: 识别票据 ────────────────────────────────────────

def recognize_invoice(file_bytes: bytes, filename: str) -> dict:
    """
    识别票据图片或PDF，返回结构化字段。

    参数:
        file_bytes: 文件二进制内容
        filename: 原始文件名（用于判断文件类型）

    返回:
        {
            "success": bool,
            "data": { person_name, company_name, tax_number, original_amount, ... },
            "error": str | None
        }
    """
    try:
        ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''

        # 根据文件类型获取图片字节列表
        if ext == 'pdf':
            images = _pdf_to_images(file_bytes)
            if not images:
                return {"success": False, "data": None, "error": "PDF 文件无内容或解析失败"}
        elif ext in ('png', 'jpg', 'jpeg', 'bmp', 'tiff', 'webp'):
            images = [file_bytes]
        else:
            return {"success": False, "data": None, "error": f"不支持的文件格式: .{ext}"}

        # 合并所有页面的 OCR 文本
        engine = _get_ocr_engine()
        full_text_parts = []

        for img_bytes in images:
            result, _ = engine(img_bytes)
            if result:
                # RapidOCR 返回 [[box, text, score], ...]
                for item in result:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        full_text_parts.append(item[1])
                    elif isinstance(item, str):
                        full_text_parts.append(item)

        full_text = "\n".join(full_text_parts)
        logger.info(f"OCR 识别完成，共提取 {len(full_text_parts)} 行文本")

        if not full_text.strip():
            return {"success": False, "data": None, "error": "OCR 未识别到任何文字，请检查图片清晰度或手动录入"}

        # 解析结构化字段
        parsed = _parse_invoice_text(full_text)

        return {
            "success": True,
            "data": parsed,
            "error": None
        }

    except Exception as e:
        logger.error(f"OCR 识别失败: {e}", exc_info=True)
        return {"success": False, "data": None, "error": f"识别过程出错: {str(e)}"}
