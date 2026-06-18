import { useState, useMemo } from 'react';
import {
  Plus, Trash2, RefreshCw, AlertTriangle, CheckCircle2,
  TrendingUp, Wallet, Shield, Calculator
} from 'lucide-react';

/**
 * 薪资规划器 — 按标准工资表格式展示，实时监控增值税季度30万免征线。
 *
 * 核心逻辑:
 * 1. 用户输入每月佣金收入 + 员工薪资信息
 * 2. 自动计算社保公积金（个人+企业）、个税、实发工资
 * 3. 季度佣金累计 vs 30万免征线 → 绿/黄/红预警
 * 4. 反推"本月还能接多少佣金不触发增值税"
 *
 * 社保比例参考（深圳）:
 *   个人: 养老8% + 医疗2% + 失业0.3% + 公积金7% ≈ 17.3% (按工资基数)
 *   企业: 养老15% + 医疗5.2% + 失业0.7% + 工伤0.2% + 公积金7% ≈ 28.1% (按工资基数)
 *   注: 实际比例可能因户籍/政策微调，此处取常用估算值
 */

// ── 社保公积金比例（可配置）──────────────────────────────
const SOCIAL_PERSONAL_RATE = 0.173;  // 个人部分 ~17.3%
const SOCIAL_ENTERPRISE_RATE = 0.281; // 企业部分 ~28.1%
const IIT_THRESHOLD = 5000;           // 个税起征点（月）

// ── 个税七级累进（年累计预扣预缴）────────────────────────
const IIT_BRACKETS = [
  { limit: 36000,    rate: 0.03, deduction: 0 },
  { limit: 144000,   rate: 0.10, deduction: 2520 },
  { limit: 300000,   rate: 0.20, deduction: 16920 },
  { limit: 420000,   rate: 0.25, deduction: 31920 },
  { limit: 660000,   rate: 0.30, deduction: 52920 },
  { limit: 960000,   rate: 0.35, deduction: 85920 },
  { limit: Infinity,  rate: 0.45, deduction: 181920 },
];

/**
 * 计算月个税（简化：按月均摊年累计）
 */
function calcMonthlyIIT(monthlySalary, specialDeduction = 0) {
  const socialPersonal = monthlySalary * SOCIAL_PERSONAL_RATE;
  const monthlyTaxable = Math.max(0, monthlySalary - IIT_THRESHOLD - specialDeduction - socialPersonal);
  if (monthlyTaxable <= 0) return { tax: 0, taxable: 0, socialPersonal };

  // 年累计应纳税所得额
  const annualTaxable = monthlyTaxable * 12;
  // 找对应档位
  let annualTax = 0;
  for (const bracket of IIT_BRACKETS) {
    if (annualTaxable <= bracket.limit) {
      annualTax = annualTaxable * bracket.rate - bracket.deduction;
      break;
    }
  }
  annualTax = Math.max(0, annualTax);
  return {
    tax: Math.round(annualTax / 12 * 100) / 100,
    taxable: Math.round(monthlyTaxable * 100) / 100,
    socialPersonal: Math.round(socialPersonal * 100) / 100,
  };
}

// ── 默认员工数据 ─────────────────────────────────────────
const DEFAULT_EMPLOYEES = [
  { id: 1, name: '员工1', baseSalary: 6000, allowance: 0, specialDeduction: 0 },
  { id: 2, name: '员工2', baseSalary: 6000, allowance: 0, specialDeduction: 0 },
  { id: 3, name: '员工3', baseSalary: 5000, allowance: 0, specialDeduction: 0 },
];

