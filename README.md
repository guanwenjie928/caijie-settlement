# 财会结算管理系统

基于 FastAPI + React + RapidOCR 的票据识别与结算管理系统。

## 功能

- **票据识别**：支持图片(PNG/JPG)和PDF上传，自动OCR提取金额、人名、公司名、税号
- **自动计算**：按可配置结算比例（默认5%）自动计算结算金额
- **数据管理**：记录的增删改查，支持软删除与恢复
- **状态管理**：已结清 / 尚未结清 两种状态切换
- **重复检测**：上传时自动检测疑似重复票据
- **Excel导出**：一键导出结算记录为Excel表格
- **数据可编辑**：识别结果可手动修改（应对开错票场景）

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | FastAPI + SQLite |
| 前端 | React + Vite + TailwindCSS |
| OCR | RapidOCR (ONNX Runtime) |
| Excel | openpyxl |
| PDF | PyMuPDF (fitz) |

## 本地开发

```bash
# 安装后端依赖
pip install -r requirements.txt

# 安装前端依赖并构建
cd frontend && npm install && npm run build && cd ..

# 启动服务
python server.py
# 访问 http://localhost:9000
```

## 部署

```bash
./deploy.sh /caijie/ 9000 8080
```

## 项目结构

```
├── server.py              — FastAPI 后端入口
├── database.py            — SQLite 数据库管理
├── ocr_service.py         — RapidOCR 票据识别服务
├── excel_service.py       — Excel 导出服务
├── requirements.txt       — Python 依赖
├── deploy.sh              — 一键部署脚本
└── frontend/
    ├── src/
    │   ├── App.jsx        — 主应用
    │   ├── api/client.js  — API 请求封装
    │   └── components/     — 页面组件
    └── vite.config.js
```
