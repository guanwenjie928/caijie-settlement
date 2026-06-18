import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Trash2, FileText, RefreshCw } from 'lucide-react';
import { listRecords, restoreRecord, deleteRecord } from '../api/client';

/**
 * 已删除记录页 — 查看软删除记录 + 恢复
 */
export default function DeletedRecords() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRecords({ include_deleted: true });
      if (res.success) {
        setRecords(res.data);
      }
    } catch (err) {
      console.error('获取已删除记录失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleRestore = async (id) => {
    try {
      await restoreRecord(id);
      fetchRecords();
    } catch (err) {
      console.error('恢复失败:', err);
    }
  };

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">已删除记录</h2>
          <p className="text-sm text-gray-500 mt-1">此处显示被软删除的记录，可随时恢复</p>
        </div>
        <button
          onClick={fetchRecords}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
        >
          <RefreshCw size={15} />
          刷新
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <RefreshCw className="animate-spin mr-2" size={20} />
            加载中...
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Trash2 size={48} className="mb-3 opacity-30" />
            <p>暂无已删除记录</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="px-3 py-3 text-left font-medium">人名</th>
                <th className="px-3 py-3 text-left font-medium">公司名</th>
                <th className="px-3 py-3 text-right font-medium">原始金额</th>
                <th className="px-3 py-3 text-right font-medium">结算金额</th>
                <th className="px-3 py-3 text-left font-medium">删除时间</th>
                <th className="px-3 py-3 text-center font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b border-gray-100 opacity-60">
                  <td className="px-3 py-3 text-gray-700">{record.person_name || '-'}</td>
                  <td className="px-3 py-3 text-gray-700">{record.company_name || '-'}</td>
                  <td className="px-3 py-3 text-right text-gray-500">¥ {formatAmount(record.original_amount)}</td>
                  <td className="px-3 py-3 text-right text-gray-500">¥ {formatAmount(record.settlement_amount)}</td>
                  <td className="px-3 py-3 text-gray-400 text-xs">{formatTime(record.updated_at)}</td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => handleRestore(record.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100"
                    >
                      <RotateCcw size={13} />
                      恢复
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
