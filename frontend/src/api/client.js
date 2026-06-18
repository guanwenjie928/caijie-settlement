/**
 * API 请求封装
 * 统一处理后端接口调用，包含错误处理和响应解析。
 * baseURL 动态计算：兼容预览环境 UUID 前缀、/caijie/ 前缀、根路径部署。
 */
import axios from 'axios';

/**
 * 根据当前页面 URL 动态计算 API baseURL。
 * 例如:
 *   /0ad06a5d-.../caijie/  → /0ad06a5d-.../caijie/api
 *   /0ad06a5d-.../          → /0ad06a5d-.../api
 *   /caijie/                → /caijie/api
 *   /                       → /api
 */
function getApiBase() {
  const path = window.location.pathname;
  // 移除末尾的 index.html 或 /
  const base = path.replace(/index\.html$/, '').replace(/\/+$/, '');
  return `${base}/api`;
}

const api = axios.create({
  baseURL: getApiBase(),
  timeout: 60000, // OCR 识别可能较慢，设置60秒超时
});

// ── 票据上传与识别 ──────────────────────────────────────────

export async function uploadAndRecognize(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

// ── 重复检测 ────────────────────────────────────────────────

export async function checkDuplicate(data) {
  const res = await api.post('/records/check-dup', data);
  return res.data;
}

// ── 结算记录 CRUD ───────────────────────────────────────────

export async function createRecord(data) {
  const res = await api.post('/records', data);
  return res.data;
}

export async function listRecords(params = {}) {
  const res = await api.get('/records', { params });
  return res.data;
}

export async function getRecord(id) {
  const res = await api.get(`/records/${id}`);
  return res.data;
}

export async function updateRecord(id, data) {
  const res = await api.put(`/records/${id}`, data);
  return res.data;
}

export async function updateRecordStatus(id, status) {
  const res = await api.put(`/records/${id}/status`, { status });
  return res.data;
}

export async function deleteRecord(id) {
  const res = await api.delete(`/records/${id}`);
  return res.data;
}

export async function restoreRecord(id) {
  const res = await api.post(`/records/${id}/restore`);
  return res.data;
}

// ── Excel 导出 ──────────────────────────────────────────────

export function exportExcelUrl(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.append(key, value);
  }
  return `${getApiBase()}/export?${query.toString()}`;
}

// ── 配置管理 ────────────────────────────────────────────────

export async function getSettings() {
  const res = await api.get('/settings');
  return res.data;
}

export async function updateSettings(data) {
  const res = await api.put('/settings', data);
  return res.data;
}

// ── 人员统计 ────────────────────────────────────────────────

export async function getPersonStats(params = {}) {
  const res = await api.get('/stats/by-person', { params });
  return res.data;
}

// ── 税务模拟 ────────────────────────────────────────────────

export async function getTaxKnowledge() {
  const res = await api.get('/tax/knowledge');
  return res.data;
}

export async function simulateTax(data) {
  const res = await api.post('/tax/simulate', data);
  return res.data;
}
