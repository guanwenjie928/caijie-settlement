import { useState, useMemo } from 'react';
import {
  Plus, Trash2, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, Wallet, Shield, Calculator, ArrowRight
} from 'lucide-react';

/**
 * 薪资规划器 — 佣金套现规划工具
 *
 * 核心业务逻辑:
 * 1. 每月佣金进账 → 4%是利润 + 1%税费预留 + 95%需套现出去给别人
 * 2. 发工资 = 套现手段：通过发工资把95%的钱合法转出
 * 3. 规划目标：每月工资实发总额 ≈ 95%佣金，实现精准套现
 * 4. 增值税免征：季度佣金累计 ≤ 30万
 *
 * 数据来源: 真实员工工资表（深圳市此刻的文化创意有限公司）
 */

const IIT_THRESHOLD = 5000;
const PROFIT_RATE = 0.04;
const TAX_RATE = 0.01;
const CASHOUT_RATE = 0.95;  // 1 - 0.04 - 0.01

const IIT_BRACKETS = [
  { limit: 36000,    rate: 0.03, deduction: 0 },
  { limit: 144000,   rate: 0.10, deduction: 2520 },
  { limit: 300000,   rate: 0.20, deduction: 16920 },
  { limit: 420000,   rate: 0.25, deduction: 31920 },
  { limit: 660000,   rate: 0.30, deduction: 52920 },
  { limit: 960000,   rate: 0.35, deduction: 85920 },
  { limit: Infinity,  rate: 0.45, deduction: 181920 },
];

function calcIIT(gross, totalSocialPersonal, specialDeduction = 0) {
  const monthlyTaxable = Math.max(0, gross - IIT_THRESHOLD - specialDeduction - totalSocialPersonal);
  if (monthlyTaxable <= 0) return { tax: 0, taxable: 0 };
  const annualTaxable = monthlyTaxable * 12;
  let annualTax = 0;
  for (const b of IIT_BRACKETS) {
    if (annualTaxable <= b.limit) {
      annualTax = annualTaxable * b.rate - b.deduction;
      break;
    }
  }
  return { tax: Math.round(Math.max(0, annualTax) / 12 * 100) / 100, taxable: Math.round(monthlyTaxable * 100) / 100 };
}

function calcEnterpriseSocial(pensionP, medicalP, unemploymentP, housingP) {
  const pensionBase = pensionP > 0 ? pensionP / 0.08 : 0;
  const medicalBase = medicalP > 0 ? medicalP / 0.02 : 0;
  const unemploymentBase = unemploymentP > 0 ? unemploymentP / 0.003 : 0;
  const pensionE = Math.round(pensionBase * 0.15 * 100) / 100;
  const medicalE = Math.round(medicalBase * 0.052 * 100) / 100;
  const unemploymentE = Math.round(unemploymentBase * 0.007 * 100) / 100;
  const workInjuryE = Math.round(pensionBase * 0.002 * 100) / 100;
  const housingE = housingP;
  return {
    pension: pensionE, medical: medicalE, unemployment: unemploymentE,
    workInjury: workInjuryE, housing: housingE,
    total: Math.round((pensionE + medicalE + unemploymentE + workInjuryE + housingE) * 100) / 100,
  };
}

// ── 真实员工数据 ─────────────────────────────────────────
const DEFAULT_EMPLOYEES = [
  { id: 1, name: '黄嘉雯', grossSalary: 4400.00, pensionP: 0, medicalP: 0, unemploymentP: 0, housingP: 0, specialDeduction: 0 },
  { id: 2, name: '余红英', grossSalary: 5026.54, pensionP: 480.00, medicalP: 134.54, unemploymentP: 12.00, housingP: 0, specialDeduction: 0 },
  { id: 3, name: '张子雯', grossSalary: 4400.00, pensionP: 0, medicalP: 0, unemploymentP: 0, housingP: 0, specialDeduction: 0 },
  { id: 4, name: '巫原齿', grossSalary: 4926.17, pensionP: 382.08, medicalP: 134.54, unemploymentP: 9.55, housingP: 0, specialDeduction: 0 },
  { id: 5, name: '许燕要', grossSalary: 4926.17, pensionP: 382.08, medicalP: 134.54, unemploymentP: 9.55, housingP: 0, specialDeduction: 0 },
];

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