// ── 月份定义 ─────────────────────────────────────────────
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export default function SalaryPlanner() {
  // 员工列表
  const [employees, setEmployees] = useState(DEFAULT_EMPLOYEES);
  // 每月佣金收入
  const [monthlyRevenues, setMonthlyRevenues] = useState(Array(12).fill(0).map((_, i) => {
    if (i < 3) return 80000;  // Q1 示例
    if (i < 6) return 90000;  // Q2 示例
    return 0;
  }));
  // 当前选中季度
  const [activeQuarter, setActiveQuarter] = useState(0); // 0=Q1, 1=Q2, 2=Q3, 3=Q4

  // ── 计算每月工资详情 ──────────────────────────────────
  const monthlySalaryDetails = useMemo(() => {
    return employees.map(emp => {
      const gross = emp.baseSalary + emp.allowance;
      const { tax, taxable, socialPersonal } = calcMonthlyIIT(emp.baseSalary, emp.specialDeduction);
      const housingPersonal = 0;  // 已包含在 SOCIAL_PERSONAL_RATE 中
      const totalDeduction = socialPersonal + tax;
      const netPay = gross - totalDeduction;
      const socialEnterprise = emp.baseSalary * SOCIAL_ENTERPRISE_RATE;
      const totalCost = gross + socialEnterprise;

      return {
        ...emp,
        gross,
        socialPersonal,
        tax,
        totalDeduction,
        netPay,
        socialEnterprise: Math.round(socialEnterprise * 100) / 100,
        totalCost: Math.round(totalCost * 100) / 100,
        taxable,
      };
    });
  }, [employees]);

  // ── 月度汇总 ──────────────────────────────────────────
  const monthlyTotals = useMemo(() => {
    const totalGross = monthlySalaryDetails.reduce((s, e) => s + e.gross, 0);
    const totalNet = monthlySalaryDetails.reduce((s, e) => s + e.netPay, 0);
    const totalTax = monthlySalaryDetails.reduce((s, e) => s + e.tax, 0);
    const totalSocialPersonal = monthlySalaryDetails.reduce((s, e) => s + e.socialPersonal, 0);
    const totalSocialEnterprise = monthlySalaryDetails.reduce((s, e) => s + e.socialEnterprise, 0);
    const totalCost = monthlySalaryDetails.reduce((s, e) => s + e.totalCost, 0);
    return {
      gross: Math.round(totalGross * 100) / 100,
      net: Math.round(totalNet * 100) / 100,
      tax: Math.round(totalTax * 100) / 100,
      socialPersonal: Math.round(totalSocialPersonal * 100) / 100,
      socialEnterprise: Math.round(totalSocialEnterprise * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    };
  }, [monthlySalaryDetails]);

  // ── 季度汇总 ──────────────────────────────────────────
  const quarters = useMemo(() => {
    return [0, 1, 2, 3].map(qi => {
      const months = [qi * 3, qi * 3 + 1, qi * 3 + 2];
      const revenue = months.reduce((s, m) => s + (monthlyRevenues[m] || 0), 0);
      const salaryCost = monthlyTotals.totalCost * 3;  // 季度工资成本
      const threshold = 300000;
      const usedPct = Math.round(revenue / threshold * 100 * 10) / 10;
      const remaining = Math.round((threshold - revenue) * 100) / 100;
      const isExempt = revenue <= threshold;
      const status = usedPct < 80 ? 'green' : usedPct < 100 ? 'yellow' : 'red';

      // 季度净利润估算
      const profitMargin = 0.04;  // 4%盈利
      const grossProfit = revenue * profitMargin;
      const vat = isExempt ? 0 : Math.round(revenue * 0.01 * 100) / 100;
      const surtax = Math.round(vat * 0.06 * 100) / 100;
      const stamp = Math.round(revenue * 0.00025 * 100) / 100;
      const cit = Math.round(Math.max(0, (grossProfit - surtax - stamp - salaryCost) * 0.05) * 100) / 100;
      const netProfit = Math.round((grossProfit - surtax - stamp - salaryCost - cit) * 100) / 100;

      return {
        index: qi,
        label: `Q${qi + 1}`,
        months,
        revenue: Math.round(revenue * 100) / 100,
        salaryCost: Math.round(salaryCost * 100) / 100,
        threshold,
        usedPct,
        remaining,
        isExempt,
        status,
        vat,
        surtax,
        stamp,
        cit,
        grossProfit: Math.round(grossProfit * 100) / 100,
        netProfit,
      };
    });
  }, [monthlyRevenues, monthlyTotals]);

  // ── 年度汇总 ──────────────────────────────────────────
  const annualSummary = useMemo(() => {
    const totalRevenue = monthlyRevenues.reduce((s, r) => s + r, 0);
    const totalSalaryCost = monthlyTotals.totalCost * 12;
    const totalGrossProfit = totalRevenue * 0.04;
    const totalVAT = quarters.reduce((s, q) => s + q.vat, 0);
    const totalCIT = quarters.reduce((s, q) => s + q.cit, 0);
    const totalTax = totalVAT + totalCIT + quarters.reduce((s, q) => s + q.surtax + q.stamp, 0);
    return {
      revenue: Math.round(totalRevenue * 100) / 100,
      salaryCost: Math.round(totalSalaryCost * 100) / 100,
      grossProfit: Math.round(totalGrossProfit * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      netProfit: Math.round((totalGrossProfit - totalSalaryCost - totalTax) * 100) / 100,
    };
  }, [monthlyRevenues, monthlyTotals, quarters]);

  // ── 操作 ──────────────────────────────────────────────
  const addEmployee = () => {
    setEmployees([...employees, {
      id: Date.now(),
      name: `员工${employees.length + 1}`,
      baseSalary: 5000,
      allowance: 0,
      specialDeduction: 0,
    }]);
  };

  const removeEmployee = (id) => {
    setEmployees(employees.filter(e => e.id !== id));
  };

  const updateEmployee = (id, field, value) => {
    setEmployees(employees.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const updateRevenue = (monthIdx, value) => {
    const newRevenues = [...monthlyRevenues];
    newRevenues[monthIdx] = value;
    setMonthlyRevenues(newRevenues);
  };

  // ── 格式化 ────────────────────────────────────────────
  const fmt = (amt) => `¥ ${(amt || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const statusStyle = {
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: CheckCircle2 },
    yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: AlertTriangle },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: AlertTriangle },
  };

  return (
    <div className="space-y-6">
      {/* 说明栏 */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
        <p className="text-sm text-blue-700">
          按照你的工资表格式，录入员工薪资信息 + 每月佣金收入，系统自动计算社保公积金、个税、实发工资，
          并实时监控<strong>季度佣金累计是否超过30万增值税免征线</strong>。
          调整薪资或佣金收入，即可看到对免税资格的影响。
        </p>
      </div>

      {/* ══ 工资表 ══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Wallet size={18} className="text-primary-600" />
            月度工资表
          </h3>
          <button
            onClick={addEmployee}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            <Plus size={14} />
            添加员工
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="px-2 py-3 text-center font-medium w-10">序号</th>
                <th className="px-2 py-3 text-left font-medium w-24">姓名</th>
                <th className="px-2 py-3 text-right font-medium">基本工资</th>
                <th className="px-2 py-3 text-right font-medium">岗位/补贴</th>
                <th className="px-2 py-3 text-right font-medium bg-blue-50/50">应发合计</th>
                <th className="px-2 py-3 text-right font-medium">社保个人</th>
                <th className="px-2 py-3 text-right font-medium">专项附加扣除</th>
                <th className="px-2 py-3 text-right font-medium">个税</th>
                <th className="px-2 py-3 text-right font-medium bg-green-50/50">实发工资</th>
                <th className="px-2 py-3 text-right font-medium">社保企业</th>
                <th className="px-2 py-3 text-right font-medium bg-orange-50/50">用工成本合计</th>
                <th className="px-2 py-3 text-center font-medium w-12">操作</th>
              </tr>
            </thead>
            <tbody>
              {monthlySalaryDetails.map((emp, idx) => (
                <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50/30">
                  <td className="px-2 py-2 text-center text-gray-400">{idx + 1}</td>
                  <td className="px-2 py-2">
                    <input
                      value={emp.name}
                      onChange={(e) => updateEmployee(emp.id, 'name', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="100"
                      value={emp.baseSalary}
                      onChange={(e) => updateEmployee(emp.id, 'baseSalary', parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="100"
                      value={emp.allowance}
                      onChange={(e) => updateEmployee(emp.id, 'allowance', parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-right font-medium text-blue-700 bg-blue-50/30">{fmt(emp.gross)}</td>
                  <td className="px-2 py-2 text-right text-gray-600">{fmt(emp.socialPersonal)}</td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      step="100"
                      value={emp.specialDeduction}
                      onChange={(e) => updateEmployee(emp.id, 'specialDeduction', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-2 py-2 text-right text-orange-600">{fmt(emp.tax)}</td>
                  <td className="px-2 py-2 text-right font-bold text-green-700 bg-green-50/30">{fmt(emp.netPay)}</td>
                  <td className="px-2 py-2 text-right text-gray-600">{fmt(emp.socialEnterprise)}</td>
                  <td className="px-2 py-2 text-right font-medium text-orange-700 bg-orange-50/30">{fmt(emp.totalCost)}</td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => removeEmployee(emp.id)}
                      className="p-1 text-red-400 hover:bg-red-50 rounded"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* 合计行 */}
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                <td colSpan="2" className="px-2 py-3 text-center text-gray-700">月度合计</td>
                <td className="px-2 py-3 text-right text-gray-700">{fmt(employees.reduce((s, e) => s + e.baseSalary, 0))}</td>
                <td className="px-2 py-3 text-right text-gray-700">{fmt(employees.reduce((s, e) => s + e.allowance, 0))}</td>
                <td className="px-2 py-3 text-right text-blue-700 bg-blue-50/50">{fmt(monthlyTotals.gross)}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmt(monthlyTotals.socialPersonal)}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmt(employees.reduce((s, e) => s + e.specialDeduction, 0))}</td>
                <td className="px-2 py-3 text-right text-orange-600">{fmt(monthlyTotals.tax)}</td>
                <td className="px-2 py-3 text-right text-green-700 bg-green-50/50">{fmt(monthlyTotals.net)}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmt(monthlyTotals.socialEnterprise)}</td>
                <td className="px-2 py-3 text-right text-orange-700 bg-orange-50/50">{fmt(monthlyTotals.totalCost)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 比例说明 */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          社保个人比例 ~{((SOCIAL_PERSONAL_RATE) * 100).toFixed(1)}%（养老8%+医疗2%+失业0.3%+公积金7%）·
          社保企业比例 ~{((SOCIAL_ENTERPRISE_RATE) * 100).toFixed(1)}%（养老15%+医疗5.2%+失业0.7%+工伤0.2%+公积金7%）·
          个税起征点 ¥5,000/月
        </div>
      </div>

      {/* ══ 月度佣金收入录入 ══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-primary-600" />
          月度佣金收入录入
        </h3>
        <div className="grid grid-cols-6 gap-3">
          {MONTHS.map((month, idx) => {
            const quarterIdx = Math.floor(idx / 3);
            const quarterColors = ['blue', 'green', 'orange', 'purple'];
            const colors = {
              blue: 'border-blue-200 bg-blue-50/30',
              green: 'border-green-200 bg-green-50/30',
              orange: 'border-orange-200 bg-orange-50/30',
              purple: 'border-purple-200 bg-purple-50/30',
            };
            return (
              <div key={idx} className={`rounded-lg border p-3 ${colors[quarterColors[quarterIdx]]}`}>
                <p className="text-xs text-gray-500 mb-1">{month}</p>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">¥</span>
                  <input
                    type="number"
                    step="1000"
                    value={monthlyRevenues[idx] || 0}
                    onChange={(e) => updateRevenue(idx, parseFloat(e.target.value) || 0)}
                    className="w-full px-1 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ 季度增值税免征监控 ══ */}
      <div className="space-y-3">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Shield size={18} className="text-primary-600" />
          季度增值税免征监控（阈值: ¥300,000 / 季度）
        </h3>
        <div className="grid grid-cols-4 gap-4">
          {quarters.map((q) => {
            const style = statusStyle[q.status];
            const StatusIcon = style.icon;
            return (
              <div key={q.index} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-gray-800">{q.label}</span>
                  <span className={`flex items-center gap-1 text-xs ${style.text}`}>
                    <StatusIcon size={14} />
                    {q.isExempt ? '免税' : '需缴税'}
                  </span>
                </div>

                {/* 进度条 */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">季度佣金</span>
                    <span className={style.text}>{q.usedPct}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        q.status === 'green' ? 'bg-green-500' : q.status === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, q.usedPct)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-gray-600">{fmt(q.revenue)}</span>
                    <span className="text-gray-400">/ {fmt(q.threshold)}</span>
                  </div>
                </div>

                {/* 状态信息 */}
                {q.status === 'green' && (
                  <p className="text-xs text-green-600">
                    剩余额度 {fmt(q.remaining)}，安全
                  </p>
                )}
                {q.status === 'yellow' && (
                  <p className="text-xs text-yellow-600">
                    ⚠️ 已用 {q.usedPct}%，仅剩 {fmt(q.remaining)}，下月慎接单
                  </p>
                )}
                {q.status === 'red' && (
                  <p className="text-xs text-red-600">
                    ⛔ 已超免征线！全额按1%征收，增值税 = {fmt(q.vat)}
                  </p>
                )}

                {/* 利润简报 */}
                <div className="mt-3 pt-3 border-t border-gray-200/50 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">工资成本</span>
                    <span className="text-gray-700">{fmt(q.salaryCost)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">毛利润(4%)</span>
                    <span className="text-gray-700">{fmt(q.grossProfit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">税费合计</span>
                    <span className="text-gray-700">{fmt(q.vat + q.surtax + q.stamp + q.cit)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span className="text-gray-600">季度净利润</span>
                    <span className={q.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {fmt(q.netProfit)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ 年度汇总 ══ */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-xl p-6 text-white">
        <h3 className="font-bold mb-4 flex items-center gap-2">
          <Calculator size={18} />
          年度汇总估算
        </h3>
        <div className="grid grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">年度佣金总收入</p>
            <p className="text-lg font-bold">{fmt(annualSummary.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度工资成本</p>
            <p className="text-lg font-bold text-orange-300">{fmt(annualSummary.salaryCost)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度毛利润(4%)</p>
            <p className="text-lg font-bold text-blue-300">{fmt(annualSummary.grossProfit)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度税费合计</p>
            <p className="text-lg font-bold text-yellow-300">{fmt(annualSummary.totalTax)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度净利润</p>
            <p className={`text-lg font-bold ${annualSummary.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmt(annualSummary.netProfit)}
            </p>
          </div>
        </div>
      </div>

      {/* ══ 决策建议 ══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-yellow-500" />
          决策建议
        </h3>
        <div className="space-y-2 text-sm text-gray-600">
          {quarters.filter(q => q.status === 'red').length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              ⛔ 有 {quarters.filter(q => q.status === 'red').length} 个季度超过30万免征线，
              超出后<strong>全部佣金</strong>按1%征收增值税。
              建议：将部分佣金收入延后至下一个季度确认，或提前规划接单节奏。
            </div>
          )}
          {quarters.filter(q => q.status === 'yellow').length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
              ⚠️ 有 {quarters.filter(q => q.status === 'yellow').length} 个季度接近30万免征线，
              请控制剩余月份的接单量，避免触发增值税。
            </div>
          )}
          {annualSummary.netProfit < 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              ⛔ 年度净利润为负！工资成本超过毛利润，建议降低工资支出或增加佣金收入。
            </div>
          )}
          {quarters.filter(q => q.status === 'green').length === 4 && annualSummary.netProfit > 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
              ✅ 全部季度均在免征线内，经营状况良好！
              当前还有 {fmt(quarters.reduce((s, q) => s + Math.max(0, q.remaining), 0))} 的年度免征额度空间。
            </div>
          )}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
            💡 每月工资成本为 {fmt(monthlyTotals.totalCost)}，季度工资成本为 {fmt(monthlyTotals.totalCost * 3)}。
            要保持季度佣金 ≤ 30万，月均佣金应控制在 {fmt(100000)} 以内。
          </div>
        </div>
      </div>
    </div>
  );
}
