import { useState, useEffect, useCallback } from 'react';
import {
  Search, CheckCircle2, Clock, Edit3, Trash2, X, Save,
  Download, RefreshCw, AlertTriangle, FileText
} from 'lucide-react';
import {
  listRecords, updateRecord, updateRecordStatus, deleteRecord, exportExcelUrl
} from '../api/client';

/**
 * 结算列表页 — 表格展示 + 筛选 + 行内编辑 + 状态切换 + 底部统计
 * 展示: 原始金额、盈利(4%)、税费(1%)、结算金额(95%)
 */
export default function SettlementList() {
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total_original: 0, total_profit: 0, total_tax: 0, total_settlement: 0, total_settled: 0, count: 0 });
  const [loading, setLoading] = useState(false);

  // 筛选条件
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterPerson, setFilterPerson] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // 编辑状态
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // 删除确认
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterCompany) params.company_name = filterCompany;
      if (filterPerson) params.person_name = filterPerson;
      if (filterStartDate) params.start_date = filterStartDate;
      if (filterEndDate) params.end_date = filterEndDate;

      const res = await listRecords(params);
      if (res.success) {
        setRecords(res.data);
        setTotal(res.total);
        setSummary(res.summary);
      }
    } catch (err) {
      console.error('获取记录失败:', err);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCompany, filterPerson, filterStartDate, filterEndDate]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // ── 编辑相关 ──────────────────────────────────────────

  const startEdit = (record) => {
    setEditingId(record.id);
    setEditForm({
      person_name: record.person_name,
      company_name: record.company_name,
      tax_number: record.tax_number,
      original_amount: record.original_amount,
      settled_amount: record.settled_amount ?? 0,
      entry_time: record.entry_time,
      remark: record.remark || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id) => {
    try {
      const res = await updateRecord(id, editForm);
      if (res.success) {
        setEditingId(null);
        fetchRecords();
      }
    } catch (err) {
      console.error('更新失败:', err);
      alert('更新失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // ── 状态切换 ──────────────────────────────────────────

  const toggleStatus = async (record) => {
    // 三态循环：unpaid → settling → paid → unpaid
    const cycle = { unpaid: 'settling', settling: 'paid', paid: 'unpaid' };
    const newStatus = cycle[record.status] || 'unpaid';
    try {
      await updateRecordStatus(record.id, newStatus);
      fetchRecords();
    } catch (err) {
      console.error('状态切换失败:', err);
    }
  };

  // ── 删除 ──────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteRecord(deleteConfirm.id);
      setDeleteConfirm(null);
      fetchRecords();
    } catch (err) {
      console.error('删除失败:', err);
    }
  };

  // ── 导出Excel ────────────────────────────────────────

  const handleExport = () => {
    const params = {};
    if (filterStatus) params.status = filterStatus;
    if (filterCompany) params.company_name = filterCompany;
    if (filterPerson) params.person_name = filterPerson;
    if (filterStartDate) params.start_date = filterStartDate;
    if (filterEndDate) params.end_date = filterEndDate;
    window.open(exportExcelUrl(params), '_blank');
  };

  // ── 金额格式化 ────────────────────────────────────────

  const formatAmount = (amt) => {
    if (amt == null) return '-';
    return parseFloat(amt).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTime = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // 编辑时的金额计算
  const editProfit = (editForm.original_amount || 0) * (records.find(r => r.id === editingId)?.profit_rate || 0.04);
  const editTax = (editForm.original_amount || 0) * (records.find(r => r.id === editingId)?.tax_rate || 0.01);
  const editSettlement = (editForm.original_amount || 0) * (1 - (records.find(r => r.id === editingId)?.profit_rate || 0.04) - (records.find(r => r.id === editingId)?.tax_rate || 0.01));
  const editSettled = editForm.settled_amount || 0;
  // 编辑时根据已结金额推断状态预览
  const editStatusPreview = editSettled <= 0 ? 'unpaid' : (editSettled >= editSettlement - 0.01 ? 'paid' : 'settling');

  return (
    <div className="p-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">结算列表</h2>
          <p className="text-sm text-gray-500 mt-1">共 {total} 条记录</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchRecords}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            <RefreshCw size={15} />
            刷新
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            <Download size={15} />
            导出Excel
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">全部状态</option>
            <option value="unpaid">尚未结清</option>
            <option value="settling">正在结算</option>
            <option value="paid">已结清</option>
          </select>
          <input
            type="text"
            placeholder="公司名"
            value={filterCompany}
            onChange={(e) => setFilterCompany(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 w-40"
          />
          <input
            type="text"
            placeholder="人名"
            value={filterPerson}
            onChange={(e) => setFilterPerson(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 w-32"
          />
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-gray-400 text-sm">至</span>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {(filterStatus || filterCompany || filterPerson || filterStartDate || filterEndDate) && (
            <button
              onClick={() => {
                setFilterStatus(''); setFilterCompany(''); setFilterPerson('');
                setFilterStartDate(''); setFilterEndDate('');
              }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">原始金额合计</p>
          <p className="text-lg font-bold text-gray-800">¥ {formatAmount(summary.total_original)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">盈利合计 (4%)</p>
          <p className="text-lg font-bold text-blue-600">¥ {formatAmount(summary.total_profit)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">税费合计 (1%)</p>
          <p className="text-lg font-bold text-orange-600">¥ {formatAmount(summary.total_tax)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">应结金额合计 (95%)</p>
          <p className="text-lg font-bold text-green-600">¥ {formatAmount(summary.total_settlement)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">已结金额合计</p>
          <p className="text-lg font-bold text-cyan-600">¥ {formatAmount(summary.total_settled)}</p>
        </div>
      </div>

      {/* 数据表格 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <RefreshCw className="animate-spin mr-2" size={20} />
            加载中...
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <FileText size={48} className="mb-3 opacity-30" />
            <p>暂无记录，点击"新增票据"添加</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="px-3 py-3 text-left font-medium">人名</th>
                <th className="px-3 py-3 text-left font-medium">公司名</th>
                <th className="px-3 py-3 text-left font-medium">税号</th>
                <th className="px-3 py-3 text-right font-medium">原始金额</th>
                <th className="px-3 py-3 text-right font-medium">盈利</th>
                <th className="px-3 py-3 text-right font-medium">税费</th>
                <th className="px-3 py-3 text-right font-medium">结算金额</th>
                <th className="px-3 py-3 text-right font-medium">已结金额</th>
                <th className="px-3 py-3 text-left font-medium">录入时间</th>
                <th className="px-3 py-3 text-center font-medium">状态</th>
                <th className="px-3 py-3 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  {/* 编辑模式 */}
                  {editingId === record.id ? (
                    <>
                      <td className="px-3 py-2">
                        <input value={editForm.person_name || ''}
                          onChange={(e) => setEditForm({ ...editForm, person_name: e.target.value })}
                          className="w-full px-2 py-1 border border-primary-300 rounded text-sm" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.company_name || ''}
                          onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                          className="w-full px-2 py-1 border border-primary-300 rounded text-sm" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={editForm.tax_number || ''}
                          onChange={(e) => setEditForm({ ...editForm, tax_number: e.target.value })}
                          className="w-full px-2 py-1 border border-primary-300 rounded text-sm" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" value={editForm.original_amount || 0}
                          onChange={(e) => setEditForm({ ...editForm, original_amount: parseFloat(e.target.value) || 0 })}
                          className="w-24 px-2 py-1 border border-primary-300 rounded text-sm text-right" />
                      </td>
                      <td className="px-3 py-2 text-right text-blue-600 font-medium">
                        ¥ {formatAmount(editProfit)}
                      </td>
                      <td className="px-3 py-2 text-right text-orange-600 font-medium">
                        ¥ {formatAmount(editTax)}
                      </td>
                      <td className="px-3 py-2 text-right text-green-600 font-medium">
                        ¥ {formatAmount(editSettlement)}
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" value={editSettled}
                          onChange={(e) => setEditForm({ ...editForm, settled_amount: parseFloat(e.target.value) || 0 })}
                          className="w-24 px-2 py-1 border border-primary-300 rounded text-sm text-right" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="datetime-local" value={editForm.entry_time?.slice(0, 16) || ''}
                          onChange={(e) => setEditForm({ ...editForm, entry_time: e.target.value })}
                          className="w-full px-2 py-1 border border-primary-300 rounded text-sm" />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${
                          editStatusPreview === 'paid' ? 'bg-green-100 text-green-700' :
                          editStatusPreview === 'settling' ? 'bg-blue-100 text-blue-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {editStatusPreview === 'paid' ? '已结清' : editStatusPreview === 'settling' ? '正在结算' : '尚未结清'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => saveEdit(record.id)}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="保存">
                            <Save size={15} />
                          </button>
                          <button onClick={cancelEdit}
                            className="p-1.5 text-gray-400 hover:bg-gray-50 rounded" title="取消">
                            <X size={15} />
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    /* 查看模式 */
                    <>
                      <td className="px-3 py-3 text-gray-700">{record.person_name || '-'}</td>
                      <td className="px-3 py-3 text-gray-700">{record.company_name || '-'}</td>
                      <td className="px-3 py-3 text-gray-500 font-mono text-xs">{record.tax_number || '-'}</td>
                      <td className="px-3 py-3 text-right text-gray-700 font-medium">¥ {formatAmount(record.original_amount)}</td>
                      <td className="px-3 py-3 text-right text-blue-600">¥ {formatAmount(record.profit_amount)}</td>
                      <td className="px-3 py-3 text-right text-orange-600">¥ {formatAmount(record.tax_amount)}</td>
                      <td className="px-3 py-3 text-right text-green-600 font-medium">¥ {formatAmount(record.settlement_amount)}</td>
                      <td className="px-3 py-3 text-right text-cyan-600 font-medium">¥ {formatAmount(record.settled_amount)}</td>
                      <td className="px-3 py-3 text-gray-500 text-xs">{formatTime(record.entry_time)}</td>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => toggleStatus(record)}
                          className={`px-2 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                            record.status === 'paid'
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : record.status === 'settling'
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                          }`}
                        >
                          {record.status === 'paid' ? (
                            <span className="flex items-center gap-1"><CheckCircle2 size={12} /> 已结清</span>
                          ) : record.status === 'settling' ? (
                            <span className="flex items-center gap-1"><RefreshCw size={12} /> 正在结算</span>
                          ) : (
                            <span className="flex items-center gap-1"><Clock size={12} /> 尚未结清</span>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => startEdit(record)}
                            className="p-1.5 text-primary-600 hover:bg-primary-50 rounded" title="编辑">
                            <Edit3 size={15} />
                          </button>
                          <button onClick={() => setDeleteConfirm(record)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="删除">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="text-red-600" size={20} />
              </div>
              <h3 className="text-lg font-bold text-gray-800">确认删除</h3>
            </div>
            <p className="text-sm text-gray-600 mb-2">
              确定要删除这条记录吗？删除后可在"已删除记录"中恢复。
            </p>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm text-gray-600">
              <p><span className="text-gray-400">公司名:</span> {deleteConfirm.company_name}</p>
              <p><span className="text-gray-400">人名:</span> {deleteConfirm.person_name}</p>
              <p><span className="text-gray-400">金额:</span> ¥ {formatAmount(deleteConfirm.original_amount)}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                取消
              </button>
              <button onClick={confirmDelete}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700">
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