export default function SalaryPlanner() {
  const [employees, setEmployees] = useState(DEFAULT_EMPLOYEES);
  const [monthlyRevenues, setMonthlyRevenues] = useState(Array(12).fill(0).map((_, i) => {
    if (i < 3) return 80000;
    if (i < 6) return 90000;
    return 0;
  }));

  // ── 工资计算 ──────────────────────────────────────────
  const salaryDetails = useMemo(() => {
    return employees.map(emp => {
      const totalSocialPersonal = emp.pensionP + emp.medicalP + emp.unemploymentP + emp.housingP;
      const { tax } = calcIIT(emp.grossSalary, totalSocialPersonal, emp.specialDeduction);
      const netPay = Math.round((emp.grossSalary - totalSocialPersonal - tax) * 100) / 100;
      const enterprise = calcEnterpriseSocial(emp.pensionP, emp.medicalP, emp.unemploymentP, emp.housingP);
      const totalCost = Math.round((emp.grossSalary + enterprise.total) * 100) / 100;
      return {
        ...emp,
        totalSocialPersonal: Math.round(totalSocialPersonal * 100) / 100,
        tax, netPay, enterprise, totalCost,
      };
    });
  }, [employees]);

  // 每月工资实发总额（=套现金额）
  const monthlyNetTotal = useMemo(() => {
    return Math.round(salaryDetails.reduce((s, e) => s + e.netPay, 0) * 100) / 100;
  }, [salaryDetails]);

  // 每月工资成本总额（含企业社保）
  const monthlyCostTotal = useMemo(() => {
    return Math.round(salaryDetails.reduce((s, e) => s + e.totalCost, 0) * 100) / 100;
  }, [salaryDetails]);

  // ── 月度套现规划 ──────────────────────────────────────
  const monthlyPlan = useMemo(() => {
    return MONTHS.map((label, idx) => {
      const revenue = monthlyRevenues[idx] || 0;
      const profit = Math.round(revenue * PROFIT_RATE * 100) / 100;
      const tax = Math.round(revenue * TAX_RATE * 100) / 100;
      const cashoutTarget = Math.round(revenue * CASHOUT_RATE * 100) / 100;
      const actualCashout = monthlyNetTotal;  // 每月固定工资
      const diff = Math.round((cashoutTarget - actualCashout) * 100) / 100;
      const matchStatus = Math.abs(diff) < 100 ? 'matched' : (diff > 0 ? 'deficit' : 'surplus');

      return { idx, label, revenue, profit, tax, cashoutTarget, actualCashout, diff, matchStatus };
    });
  }, [monthlyRevenues, monthlyNetTotal]);

  // ── 季度汇总 ──────────────────────────────────────────
  const quarters = useMemo(() => {
    return [0, 1, 2, 3].map(qi => {
      const months = [qi * 3, qi * 3 + 1, qi * 3 + 2];
      const revenue = months.reduce((s, m) => s + (monthlyRevenues[m] || 0), 0);
      const profit = Math.round(revenue * PROFIT_RATE * 100) / 100;
      const taxReserve = Math.round(revenue * TAX_RATE * 100) / 100;
      const cashoutTarget = Math.round(revenue * CASHOUT_RATE * 100) / 100;
      const actualSalary = monthlyNetTotal * 3;
      const threshold = 300000;
      const usedPct = revenue > 0 ? Math.round(revenue / threshold * 100 * 10) / 10 : 0;
      const remaining = Math.round((threshold - revenue) * 100) / 100;
      const isExempt = revenue <= threshold;
      const vatStatus = usedPct < 80 ? 'green' : usedPct < 100 ? 'yellow' : 'red';
      const vat = isExempt ? 0 : Math.round(revenue * 0.01 * 100) / 100;
      const cashoutDiff = Math.round((cashoutTarget - actualSalary) * 100) / 100;

      return {
        index: qi, label: `Q${qi + 1}`, months,
        revenue: Math.round(revenue * 100) / 100,
        profit, taxReserve, cashoutTarget, actualSalary, cashoutDiff,
        threshold, usedPct, remaining, isExempt, vatStatus, vat,
      };
    });
  }, [monthlyRevenues, monthlyNetTotal]);

  // ── 年度汇总 ──────────────────────────────────────────
  const annualSummary = useMemo(() => {
    const totalRevenue = monthlyRevenues.reduce((s, r) => s + r, 0);
    return {
      revenue: Math.round(totalRevenue * 100) / 100,
      profit: Math.round(totalRevenue * PROFIT_RATE * 100) / 100,
      taxReserve: Math.round(totalRevenue * TAX_RATE * 100) / 100,
      cashoutTarget: Math.round(totalRevenue * CASHOUT_RATE * 100) / 100,
      actualSalary: Math.round(monthlyNetTotal * 12 * 100) / 100,
      actualCost: Math.round(monthlyCostTotal * 12 * 100) / 100,
      cashoutDiff: Math.round((totalRevenue * CASHOUT_RATE - monthlyNetTotal * 12) * 100) / 100,
    };
  }, [monthlyRevenues, monthlyNetTotal, monthlyCostTotal]);

  // ── 操作 ──────────────────────────────────────────────
  const addEmployee = () => {
    setEmployees([...employees, {
      id: Date.now(), name: `员工${employees.length + 1}`,
      grossSalary: 4400, pensionP: 0, medicalP: 0, unemploymentP: 0, housingP: 0, specialDeduction: 0,
    }]);
  };
  const removeEmployee = (id) => setEmployees(employees.filter(e => e.id !== id));
  const updateEmployee = (id, field, value) => {
    setEmployees(employees.map(e => e.id === id ? { ...e, [field]: value } : e));
  };
  const updateRevenue = (idx, value) => {
    const next = [...monthlyRevenues];
    next[idx] = value;
    setMonthlyRevenues(next);
  };

  const fmt = (amt) => `¥ ${(amt || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtNum = (amt) => (amt || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const matchStyle = {
    matched: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', label: '匹配', icon: CheckCircle2 },
    deficit:  { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-700',   label: '套现不足', icon: AlertTriangle },
    surplus:  { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', label: '超额套现', icon: AlertTriangle },
  };

  const vatStatusStyle = {
    green:  { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  icon: CheckCircle2 },
    yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: AlertTriangle },
    red:    { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    icon: XCircle },
  };

  return (
    <div className="space-y-6">
      {/* 说明栏 */}
      <div className="bg-gradient-to-r from-blue-50 to-primary-50 rounded-xl border border-blue-200 p-4">
        <p className="text-sm text-blue-700">
          <strong>套现规划逻辑：</strong>
          每月佣金进账后，4%是你的利润，1%预留税费，<strong>95%需要通过发工资套现出去</strong>。
          下方表格帮你精准匹配「需套现金额」与「实际工资实发」，确保不多发不少发。
        </p>
      </div>

      {/* ══ Section 1: 月度佣金 → 套现规划 ══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h3 className="font-bold text-gray-800 px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
          <TrendingUp size={18} className="text-primary-600" />
          月度佣金 → 套现规划
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="px-3 py-3 text-left font-medium">月份</th>
                <th className="px-3 py-3 text-right font-medium">佣金收入</th>
                <th className="px-3 py-3 text-right font-medium text-blue-600">利润 4%</th>
                <th className="px-3 py-3 text-right font-medium text-orange-600">税费预留 1%</th>
                <th className="px-3 py-3 text-right font-medium text-purple-600 bg-purple-50/30">需套现 95%</th>
                <th className="px-3 py-3 text-right font-medium">工资实发</th>
                <th className="px-3 py-3 text-right font-medium">套现差额</th>
                <th className="px-3 py-3 text-center font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {monthlyPlan.map((m) => {
                const ms = matchStyle[m.matchStatus];
                const MIcon = ms.icon;
                const quarterColors = ['bg-blue-50/20', 'bg-green-50/20', 'bg-orange-50/20', 'bg-purple-50/20'];
                return (
                  <tr key={m.idx} className={`border-b border-gray-100 ${quarterColors[Math.floor(m.idx / 3)]}`}>
                    <td className="px-3 py-2 font-medium text-gray-700">{m.label}</td>
                    <td className="px-3 py-2">
                      <input type="number" step="1000" value={m.revenue}
                        onChange={(e) => updateRevenue(m.idx, parseFloat(e.target.value) || 0)}
                        className="w-28 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" />
                    </td>
                    <td className="px-3 py-2 text-right text-blue-600 font-medium">{fmtNum(m.profit)}</td>
                    <td className="px-3 py-2 text-right text-orange-600">{fmtNum(m.tax)}</td>
                    <td className="px-3 py-2 text-right text-purple-700 font-bold bg-purple-50/30">{fmtNum(m.cashoutTarget)}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{fmtNum(m.actualCashout)}</td>
                    <td className={`px-3 py-2 text-right font-bold ${m.diff > 0 ? 'text-red-600' : m.diff < 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                      {m.diff > 0 ? '+' : ''}{fmtNum(m.diff)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${ms.bg} ${ms.border} ${ms.text} border`}>
                        <MIcon size={12} />
                        {ms.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                <td className="px-3 py-3 text-gray-700">年度合计</td>
                <td className="px-3 py-3 text-right text-gray-800">{fmt(annualSummary.revenue)}</td>
                <td className="px-3 py-3 text-right text-blue-600">{fmt(annualSummary.profit)}</td>
                <td className="px-3 py-3 text-right text-orange-600">{fmt(annualSummary.taxReserve)}</td>
                <td className="px-3 py-3 text-right text-purple-700 bg-purple-50/50">{fmt(annualSummary.cashoutTarget)}</td>
                <td className="px-3 py-3 text-right text-gray-700">{fmt(annualSummary.actualSalary)}</td>
                <td className={`px-3 py-3 text-right ${annualSummary.cashoutDiff > 0 ? 'text-red-600' : annualSummary.cashoutDiff < 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {annualSummary.cashoutDiff > 0 ? '+' : ''}{fmt(annualSummary.cashoutDiff)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          <strong>套现差额 = 需套现95% - 工资实发合计</strong> ·
          差额 {'>'} 0 = 套现不足（钱没发出去，留在公司账上）·
          差额 {'<'} 0 = 超额套现（发的工资比进账多）·
          差额 ≈ 0 = 精准匹配
        </div>
      </div>

      {/* ══ Section 2: 工资表（套现工具）══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
          <div>
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <Wallet size={18} className="text-primary-600" />
              工资表（套现工具）
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              每月实发合计 {fmt(monthlyNetTotal)} · 用工成本合计 {fmt(monthlyCostTotal)}（含企业社保）
            </p>
          </div>
          <button onClick={addEmployee}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            <Plus size={14} /> 添加员工
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="px-2 py-3 text-center font-medium w-10">序号</th>
                <th className="px-2 py-3 text-left font-medium w-20">姓名</th>
                <th className="px-2 py-3 text-right font-medium bg-blue-50/50">工资总额</th>
                <th className="px-2 py-3 text-right font-medium">养老(个人)</th>
                <th className="px-2 py-3 text-right font-medium">医疗(个人)</th>
                <th className="px-2 py-3 text-right font-medium">失业(个人)</th>
                <th className="px-2 py-3 text-right font-medium">公积金(个人)</th>
                <th className="px-2 py-3 text-right font-medium">个税</th>
                <th className="px-2 py-3 text-right font-medium bg-green-50/50">实发工资</th>
                <th className="px-2 py-3 text-right font-medium">企业社保合计</th>
                <th className="px-2 py-3 text-right font-medium bg-orange-50/50">用工成本</th>
                <th className="px-2 py-3 text-center w-12">操作</th>
              </tr>
            </thead>
            <tbody>
              {salaryDetails.map((emp, idx) => (
                <tr key={emp.id} className="border-b border-gray-100 hover:bg-gray-50/30">
                  <td className="px-2 py-2 text-center text-gray-400">{idx + 1}</td>
                  <td className="px-2 py-2">
                    <input value={emp.name}
                      onChange={(e) => updateEmployee(emp.id, 'name', e.target.value)}
                      className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  </td>
                  <td className="px-2 py-2 bg-blue-50/20">
                    <input type="number" step="0.01" value={emp.grossSalary}
                      onChange={(e) => updateEmployee(emp.id, 'grossSalary', parseFloat(e.target.value) || 0)}
                      className="w-24 px-2 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" value={emp.pensionP}
                      onChange={(e) => updateEmployee(emp.id, 'pensionP', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" value={emp.medicalP}
                      onChange={(e) => updateEmployee(emp.id, 'medicalP', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" value={emp.unemploymentP}
                      onChange={(e) => updateEmployee(emp.id, 'unemploymentP', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  </td>
                  <td className="px-2 py-2">
                    <input type="number" step="0.01" value={emp.housingP}
                      onChange={(e) => updateEmployee(emp.id, 'housingP', parseFloat(e.target.value) || 0)}
                      className="w-20 px-1 py-1 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500" />
                  </td>
                  <td className="px-2 py-2 text-right text-orange-600">{fmtNum(emp.tax)}</td>
                  <td className="px-2 py-2 text-right font-bold text-green-700 bg-green-50/30">{fmtNum(emp.netPay)}</td>
                  <td className="px-2 py-2 text-right text-gray-500">{fmtNum(emp.enterprise.total)}</td>
                  <td className="px-2 py-2 text-right font-medium text-orange-700 bg-orange-50/30">{fmtNum(emp.totalCost)}</td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => removeEmployee(emp.id)}
                      className="p-1 text-red-400 hover:bg-red-50 rounded" title="删除">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                <td colSpan="2" className="px-2 py-3 text-center text-gray-700">月度合计</td>
                <td className="px-2 py-3 text-right text-blue-700 bg-blue-50/50">{fmtNum(salaryDetails.reduce((s, e) => s + e.grossSalary, 0))}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmtNum(salaryDetails.reduce((s, e) => s + e.pensionP, 0))}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmtNum(salaryDetails.reduce((s, e) => s + e.medicalP, 0))}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmtNum(salaryDetails.reduce((s, e) => s + e.unemploymentP, 0))}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmtNum(salaryDetails.reduce((s, e) => s + e.housingP, 0))}</td>
                <td className="px-2 py-3 text-right text-orange-600">{fmtNum(salaryDetails.reduce((s, e) => s + e.tax, 0))}</td>
                <td className="px-2 py-3 text-right text-green-700 bg-green-50/50">{fmt(monthlyNetTotal)}</td>
                <td className="px-2 py-3 text-right text-gray-600">{fmtNum(salaryDetails.reduce((s, e) => s + e.enterprise.total, 0))}</td>
                <td className="px-2 py-3 text-right text-orange-700 bg-orange-50/50">{fmt(monthlyCostTotal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ══ Section 3: 季度增值税免征 + 套现监控 ══ */}
      <div className="space-y-3">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Shield size={18} className="text-primary-600" />
          季度增值税免征 + 套现监控
        </h3>
        <div className="grid grid-cols-4 gap-4">
          {quarters.map((q) => {
            const vs = vatStatusStyle[q.vatStatus];
            const VIcon = vs.icon;
            return (
              <div key={q.index} className={`rounded-xl border p-4 ${vs.bg} ${vs.border}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-gray-800">{q.label}</span>
                  <span className={`flex items-center gap-1 text-xs ${vs.text}`}>
                    <VIcon size={14} />
                    {q.isExempt ? '免税' : '需缴税'}
                  </span>
                </div>

                {/* 增值税进度条 */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-500">季度佣金</span>
                    <span className={vs.text}>{q.usedPct}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${q.vatStatus === 'green' ? 'bg-green-500' : q.vatStatus === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, q.usedPct)}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-gray-600">{fmt(q.revenue)}</span>
                    <span className="text-gray-400">/ ¥300,000</span>
                  </div>
                </div>

                {/* 套现匹配 */}
                <div className="space-y-1 text-xs border-t border-gray-200/50 pt-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">利润 4%</span>
                    <span className="text-blue-600 font-medium">{fmt(q.profit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">税费预留 1%</span>
                    <span className="text-orange-600">{fmt(q.taxReserve)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">需套现 95%</span>
                    <span className="text-purple-600 font-medium">{fmt(q.cashoutTarget)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">工资实发</span>
                    <span className="text-gray-700">{fmt(q.actualSalary)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-gray-200/50 pt-1">
                    <span className="text-gray-600">套现差额</span>
                    <span className={q.cashoutDiff > 0 ? 'text-red-600' : q.cashoutDiff < 0 ? 'text-yellow-600' : 'text-green-600'}>
                      {q.cashoutDiff > 0 ? '+' : ''}{fmt(q.cashoutDiff)}
                    </span>
                  </div>
                  {q.vatStatus === 'red' && (
                    <p className="text-red-600 mt-1">⛔ 超免征线！增值税={fmt(q.vat)}</p>
                  )}
                  {q.vatStatus === 'yellow' && (
                    <p className="text-yellow-600 mt-1">⚠️ 接近免征线，剩 {fmt(q.remaining)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ Section 4: 年度汇总 ══ */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 rounded-xl p-6 text-white">
        <h3 className="font-bold mb-4 flex items-center gap-2">
          <Calculator size={18} />
          年度汇总
        </h3>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">年度佣金总收入</p>
            <p className="text-lg font-bold">{fmt(annualSummary.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度利润 (4%)</p>
            <p className="text-lg font-bold text-blue-300">{fmt(annualSummary.profit)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度税费预留 (1%)</p>
            <p className="text-lg font-bold text-orange-300">{fmt(annualSummary.taxReserve)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度需套现 (95%)</p>
            <p className="text-lg font-bold text-purple-300">{fmt(annualSummary.cashoutTarget)}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-700">
          <div>
            <p className="text-xs text-gray-400 mb-1">年度工资实发</p>
            <p className="text-lg font-bold text-gray-200">{fmt(annualSummary.actualSalary)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度用工成本（含企业社保）</p>
            <p className="text-lg font-bold text-gray-200">{fmt(annualSummary.actualCost)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度套现差额</p>
            <p className={`text-lg font-bold ${annualSummary.cashoutDiff > 0 ? 'text-red-400' : annualSummary.cashoutDiff < 0 ? 'text-yellow-400' : 'text-green-400'}`}>
              {annualSummary.cashoutDiff > 0 ? '+' : ''}{fmt(annualSummary.cashoutDiff)}
            </p>
          </div>
        </div>
      </div>

      {/* ══ Section 5: 决策建议 ══ */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
          <AlertTriangle size={18} className="text-yellow-500" />
          决策建议
        </h3>
        <div className="space-y-2 text-sm">
          {annualSummary.cashoutDiff > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              ⛔ 年度套现不足 {fmt(annualSummary.cashoutDiff)}，有部分钱未通过工资发出。
              建议：提高部分员工工资或增加人数，使月度实发 ≈ 月度佣金×95%。
            </div>
          )}
          {annualSummary.cashoutDiff < 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
              ⚠️ 年度超额套现 {fmt(Math.abs(annualSummary.cashoutDiff))}，发的工资比佣金进账还多。
              建议：减少员工工资或人数，或增加佣金收入。
            </div>
          )}
          {Math.abs(annualSummary.cashoutDiff) < 100 && annualSummary.revenue > 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
              ✅ 套现精准匹配！工资实发与95%佣金基本一致。
            </div>
          )}
          {quarters.filter(q => q.vatStatus === 'red').length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              ⛔ 有 {quarters.filter(q => q.vatStatus === 'red').length} 个季度超过30万免征线！
              超出后全部佣金按1%征增值税。建议将部分佣金延后至下季度确认。
            </div>
          )}
          {quarters.filter(q => q.vatStatus === 'yellow').length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
              ⚠️ 有 {quarters.filter(q => q.vatStatus === 'yellow').length} 个季度接近30万免征线，控制接单量。
            </div>
          )}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
            💡 当前每月工资实发 {fmt(monthlyNetTotal)}，对应每月佣金应为 {fmt(monthlyNetTotal / CASHOUT_RATE)} 才能精准匹配。
            季度佣金应控制在 {fmt(100000)} 以内（月均≤10万）以保持增值税免征。
          </div>
        </div>
      </div>
    </div>
  );
}
