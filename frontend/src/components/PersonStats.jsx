import { useState, useEffect, useCallback } from 'react';
import {
  Users, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle2, Clock, Calendar, TrendingUp
} from 'lucide-react';
import { getPersonStats } from '../api/client';

/**
 * 人员统计页 — 按人名维度展示金额统计、盈利、已结清/未结清、时间分布
 */
export default function PersonStats() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [groupBy, setGroupBy] = useState('month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expandedPerson, setExpandedPerson] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = { group_by: groupBy };
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      const res = await getPersonStats(params);
      if (res.success) {
        setData(res.data);
      }
    } catch (err) {
      console.error('获取统计失败:', err);
    } finally {
      setLoading(false);
    }
  }, [groupBy, startDate, endDate]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const formatAmount = (amt) => {
    if (amt == null) return '0.00';
    return parseFloat(amt).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // 汇总
  const grandTotal = data.reduce((acc, p) => ({
    original: acc.original + (p.total_original || 0),
    profit: acc.profit + (p.total_profit || 0),
    tax: acc.tax + (p.total_tax || 0),
    settlement: acc.settlement + (p.total_settlement || 0),
    paid: acc.paid + (p.paid_amount || 0),
    unpaid: acc.unpaid + (p.unpaid_amount || 0),
  }), { original: 0, profit: 0, tax: 0, settlement: 0, paid: 0, unpaid: 0 });

  return (
    <div className="p-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Users className="text-gray-600" size={24} />
          <div>
            <h2 className="text-2xl font-bold text-gray-800">人员统计</h2>
            <p className="text-sm text-gray-500 mt-0.5">按人名维度查看佣金、盈利、结算统计</p>
          </div>
        </div>
        <button
          onClick={fetchStats}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
        >
          <RefreshCw size={15} />
          刷新
        </button>
      </div>

      {/* 筛选栏 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="month">按月</option>
            <option value="quarter">按季度</option>
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <span className="text-gray-400 text-sm">至</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {(startDate || endDate) && (
            <button
              onClick={() => { setStartDate(''); setEndDate(''); }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {/* 汇总卡片 — 5个 */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">原始金额总计</p>
          <p className="text-lg font-bold text-gray-800">¥ {formatAmount(grandTotal.original)}</p>
        </div>
        <div className="bg-white rounded-lg border border-blue-200 p-4 bg-blue-50/30">
          <p className="text-xs text-blue-500 mb-1">盈利总计 (4%)</p>
          <p className="text-lg font-bold text-blue-700">¥ {formatAmount(grandTotal.profit)}</p>
        </div>
        <div className="bg-white rounded-lg border border-orange-200 p-4 bg-orange-50/30">
          <p className="text-xs text-orange-500 mb-1">税费预留总计 (1%)</p>
          <p className="text-lg font-bold text-orange-700">¥ {formatAmount(grandTotal.tax)}</p>
        </div>
        <div className="bg-white rounded-lg border border-green-200 p-4 bg-green-50/30">
          <p className="text-xs text-green-500 mb-1">已结清金额</p>
          <p className="text-lg font-bold text-green-600">¥ {formatAmount(grandTotal.paid)}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">未结清金额</p>
          <p className="text-lg font-bold text-orange-600">¥ {formatAmount(grandTotal.unpaid)}</p>
        </div>
      </div>

      {/* 人员卡片列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <RefreshCw className="animate-spin mr-2" size={20} />
          加载中...
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Users size={48} className="mb-3 opacity-30" />
          <p>暂无统计数据</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((person) => {
            const isExpanded = expandedPerson === person.person_name;
            const paidPct = person.total_settlement > 0
              ? (person.paid_amount / person.total_settlement * 100).toFixed(1)
              : 0;

            return (
              <div key={person.person_name} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* 人员汇总行 */}
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedPerson(isExpanded ? null : person.person_name)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold">
                        {(person.person_name || '?')[0]}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">{person.person_name || '未命名'}</p>
                        <p className="text-xs text-gray-500">
                          {person.record_count} 条记录 | 已结清 {person.paid_count} 条 | 未结清 {person.unpaid_count} 条
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-5">
                      <div className="text-right">
                        <p className="text-xs text-gray-500">原始金额</p>
                        <p className="font-bold text-gray-800">¥ {formatAmount(person.total_original)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-blue-500">盈利 4%</p>
                        <p className="font-bold text-blue-700">¥ {formatAmount(person.total_profit)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-orange-500">税费 1%</p>
                        <p className="font-bold text-orange-700">¥ {formatAmount(person.total_tax)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">结算金额</p>
                        <p className="font-bold text-green-600">¥ {formatAmount(person.total_settlement)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">未结清</p>
                        <p className="font-bold text-orange-600">¥ {formatAmount(person.unpaid_amount)}</p>
                      </div>
                      {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                    </div>
                  </div>

                  {/* 结清进度条 */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span>结清进度</span>
                      <span>{paidPct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${paidPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* 展开的时间维度明细 */}
                {isExpanded && person.periods && person.periods.length > 0 && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-gray-500 text-xs">
                          <th className="px-4 py-2 text-left font-medium">
                            <span className="flex items-center gap-1"><Calendar size={12} /> 期间</span>
                          </th>
                          <th className="px-4 py-2 text-right font-medium">条数</th>
                          <th className="px-4 py-2 text-right font-medium">原始金额</th>
                          <th className="px-4 py-2 text-right font-medium text-blue-600">盈利 4%</th>
                          <th className="px-4 py-2 text-right font-medium text-orange-600">税费 1%</th>
                          <th className="px-4 py-2 text-right font-medium">结算金额 95%</th>
                          <th className="px-4 py-2 text-right font-medium">已结清</th>
                          <th className="px-4 py-2 text-right font-medium">未结清</th>
                        </tr>
                      </thead>
                      <tbody>
                        {person.periods.map((period, idx) => (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="px-4 py-2 text-gray-700 font-medium">{period.period}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{period.count}</td>
                            <td className="px-4 py-2 text-right text-gray-700">¥ {formatAmount(period.original)}</td>
                            <td className="px-4 py-2 text-right text-blue-600 font-medium">¥ {formatAmount(period.profit)}</td>
                            <td className="px-4 py-2 text-right text-orange-600">¥ {formatAmount(period.tax)}</td>
                            <td className="px-4 py-2 text-right text-green-600 font-medium">¥ {formatAmount(period.settlement)}</td>
                            <td className="px-4 py-2 text-right text-green-700">¥ {formatAmount(period.paid)}</td>
                            <td className="px-4 py-2 text-right text-orange-700">¥ {formatAmount(period.unpaid)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
