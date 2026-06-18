import { useState, useEffect } from 'react';
import {
  BookOpen, Calculator, BarChart3, RefreshCw, AlertTriangle,
  CheckCircle2, XCircle, Building2, Percent, Receipt, Coins,
  TrendingUp, Shield, Wallet
} from 'lucide-react';
import { getTaxKnowledge, simulateTax } from '../api/client';
import SalaryPlanner from './SalaryPlanner';

/**
 * 财会知识页 — 4个Tab: 知识库 / 税务模拟器 / 额度看板 / 薪资规划
 */
export default function TaxKnowledge() {
  const [activeTab, setActiveTab] = useState('knowledge');
  const [knowledge, setKnowledge] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTaxKnowledge().then(res => {
      if (res.success) setKnowledge(res.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="animate-spin text-gray-400" size={24} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <BookOpen className="text-gray-600" size={24} />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">财会知识 & 税务模拟</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {knowledge?.company?.name} · {knowledge?.company?.type}
          </p>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {[
          { id: 'knowledge', label: '知识库', icon: BookOpen },
          { id: 'simulator', label: '税务模拟器', icon: Calculator },
          { id: 'quota', label: '额度看板', icon: BarChart3 },
          { id: 'salary', label: '薪资规划', icon: Wallet },
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'knowledge' && <KnowledgeBase knowledge={knowledge} />}
      {activeTab === 'simulator' && <TaxSimulator />}
      {activeTab === 'quota' && <QuotaDashboard knowledge={knowledge} />}
      {activeTab === 'salary' && <SalaryPlanner />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 1: 知识库
// ════════════════════════════════════════════════════════════

function KnowledgeBase({ knowledge }) {
  if (!knowledge) return null;

  return (
    <div className="space-y-4">
      {/* 公司信息 */}
      <div className="bg-gradient-to-r from-blue-50 to-primary-50 rounded-xl border border-blue-200 p-5">
        <div className="flex items-center gap-3 mb-2">
          <Building2 className="text-blue-600" size={20} />
          <h3 className="font-bold text-gray-800">{knowledge.company.name}</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-gray-500">类型:</span> <span className="font-medium">{knowledge.company.type}</span></div>
          <div><span className="text-gray-500">地区:</span> <span className="font-medium">{knowledge.company.location}</span></div>
          <div><span className="text-gray-500">业务:</span> <span className="font-medium">{knowledge.company.business}</span></div>
        </div>
      </div>

      {/* 增值税 */}
      <KnowledgeCard
        icon={Percent}
        color="blue"
        title={knowledge.vat.title}
        badge="2027年底前有效"
        items={[
          { label: '政策', value: knowledge.vat.policy },
          { label: '月度免征线', value: `¥${knowledge.vat.threshold_monthly.toLocaleString()}` },
          { label: '季度免征线', value: `¥${knowledge.vat.threshold_quarterly.toLocaleString()}` },
          { label: '征收率', value: `${(knowledge.vat.rate * 100)}%` },
          { label: '注意事项', value: knowledge.vat.note },
        ]}
      />

      {/* 企业所得税 */}
      <KnowledgeCard
        icon={Receipt}
        color="green"
        title={knowledge.cit.title}
        badge="2027年底前有效"
        items={[
          { label: '政策', value: knowledge.cit.policy },
          { label: '年度限额', value: `¥${knowledge.cit.threshold_annual.toLocaleString()}` },
          { label: '实际税率', value: `${(knowledge.cit.effective_rate * 100)}%` },
          { label: '认定条件', value: knowledge.cit.conditions.join(' / ') },
          { label: '注意事项', value: knowledge.cit.note },
        ]}
      />

      {/* 个人所得税 */}
      <KnowledgeCard
        icon={Coins}
        color="orange"
        title={knowledge.iit.title}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">月起征点:</span>
              <span className="font-medium ml-2">¥{knowledge.iit.threshold_monthly.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">年起征点:</span>
              <span className="font-medium ml-2">¥{knowledge.iit.threshold_annual.toLocaleString()}</span>
            </div>
          </div>

          {/* 税率表 */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 text-gray-600">
                  <th className="px-3 py-2 text-left">级数</th>
                  <th className="px-3 py-2 text-left">累计预扣预缴所得额(年)</th>
                  <th className="px-3 py-2 text-center">税率</th>
                  <th className="px-3 py-2 text-right">速算扣除数</th>
                </tr>
              </thead>
              <tbody>
                {knowledge.iit.brackets.map(b => (
                  <tr key={b.level} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-600">{b.level}</td>
                    <td className="px-3 py-2 text-gray-700">{b.range}</td>
                    <td className="px-3 py-2 text-center font-medium text-orange-600">{b.rate}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{b.deduction.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 专项附加扣除 */}
          <div>
            <p className="text-xs text-gray-500 mb-2">专项附加扣除:</p>
            <div className="flex flex-wrap gap-2">
              {knowledge.iit.special_deductions.map((d, i) => (
                <span key={i} className="px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs border border-orange-200">
                  {d.name}: {d.amount}
                </span>
              ))}
            </div>
          </div>
        </div>
      </KnowledgeCard>

      {/* 附加税费 */}
      <KnowledgeCard
        icon={Shield}
        color="purple"
        title={knowledge.surtax.title}
        badge="2027年底前有效"
        items={[
          { label: '包含税种', value: knowledge.surtax.items.join('、') },
          { label: '减免政策', value: knowledge.surtax.reduction },
        ]}
      />

      {/* 印花税 */}
      <KnowledgeCard
        icon={Receipt}
        color="indigo"
        title={knowledge.stamp.title}
        items={[
          { label: '税率', value: knowledge.stamp.rate },
          { label: '减免政策', value: knowledge.stamp.reduction },
        ]}
      />
    </div>
  );
}

function KnowledgeCard({ icon: Icon, color, title, badge, items, children }) {
  const colorMap = {
    blue: 'border-blue-200 bg-blue-50/30',
    green: 'border-green-200 bg-green-50/30',
    orange: 'border-orange-200 bg-orange-50/30',
    purple: 'border-purple-200 bg-purple-50/30',
    indigo: 'border-indigo-200 bg-indigo-50/30',
  };
  const iconColorMap = {
    blue: 'text-blue-600',
    green: 'text-green-600',
    orange: 'text-orange-600',
    purple: 'text-purple-600',
    indigo: 'text-indigo-600',
  };

  return (
    <div className={`rounded-xl border p-5 ${colorMap[color] || 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={iconColorMap[color] || 'text-gray-600'} size={20} />
          <h3 className="font-bold text-gray-800">{title}</h3>
        </div>
        {badge && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{badge}</span>
        )}
      </div>
      {items && (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-4 gap-2 text-sm">
              <span className="text-gray-500 col-span-1">{item.label}:</span>
              <span className="text-gray-700 col-span-3">{item.value}</span>
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 2: 税务模拟器
// ════════════════════════════════════════════════════════════

function TaxSimulator() {
  const [form, setForm] = useState({
    quarterly_revenue: 250000,
    employee_count: 3,
    monthly_salary: 8000,
    special_deduction: 0,
    social_rate: 0.155,
    other_cost: 5000,
    profit_margin: 0.04,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSimulate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await simulateTax(form);
      if (res.success) {
        setResult(res.data);
      }
    } catch (err) {
      setError('模拟失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSimulate();
  }, []);

  const fmt = (amt) => `¥ ${(amt || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const statusColor = (status) => ({
    green: 'text-green-600 bg-green-50 border-green-200',
    yellow: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    red: 'text-red-600 bg-red-50 border-red-200',
  }[status] || 'text-gray-600 bg-gray-50 border-gray-200');

  const statusIcon = (status) => {
    if (status === 'green') return <CheckCircle2 size={14} />;
    return <AlertTriangle size={14} />;
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* 输入区 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Calculator size={18} className="text-primary-600" />
          输入参数
        </h3>
        <div className="space-y-4">
          <SimInput label="季度佣金收入" value={form.quarterly_revenue}
            onChange={v => setForm({ ...form, quarterly_revenue: v })} prefix="¥" />
          <SimInput label="员工人数" value={form.employee_count}
            onChange={v => setForm({ ...form, employee_count: v })} suffix="人" />
          <SimInput label="月均工资" value={form.monthly_salary}
            onChange={v => setForm({ ...form, monthly_salary: v })} prefix="¥" suffix="/人/月" />
          <SimInput label="专项附加扣除" value={form.special_deduction}
            onChange={v => setForm({ ...form, special_deduction: v })} prefix="¥" suffix="/人/月" />
          <SimInput label="社保公积金比例" value={form.social_rate}
            onChange={v => setForm({ ...form, social_rate: v })} step={0.001} suffix="(企业部分)" />
          <SimInput label="其他季度成本" value={form.other_cost}
            onChange={v => setForm({ ...form, other_cost: v })} prefix="¥" suffix="/季度" />
          <SimInput label="利润率" value={form.profit_margin}
            onChange={v => setForm({ ...form, profit_margin: v })} step={0.001} />

          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">{error}</div>
          )}

          <button
            onClick={handleSimulate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
          >
            {loading ? <RefreshCw className="animate-spin" size={16} /> : <Calculator size={16} />}
            计算税务
          </button>
        </div>
      </div>

      {/* 输出区 */}
      <div className="space-y-4">
        {result && (
          <>
            {/* 增值税 */}
            <div className={`rounded-xl border p-4 ${statusColor(result.vat.status)}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium flex items-center gap-1.5">
                  {statusIcon(result.vat.status)}
                  增值税
                </span>
                <span className="text-xs">
                  {result.vat.exempt ? '免税' : '需缴纳'}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold">{fmt(result.vat.amount)}</p>
                  <p className="text-xs mt-1">
                    季度额度: {fmt(result.vat.remaining)} / {fmt(result.vat.quarterly_threshold)} ({result.vat.used_percent}%)
                  </p>
                </div>
              </div>
            </div>

            {/* 税费明细表 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="font-medium text-gray-800 mb-3 text-sm">税费明细</h4>
              <div className="space-y-2 text-sm">
                <SimRow label="增值税" value={fmt(result.vat.amount)} />
                <SimRow label="附加税费 (六税两费减半)" value={fmt(result.surtax)} />
                <SimRow label="印花税 (减半)" value={fmt(result.stamp)} />
                <SimRow label="企业所得税 (季度)" value={fmt(result.cit.quarterly)}
                  extra={result.cit.is_small_micro ? '小微企业5%' : '非小微25%'} />
                <SimRow label="个税代扣 (季度合计)" value={fmt(result.iit.quarterly_total)}
                  extra={`每人月均 ${fmt(result.iit.monthly_per_person)}`} />
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <SimRow label="税费合计 (季度)" value={fmt(result.profit.quarter_total_tax)} bold />
                </div>
              </div>
            </div>

            {/* 利润分析 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h4 className="font-medium text-gray-800 mb-3 text-sm flex items-center gap-1.5">
                <TrendingUp size={16} className="text-green-600" />
                利润分析
              </h4>
              <div className="space-y-2 text-sm">
                <SimRow label="季度毛利润" value={fmt(result.profit.quarter_gross)} />
                <SimRow label="工资支出" value={`- ${fmt(result.salary_total)}`} color="text-red-600" />
                <SimRow label="社保公积金" value={`- ${fmt(result.social_enterprise)}`} color="text-red-600" />
                <SimRow label="其他成本" value={`- ${fmt(form.other_cost)}`} color="text-red-600" />
                <SimRow label="税费合计" value={`- ${fmt(result.profit.quarter_total_tax)}`} color="text-red-600" />
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <SimRow label="季度净利润" value={fmt(result.profit.quarter_net)} bold color="text-green-600" />
                  <SimRow label="年化净利润" value={fmt(result.profit.annual_net_estimate)} bold color="text-green-600" />
                  <SimRow label="净利润率" value={`${result.profit.net_margin}%`} bold color="text-green-600" />
                </div>
              </div>
            </div>

            {/* 税负率对比 */}
            <div className={`rounded-xl border p-4 ${result.tax_burden.sufficient ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium flex items-center gap-1.5">
                  {result.tax_burden.sufficient ? <CheckCircle2 size={14} className="text-green-600" /> : <XCircle size={14} className="text-red-600" />}
                  税负率对比
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs text-gray-500">实际税负率</p>
                  <p className={`font-bold ${result.tax_burden.sufficient ? 'text-green-600' : 'text-red-600'}`}>
                    {result.tax_burden.actual_rate}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">预留税负率</p>
                  <p className="font-bold text-gray-700">1.00%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">差额</p>
                  <p className={`font-bold ${result.tax_burden.gap <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {result.tax_burden.gap > 0 ? '+' : ''}{result.tax_burden.gap}%
                  </p>
                </div>
              </div>
              {!result.tax_burden.sufficient && (
                <p className="text-xs text-red-600 mt-2">
                  ⚠️ 实际税负超过1%预留，建议提高税费预留比例或控制季度收入
                </p>
              )}
            </div>

            {/* 企税预警 */}
            <div className={`rounded-xl border p-4 ${statusColor(result.cit.status)}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium flex items-center gap-1.5">
                  {statusIcon(result.cit.status)}
                  企业所得税额度
                </span>
                <span className="text-xs">{result.cit.used_percent}%</span>
              </div>
              <p className="text-xs">
                年度应纳税所得额: {fmt(result.cit.annual_taxable_income)} / {fmt(result.cit.threshold)}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SimInput({ label, value, onChange, prefix, suffix, step = 1 }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        {prefix && <span className="text-gray-400 text-sm">{prefix}</span>}
        <input
          type="number"
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        {suffix && <span className="text-gray-400 text-xs whitespace-nowrap">{suffix}</span>}
      </div>
    </div>
  );
}

function SimRow({ label, value, bold, color }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${color || 'text-gray-700'}`}>{value}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 3: 额度看板
// ════════════════════════════════════════════════════════════

function QuotaDashboard({ knowledge }) {
  // 静态展示额度信息
  const quotas = knowledge ? [
    {
      title: '增值税季度免征额',
      threshold: knowledge.vat.threshold_quarterly,
      current: null,
      icon: Percent,
      color: 'blue',
      desc: `季度佣金 ≤ ${knowledge.vat.threshold_quarterly.toLocaleString()}元免征，超过则全额按${knowledge.vat.rate * 100}%征收`,
      note: knowledge.vat.note,
    },
    {
      title: '增值税月度免征线',
      threshold: knowledge.vat.threshold_monthly,
      current: null,
      icon: TrendingUp,
      color: 'cyan',
      desc: `月均佣金 ≤ ${knowledge.vat.threshold_monthly.toLocaleString()}元可享免税`,
      note: '季度30万 = 月均10万',
    },
    {
      title: '企业所得税年度限额',
      threshold: knowledge.cit.threshold_annual,
      current: null,
      icon: Receipt,
      color: 'green',
      desc: `年应纳税所得额 ≤ ${knowledge.cit.threshold_annual.toLocaleString()}元享5%优惠税率`,
      note: knowledge.cit.note,
    },
    {
      title: '个税月起征点',
      threshold: knowledge.iit.threshold_monthly,
      current: null,
      icon: Coins,
      color: 'orange',
      desc: `月工资 ≤ ${knowledge.iit.threshold_monthly.toLocaleString()}元免个税`,
      note: `年起征点 ${knowledge.iit.threshold_annual.toLocaleString()}元`,
    },
  ] : [];

  const colorMap = {
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-600', bar: 'bg-blue-500' },
    cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-600', bar: 'bg-cyan-500' },
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-600', bar: 'bg-green-500' },
    orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600', bar: 'bg-orange-500' },
  };

  return (
    <div className="space-y-4">
      <div className="bg-primary-50 rounded-xl border border-primary-200 p-4">
        <p className="text-sm text-primary-700">
          以下额度适用于 <strong>{knowledge?.company?.name}</strong>（{knowledge?.company?.type}），
          政策有效期至 <strong>2027年12月31日</strong>。
          请在税务模拟器中输入实际经营数据，实时查看额度使用情况。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {quotas.map((q, i) => {
          const Icon = q.icon;
          const c = colorMap[q.color] || colorMap.blue;
          return (
            <div key={i} className={`rounded-xl border p-5 ${c.bg} ${c.border}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 ${c.bg} rounded-lg flex items-center justify-center`}>
                  <Icon className={c.text} size={20} />
                </div>
                <h3 className="font-bold text-gray-800">{q.title}</h3>
              </div>
              <div className="mb-3">
                <p className="text-2xl font-bold text-gray-800">
                  ¥ {q.threshold.toLocaleString('zh-CN')}
                </p>
              </div>
              <p className="text-sm text-gray-600 mb-1">{q.desc}</p>
              <p className="text-xs text-gray-400">{q.note}</p>
            </div>
          );
        })}
      </div>

      {/* 六税两费 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="text-purple-600" size={20} />
          <h3 className="font-bold text-gray-800">{knowledge?.surtax?.title}</h3>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500 mb-1">包含税种:</p>
            <div className="flex flex-wrap gap-2">
              {knowledge?.surtax?.items.map((item, i) => (
                <span key={i} className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs border border-purple-200">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-gray-500 mb-1">减免政策:</p>
            <p className="text-gray-700">{knowledge?.surtax?.reduction}</p>
            <p className="text-xs text-gray-400 mt-1">有效期至: {knowledge?.surtax?.deadline}</p>
          </div>
        </div>
      </div>

      {/* 印花税 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="text-indigo-600" size={20} />
          <h3 className="font-bold text-gray-800">{knowledge?.stamp?.title}</h3>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">法定税率:</p>
            <p className="text-gray-700 font-medium">{knowledge?.stamp?.rate}</p>
          </div>
          <div>
            <p className="text-gray-500">减免后实际:</p>
            <p className="text-gray-700 font-medium">{knowledge?.stamp?.reduction}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
