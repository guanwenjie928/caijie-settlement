import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { getSettings, updateSettings } from '../api/client';

/**
 * 系统设置页 — 盈利比例 + 税费比例配置 + 重算选项
 */
export default function SettingsPage() {
  const [profitRate, setProfitRate] = useState(0.04);
  const [taxRate, setTaxRate] = useState(0.01);
  const [recalcUnpaid, setRecalcUnpaid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await getSettings();
      if (res.success) {
        setProfitRate(res.data.profit_rate);
        setTaxRate(res.data.tax_rate);
      }
    } catch (err) {
      setError('获取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (profitRate < 0 || profitRate > 1) {
      setError('盈利比例必须在 0~1 之间（如 0.04 表示 4%）');
      return;
    }
    if (taxRate < 0 || taxRate > 1) {
      setError('税费比例必须在 0~1 之间（如 0.01 表示 1%）');
      return;
    }
    if (profitRate + taxRate >= 1) {
      setError('盈利比例 + 税费比例不能超过 100%，否则结算金额为负');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await updateSettings({
        profit_rate: profitRate,
        tax_rate: taxRate,
        recalc_unpaid: recalcUnpaid,
      });

      if (res.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch (err) {
      setError('保存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  const settlementRate = 1 - profitRate - taxRate;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <SettingsIcon className="text-gray-600" size={24} />
        <h2 className="text-2xl font-bold text-gray-800">系统设置</h2>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* 盈利比例 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">盈利比例</label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={profitRate}
                onChange={(e) => setProfitRate(parseFloat(e.target.value) || 0)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <span className="text-sm text-gray-500">
              = {(profitRate * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            公司留存盈利，如 0.04 表示按4%收取。
          </p>
        </div>

        {/* 税费比例 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">税费预留比例</label>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={taxRate}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <span className="text-sm text-gray-500">
              = {(taxRate * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            预留税费（实际税负可能高于或低于此值，可在"财会知识"页模拟），如 0.01 表示按1%预留。
          </p>
        </div>

        {/* 结算比例展示（只读） */}
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">结算比例（自动计算）</span>
            <span className="font-bold text-green-600">{(settlementRate * 100).toFixed(1)}%</span>
          </div>
          <div className="mt-2 flex h-6 rounded overflow-hidden">
            <div className="bg-blue-400 flex items-center justify-center text-xs text-white" style={{ width: `${profitRate * 100}%` }}>
              {profitRate > 0.02 ? `盈利${(profitRate * 100).toFixed(0)}%` : ''}
            </div>
            <div className="bg-orange-400 flex items-center justify-center text-xs text-white" style={{ width: `${taxRate * 100}%` }}>
              {taxRate > 0.02 ? `税${(taxRate * 100).toFixed(0)}%` : ''}
            </div>
            <div className="bg-green-400 flex items-center justify-center text-xs text-white" style={{ width: `${settlementRate * 100}%` }}>
              结算{(settlementRate * 100).toFixed(0)}%
            </div>
          </div>
        </div>

        {/* 重算选项 */}
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="recalc"
              checked={recalcUnpaid}
              onChange={(e) => setRecalcUnpaid(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-primary-600"
            />
            <div>
              <label htmlFor="recalc" className="text-sm font-medium text-gray-700 cursor-pointer">
                修改比例后重算所有未结清记录
              </label>
              <p className="text-xs text-gray-500 mt-1">
                勾选后，保存时将自动重新计算所有"尚未结清"状态记录的盈利、税费和结算金额。
                <br />已结清的记录不受影响（保留原有金额）。
              </p>
            </div>
          </div>
          {recalcUnpaid && (
            <div className="mt-3 flex items-start gap-2 text-xs text-orange-600 bg-orange-50 p-2 rounded">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>注意：重算操作不可撤销，请确认后再保存。</span>
            </div>
          )}
        </div>

        {/* 示例计算 */}
        <div className="p-4 bg-primary-50 rounded-lg border border-primary-100">
          <p className="text-xs text-primary-600 font-medium mb-2">示例计算</p>
          <div className="text-sm text-gray-600 space-y-1">
            <div className="flex gap-4">
              <span>原始金额 ¥10,000.00</span>
              <span className="text-blue-600">盈利 ¥{(10000 * profitRate).toFixed(2)}</span>
              <span className="text-orange-600">税费 ¥{(10000 * taxRate).toFixed(2)}</span>
              <span className="text-green-600 font-bold">结算 ¥{(10000 * settlementRate).toFixed(2)}</span>
            </div>
            <div className="flex gap-4">
              <span>原始金额 ¥50,000.00</span>
              <span className="text-blue-600">盈利 ¥{(50000 * profitRate).toFixed(2)}</span>
              <span className="text-orange-600">税费 ¥{(50000 * taxRate).toFixed(2)}</span>
              <span className="text-green-600 font-bold">结算 ¥{(50000 * settlementRate).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-600">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* 保存按钮 */}
        <div className="flex justify-end pt-4 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex items-center gap-1.5 px-6 py-2 text-sm text-white rounded-lg ${
              saved ? 'bg-green-600' : 'bg-primary-600 hover:bg-primary-700'
            } disabled:opacity-70`}
          >
            {saved ? (
              <><Check size={16} /> 已保存</>
            ) : saving ? (
              <><RefreshCw className="animate-spin" size={16} /> 保存中...</>
            ) : (
              <><Save size={16} /> 保存设置</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
