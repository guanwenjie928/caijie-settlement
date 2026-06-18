import { useState, useMemo } from 'react';
import {
  Plus, Trash2, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, Wallet, Shield, Calculator, ArrowRight,
  Receipt, ShieldCheck, Eye, Target, Zap, Wand2
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

// ── 报销套现费用类别 ─────────────────────────────────────
// safePct: 安全范围占月营收的比例 [下限, 上限]
// deductRule: 税前扣除规则说明
// auditTip: 防查要点
const REIMBURSE_CATEGORIES = [
  {
    key: 'office', label: '办公费', icon: '📋',
    safePct: [0.02, 0.05],
    deductRule: '全额税前扣除，需真实发票',
    auditTip: '发票品名应与公司经营相关（文具、耗材、打印等），避免大量一次性开票',
  },
  {
    key: 'travel', label: '差旅费', icon: '✈️',
    safePct: [0.02, 0.08],
    deductRule: '全额税前扣除，需出差审批+行程单',
    auditTip: '需有出差事由、目的地、时间，交通+住宿+补助要合理匹配',
  },
  {
    key: 'entertainment', label: '业务招待费', icon: '🍽️',
    safePct: [0.003, 0.005],
    deductRule: '按实际发生额60%扣除，且≤营收5‰',
    auditTip: '最易被查项目！需招待审批单、菜单明细，金额不宜过大',
  },
  {
    key: 'transport', label: '交通费', icon: '🚗',
    safePct: [0.01, 0.03],
    deductRule: '全额税前扣除，需票据',
    auditTip: '滴滴/出租车票为主，避免同一日期多张大额票据',
  },
  {
    key: 'communication', label: '通讯费', icon: '📞',
    safePct: [0.005, 0.015],
    deductRule: '全额税前扣除，需发票',
    auditTip: '以话费充值发票为主，月度金额相对稳定',
  },
  {
    key: 'rent', label: '房租物业', icon: '🏢',
    safePct: [0.05, 0.15],
    deductRule: '全额税前扣除，需租赁合同+发票',
    auditTip: '需有真实租赁合同，发票方与合同出租方一致，金额与合同匹配',
  },
  {
    key: 'utilities', label: '水电费', icon: '💡',
    safePct: [0.01, 0.03],
    deductRule: '全额税前扣除，需发票',
    auditTip: '物业代开或供电局/水务局直接开具，金额随季节波动合理',
  },
  {
    key: 'advertising', label: '广告宣传费', icon: '📢',
    safePct: [0.03, 0.08],
    deductRule: '≤营收15%全额扣除，超出部分结转以后年度',
    auditTip: '文化创意公司常用项，需有合同+投放记录+效果截图',
  },
  {
    key: 'consulting', label: '咨询费', icon: '💡',
    safePct: [0.02, 0.05],
    deductRule: '全额税前扣除，需合同+发票',
    auditTip: '需有咨询合同、咨询报告等成果文件，金额与市场价匹配',
  },
  {
    key: 'labor', label: '劳务费', icon: '👷',
    safePct: [0.02, 0.06],
    deductRule: '全额税前扣除，需代扣个税',
    auditTip: '需劳务合同+劳务费发放签收单，超过800元需代扣20%个税',
  },
  {
    key: 'postage', label: '邮寄快递', icon: '📦',
    safePct: [0.002, 0.01],
    deductRule: '全额税前扣除，需发票',
    auditTip: '快递公司月结发票为主，金额小且稳定',
  },
  {
    key: 'maintenance', label: '维修费', icon: '🔧',
    safePct: [0.01, 0.03],
    deductRule: '全额税前扣除，需发票+维修清单',
    auditTip: '电脑/空调/办公设备维修为主，金额与设备价值匹配',
  },
];

// 生成初始月度报销数据（12月 × 类别数，全部0）
function initReimburseData() {
  return Array(12).fill(0).map(() => {
    const m = {};
    REIMBURSE_CATEGORIES.forEach(c => { m[c.key] = 0; });
    return m;
  });
}

// 评估单个类别的风险等级
function assessCategoryRisk(amount, revenue, category) {
  if (amount <= 0) return 'none';
  const [minPct, maxPct] = category.safePct;
  const pct = revenue > 0 ? amount / revenue : 0;
  if (pct <= maxPct * 1.2) return 'safe';       // 安全区（含20%缓冲）
  if (pct <= maxPct * 2) return 'warning';       // 警告区
  return 'danger';                                // 高风险
}

// 计算业务招待费可扣除额
function calcEntertainmentDeductible(amount, revenue) {
  // 按实际发生额60%扣除，且不超过营收5‰
  const sixtyPct = amount * 0.6;
  const limit = revenue * 0.005;
  return Math.min(sixtyPct, limit);
}

// 计算广告费可扣除额
function calcAdDeductible(amount, annualRevenue) {
  const limit = annualRevenue * 0.15;
  return Math.min(amount, limit);
}

// ── 智能套现方案生成器 ───────────────────────────────────
// 核心算法：等额化应纳税所得额，利用累进税率凸性最小化总个税

// 根据月度应纳税所得额直接计算月度个税
function calcIITFromMonthlyTaxable(monthlyTaxable) {
  if (monthlyTaxable <= 0) return 0;
  const annualTaxable = monthlyTaxable * 12;
  let annualTax = 0;
  for (const b of IIT_BRACKETS) {
    if (annualTaxable <= b.limit) {
      annualTax = Math.max(0, annualTaxable * b.rate - b.deduction);
      break;
    }
  }
  return annualTax / 12;
}

// 给定员工和目标净收入（实发），反推所需应发工资
// 使用二分查找，适用于所有税率档位
function calcGrossFromNet(emp, targetNet) {
  const totalSocial = emp.pensionP + emp.medicalP + emp.unemploymentP + emp.housingP;
  const specialDed = emp.specialDeduction || 0;
  const taxFreeNet = IIT_THRESHOLD + specialDed; // 免税区间内净收入上限

  if (targetNet <= taxFreeNet) {
    const gross = targetNet + totalSocial;
    return { gross: Math.round(gross * 100) / 100, iit: 0, net: Math.round(targetNet * 100) / 100, taxable: 0 };
  }

  // 二分查找：在免税额之上寻找合适的 gross
  let low = IIT_THRESHOLD + totalSocial + specialDed;
  let high = targetNet * 3 + totalSocial + 10000;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    const { tax } = calcIIT(mid, totalSocial, specialDed);
    const net = mid - totalSocial - tax;
    if (net < targetNet) low = mid;
    else high = mid;
  }
  const gross = (low + high) / 2;
  const { tax, taxable } = calcIIT(gross, totalSocial, specialDed);
  const net = Math.round((gross - totalSocial - tax) * 100) / 100;
  return { gross: Math.round(gross * 100) / 100, iit: tax, net, taxable: Math.round(taxable * 100) / 100 };
}

/**
 * 生成最优套现方案
 * 策略：
 * 1. 目标 ≤ 免税总额 → 均分，全员零个税
 * 2. 目标 > 免税总额 → 等额化每人应纳税所得额（Jensen不等式：凸函数等值分配最小化总和）
 *    二分查找求解：T - IIT(T) = (target - 免税总额) / N
 */
function generateCashoutPlan(enabledEmployees, targetAmount) {
  if (enabledEmployees.length === 0 || targetAmount <= 0) return null;

  const N = enabledEmployees.length;
  const empData = enabledEmployees.map(emp => {
    const totalSocial = emp.pensionP + emp.medicalP + emp.unemploymentP + emp.housingP;
    const taxFreeNet = IIT_THRESHOLD + (emp.specialDeduction || 0);
    return { ...emp, totalSocial, taxFreeNet };
  });
  const totalTaxFreeNet = empData.reduce((s, e) => s + e.taxFreeNet, 0);

  // 情况1：目标 ≤ 免税总额，均分
  if (targetAmount <= totalTaxFreeNet) {
    const perPersonNet = targetAmount / N;
    return empData.map(e => {
      const result = calcGrossFromNet(e, perPersonNet);
      const enterprise = calcEnterpriseSocial(e.pensionP, e.medicalP, e.unemploymentP, e.housingP);
      return { ...e, ...result, enterprise, totalCost: Math.round((result.gross + enterprise.total) * 100) / 100 };
    });
  }

  // 情况2：目标 > 免税总额，等额化应纳税所得额
  const targetContributionPerPerson = (targetAmount - totalTaxFreeNet) / N;
  let lowT = 0, highT = 200000;
  for (let i = 0; i < 100; i++) {
    const midT = (lowT + highT) / 2;
    const iit = calcIITFromMonthlyTaxable(midT);
    const contribution = midT - iit;
    if (contribution < targetContributionPerPerson) lowT = midT;
    else highT = midT;
  }
  const T = (lowT + highT) / 2;

  return empData.map(e => {
    const gross = T + e.totalSocial + IIT_THRESHOLD + (e.specialDeduction || 0);
    const { tax, taxable } = calcIIT(gross, e.totalSocial, e.specialDeduction || 0);
    const net = Math.round((gross - e.totalSocial - tax) * 100) / 100;
    const enterprise = calcEnterpriseSocial(e.pensionP, e.medicalP, e.unemploymentP, e.housingP);
    return {
      ...e,
      gross: Math.round(gross * 100) / 100,
      iit: tax,
      net,
      taxable: Math.round(taxable * 100) / 100,
      enterprise,
      totalCost: Math.round((gross + enterprise.total) * 100) / 100,
    };
  });
}

// ── 三层瀑布套现算法 ───────────────────────────────────
// 智能分配报销金额到各安全类别（低风险优先，控制在安全上限80%以内）
function distributeReimbursement(amount, revenue) {
  if (amount <= 0 || revenue <= 0) return {};
  // 优先级：全额扣除且低风险类别排前面
  const priorities = [
    'office', 'transport', 'communication', 'travel', 'utilities',
    'maintenance', 'postage', 'advertising', 'consulting', 'labor',
    'rent', 'entertainment'
  ];
  let remaining = amount;
  const distribution = {};
  // 第一轮：每类分配安全上限的 80%
  for (const key of priorities) {
    if (remaining <= 0) break;
    const cat = REIMBURSE_CATEGORIES.find(c => c.key === key);
    if (!cat) continue;
    const safeMax = revenue * cat.safePct[1];
    const alloc = Math.min(safeMax * 0.8, remaining);
    if (alloc > 0) {
      distribution[key] = Math.round(alloc * 100) / 100;
      remaining -= alloc;
    }
  }
  // 第二轮：如果还有剩余，在各类别安全上限内继续分配
  if (remaining > 0.01) {
    for (const key of priorities) {
      if (remaining <= 0) break;
      const cat = REIMBURSE_CATEGORIES.find(c => c.key === key);
      if (!cat) continue;
      const current = distribution[key] || 0;
      const safeMax = revenue * cat.safePct[1];
      const canAdd = safeMax - current;
      const add = Math.min(canAdd, remaining);
      if (add > 0) {
        distribution[key] = Math.round((current + add) * 100) / 100;
        remaining -= add;
      }
    }
  }
  return distribution;
}

/**
 * 生成三层瀑布智能套现方案
 * 第一层: 免税工资 (N × 5000, 零个税)
 * 第二层: 报销套现 (≤营收20%, 零个税零社保)
 * 第三层: 征税工资 (剩余, 等额化最小化个税)
 * 同时计算纯工资方案作对比，展示节省金额
 */
function generateSmartCashoutPlan(enabledEmployees, commission, monthRevenue) {
  if (enabledEmployees.length === 0 || commission <= 0) return null;

  const N = enabledEmployees.length;
  const profit = Math.round(commission * PROFIT_RATE * 100) / 100;
  const taxReserve = Math.round(commission * TAX_RATE * 100) / 100;
  const cashoutTarget = Math.round(commission * CASHOUT_RATE * 100) / 100;

  // 第一层：免税工资
  const taxFreeSalary = N * IIT_THRESHOLD; // N × 5000

  // 第二层：报销套现（最多营收的20%）
  const maxReimburse = Math.round(monthRevenue * 0.20 * 100) / 100;
  const remainingAfterTier1 = Math.max(0, cashoutTarget - taxFreeSalary);
  const reimburseAmount = Math.round(Math.min(maxReimburse, remainingAfterTier1) * 100) / 100;

  // 第三层：征税工资
  const salaryNeeded = Math.max(0, Math.round((cashoutTarget - reimburseAmount) * 100) / 100);

  // 生成混合方案工资
  const salaryPlan = generateCashoutPlan(enabledEmployees, salaryNeeded);
  // 生成报销分配
  const reimbursePlan = distributeReimbursement(reimburseAmount, monthRevenue);

  // 纯工资方案对比
  const pureSalaryPlan = generateCashoutPlan(enabledEmployees, cashoutTarget);
  const pureSalaryCost = pureSalaryPlan ? Math.round(pureSalaryPlan.reduce((s, e) => s + e.totalCost, 0) * 100) / 100 : 0;
  const pureSalaryIIT = pureSalaryPlan ? Math.round(pureSalaryPlan.reduce((s, e) => s + e.iit, 0) * 100) / 100 : 0;

  // 混合方案成本
  const mixedSalaryCost = salaryPlan ? Math.round(salaryPlan.reduce((s, e) => s + e.totalCost, 0) * 100) / 100 : 0;
  const mixedSalaryIIT = salaryPlan ? Math.round(salaryPlan.reduce((s, e) => s + e.iit, 0) * 100) / 100 : 0;
  const mixedTotalCost = Math.round((mixedSalaryCost + reimburseAmount) * 100) / 100;
  const savedCost = Math.round((pureSalaryCost - mixedTotalCost) * 100) / 100;
  const savedIIT = Math.round((pureSalaryIIT - mixedSalaryIIT) * 100) / 100;

  return {
    commission, profit, taxReserve, cashoutTarget,
    taxFreeSalary, reimburseAmount, salaryNeeded,
    salaryPlan, reimbursePlan,
    pureSalaryCost, pureSalaryIIT,
    mixedSalaryCost, mixedSalaryIIT, mixedTotalCost,
    savedCost, savedIIT,
    reimbursePct: monthRevenue > 0 ? Math.round(reimburseAmount / monthRevenue * 1000) / 10 : 0,
  };
}

export default function SalaryPlanner() {
  const [employees, setEmployees] = useState(DEFAULT_EMPLOYEES);
  const [monthlyRevenues, setMonthlyRevenues] = useState(Array(12).fill(0).map((_, i) => {
    if (i < 3) return 80000;
    if (i < 6) return 90000;
    return 0;
  }));
  // 报销套现数据：12个月 × N个类别
  const [reimburseData, setReimburseData] = useState(initReimburseData());
  // 当前查看的月份索引（报销明细）
  const [activeReimburseMonth, setActiveReimburseMonth] = useState(0);

  // ── 智能套现方案生成器状态 ────────────────────────────
  const [planEnabledIds, setPlanEnabledIds] = useState(() => DEFAULT_EMPLOYEES.map(e => e.id));
  const [activePlanMonth, setActivePlanMonth] = useState(0); // 智能规划月份

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

  // ── 报销套现计算 ──────────────────────────────────────
  // 每月报销总额
  const monthlyReimburseTotals = useMemo(() => {
    return reimburseData.map(m => {
      const total = REIMBURSE_CATEGORIES.reduce((s, c) => s + (m[c.key] || 0), 0);
      return Math.round(total * 100) / 100;
    });
  }, [reimburseData]);

  // 年度营收（用于广告费扣除限额）
  const annualRevenue = useMemo(() => monthlyRevenues.reduce((s, r) => s + r, 0), [monthlyRevenues]);

  // 报销风险评估（按月×类别）
  const reimburseRisk = useMemo(() => {
    return reimburseData.map((monthData, mIdx) => {
      const revenue = monthlyRevenues[mIdx] || 0;
      const risks = {};
      let hasWarning = false;
      let hasDanger = false;
      REIMBURSE_CATEGORIES.forEach(c => {
        const risk = assessCategoryRisk(monthData[c.key] || 0, revenue, c);
        risks[c.key] = risk;
        if (risk === 'warning') hasWarning = true;
        if (risk === 'danger') hasDanger = true;
      });
      const totalReimburse = monthlyReimburseTotals[mIdx];
      // 总报销占比超过营收20%触发警告，超过30%触发危险
      const totalPct = revenue > 0 ? totalReimburse / revenue : 0;
      if (totalPct > 0.30) hasDanger = true;
      else if (totalPct > 0.20) hasWarning = true;
      return { risks, hasWarning, hasDanger, totalPct };
    });
  }, [reimburseData, monthlyRevenues, monthlyReimburseTotals]);

  // 报销可税前扣除额（按月）
  const monthlyDeductible = useMemo(() => {
    return reimburseData.map((monthData, mIdx) => {
      const revenue = monthlyRevenues[mIdx] || 0;
      let deductible = 0;
      let nonDeductible = 0;
      REIMBURSE_CATEGORIES.forEach(c => {
        const amount = monthData[c.key] || 0;
        if (amount <= 0) return;
        if (c.key === 'entertainment') {
          const ded = calcEntertainmentDeductible(amount, revenue);
          deductible += ded;
          nonDeductible += amount - ded;
        } else if (c.key === 'advertising') {
          const ded = calcAdDeductible(amount, annualRevenue);
          deductible += ded;
          nonDeductible += amount - ded;
        } else {
          deductible += amount;
        }
      });
      return {
        deductible: Math.round(deductible * 100) / 100,
        nonDeductible: Math.round(nonDeductible * 100) / 100,
      };
    });
  }, [reimburseData, monthlyRevenues, annualRevenue]);

  // ── 月度套现规划（含报销） ────────────────────────────
  const monthlyPlan = useMemo(() => {
    return MONTHS.map((label, idx) => {
      const revenue = monthlyRevenues[idx] || 0;
      const profit = Math.round(revenue * PROFIT_RATE * 100) / 100;
      const tax = Math.round(revenue * TAX_RATE * 100) / 100;
      const cashoutTarget = Math.round(revenue * CASHOUT_RATE * 100) / 100;
      const salaryCashout = monthlyNetTotal;  // 每月固定工资套现
      const reimburseCashout = monthlyReimburseTotals[idx] || 0;  // 报销套现
      const actualCashout = Math.round((salaryCashout + reimburseCashout) * 100) / 100;
      const diff = Math.round((cashoutTarget - actualCashout) * 100) / 100;
      const matchStatus = Math.abs(diff) < 100 ? 'matched' : (diff > 0 ? 'deficit' : 'surplus');

      return { idx, label, revenue, profit, tax, cashoutTarget, salaryCashout, reimburseCashout, actualCashout, diff, matchStatus };
    });
  }, [monthlyRevenues, monthlyNetTotal, monthlyReimburseTotals]);

  // ── 季度汇总（含报销） ────────────────────────────────
  const quarters = useMemo(() => {
    return [0, 1, 2, 3].map(qi => {
      const months = [qi * 3, qi * 3 + 1, qi * 3 + 2];
      const revenue = months.reduce((s, m) => s + (monthlyRevenues[m] || 0), 0);
      const profit = Math.round(revenue * PROFIT_RATE * 100) / 100;
      const taxReserve = Math.round(revenue * TAX_RATE * 100) / 100;
      const cashoutTarget = Math.round(revenue * CASHOUT_RATE * 100) / 100;
      const actualSalary = monthlyNetTotal * 3;
      const actualReimburse = months.reduce((s, m) => s + (monthlyReimburseTotals[m] || 0), 0);
      const actualTotal = Math.round((actualSalary + actualReimburse) * 100) / 100;
      const threshold = 300000;
      const usedPct = revenue > 0 ? Math.round(revenue / threshold * 100 * 10) / 10 : 0;
      const remaining = Math.round((threshold - revenue) * 100) / 100;
      const isExempt = revenue <= threshold;
      const vatStatus = usedPct < 80 ? 'green' : usedPct < 100 ? 'yellow' : 'red';
      const vat = isExempt ? 0 : Math.round(revenue * 0.01 * 100) / 100;
      const cashoutDiff = Math.round((cashoutTarget - actualTotal) * 100) / 100;

      return {
        index: qi, label: `Q${qi + 1}`, months,
        revenue: Math.round(revenue * 100) / 100,
        profit, taxReserve, cashoutTarget, actualSalary, actualReimburse, actualTotal, cashoutDiff,
        threshold, usedPct, remaining, isExempt, vatStatus, vat,
      };
    });
  }, [monthlyRevenues, monthlyNetTotal, monthlyReimburseTotals]);

  // ── 年度汇总（含报销） ────────────────────────────────
  const annualSummary = useMemo(() => {
    const totalRevenue = monthlyRevenues.reduce((s, r) => s + r, 0);
    const totalReimburse = monthlyReimburseTotals.reduce((s, r) => s + r, 0);
    const totalDeductible = monthlyDeductible.reduce((s, d) => s + d.deductible, 0);
    const totalNonDeductible = monthlyDeductible.reduce((s, d) => s + d.nonDeductible, 0);
    return {
      revenue: Math.round(totalRevenue * 100) / 100,
      profit: Math.round(totalRevenue * PROFIT_RATE * 100) / 100,
      taxReserve: Math.round(totalRevenue * TAX_RATE * 100) / 100,
      cashoutTarget: Math.round(totalRevenue * CASHOUT_RATE * 100) / 100,
      actualSalary: Math.round(monthlyNetTotal * 12 * 100) / 100,
      actualReimburse: Math.round(totalReimburse * 100) / 100,
      actualTotal: Math.round((monthlyNetTotal * 12 + totalReimburse) * 100) / 100,
      actualCost: Math.round(monthlyCostTotal * 12 * 100) / 100,
      cashoutDiff: Math.round((totalRevenue * CASHOUT_RATE - monthlyNetTotal * 12 - totalReimburse) * 100) / 100,
      totalDeductible: Math.round(totalDeductible * 100) / 100,
      totalNonDeductible: Math.round(totalNonDeductible * 100) / 100,
    };
  }, [monthlyRevenues, monthlyNetTotal, monthlyCostTotal, monthlyReimburseTotals, monthlyDeductible]);

  // ── 智能套现方案计算（基于选中月份的佣金） ──────────────
  const smartPlan = useMemo(() => {
    const enabledEmps = employees.filter(e => planEnabledIds.includes(e.id));
    const commission = monthlyRevenues[activePlanMonth] || 0;
    return generateSmartCashoutPlan(enabledEmps, commission, commission);
  }, [employees, planEnabledIds, activePlanMonth, monthlyRevenues]);

  // 智能方案的工资汇总
  const planSummary = useMemo(() => {
    if (!smartPlan || !smartPlan.salaryPlan) return null;
    const plan = smartPlan.salaryPlan;
    const totalGross = plan.reduce((s, e) => s + e.gross, 0);
    const totalIIT = plan.reduce((s, e) => s + e.iit, 0);
    const totalNet = plan.reduce((s, e) => s + e.net, 0);
    const totalEnterprise = plan.reduce((s, e) => s + e.enterprise.total, 0);
    const totalCost = plan.reduce((s, e) => s + e.totalCost, 0);
    const totalSocialPersonal = plan.reduce((s, e) => s + e.totalSocial, 0);
    const effectiveRate = totalGross > 0 ? (totalIIT / totalGross * 100) : 0;
    return {
      totalGross: Math.round(totalGross * 100) / 100,
      totalIIT: Math.round(totalIIT * 100) / 100,
      totalNet: Math.round(totalNet * 100) / 100,
      totalEnterprise: Math.round(totalEnterprise * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalSocialPersonal: Math.round(totalSocialPersonal * 100) / 100,
      effectiveRate: Math.round(effectiveRate * 100) / 100,
      empCount: plan.length,
    };
  }, [smartPlan]);

  // 建议增加人数（混合方案下仍有较高税负时）
  const addPersonSuggestion = useMemo(() => {
    if (!smartPlan || !planSummary || planSummary.effectiveRate <= 3) return null;
    const target = smartPlan.salaryNeeded;
    if (target <= 0) return null;
    const minPeople = Math.ceil(target / 7910);
    if (minPeople <= planSummary.empCount) return null;
    const virtualEmps = [];
    for (let i = 0; i < minPeople; i++) {
      if (i < employees.length) {
        virtualEmps.push(employees[i]);
      } else {
        virtualEmps.push({
          id: 10000 + i, name: `虚拟员工${i + 1}`,
          grossSalary: 5000, pensionP: 0, medicalP: 0, unemploymentP: 0, housingP: 0, specialDeduction: 0,
        });
      }
    }
    const virtualPlan = generateCashoutPlan(virtualEmps, target);
    if (!virtualPlan) return null;
    const virtualIIT = virtualPlan.reduce((s, e) => s + e.iit, 0);
    const savedIIT = planSummary.totalIIT - virtualIIT;
    return { minPeople, virtualIIT: Math.round(virtualIIT * 100) / 100, savedIIT: Math.round(savedIIT * 100) / 100 };
  }, [smartPlan, planSummary, employees]);

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
  const updateReimburse = (monthIdx, categoryKey, value) => {
    const next = reimburseData.map((m, i) => {
      if (i !== monthIdx) return m;
      return { ...m, [categoryKey]: value };
    });
    setReimburseData(next);
  };

  // 智能方案：切换员工启用状态
  const togglePlanEmp = (id) => {
    setPlanEnabledIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // 智能方案：一键应用到工资表
  const applyPlanToSalary = () => {
    if (!smartPlan || !smartPlan.salaryPlan) return;
    setEmployees(prev => prev.map(emp => {
      const planItem = smartPlan.salaryPlan.find(p => p.id === emp.id);
      if (!planItem) return emp;
      return { ...emp, grossSalary: planItem.gross };
    }));
  };

  // 智能方案：一键应用到报销表
  const applyReimbursePlan = () => {
    if (!smartPlan || !smartPlan.reimbursePlan) return;
    setReimburseData(prev => prev.map((m, i) => {
      if (i !== activePlanMonth) return m;
      const updated = { ...m };
      Object.keys(smartPlan.reimbursePlan).forEach(key => {
        updated[key] = smartPlan.reimbursePlan[key];
      });
      return updated;
    }));
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
          每月佣金进账后，4%是你的利润，1%预留税费，<strong>95%需要通过发工资 + 报销套现出去</strong>。
          下方表格帮你精准匹配「需套现金额」与「实际套现（工资+报销）」，确保不多发不少发。
        </p>
      </div>

      {/* ══ Section 0: 佣金套现智能规划（三层瀑布）══ */}
      <div className="bg-white rounded-xl border-2 border-primary-300 overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-primary-50 to-blue-50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Target size={18} className="text-primary-600" />
            佣金套现智能规划
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            选择月份 → 读取佣金 → 自动生成「免税工资 + 报销 + 征税工资」三层瀑布方案，最小化套现成本
          </p>
        </div>

        {/* 月份选择 + 佣金展示 */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 flex-wrap">
            {MONTHS.map((label, idx) => (
              <button key={idx} onClick={() => setActivePlanMonth(idx)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  activePlanMonth === idx
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-4 flex-wrap text-sm">
            <span className="text-gray-500">当月佣金：</span>
            <input type="number" step="1000" value={monthlyRevenues[activePlanMonth] || 0}
              onChange={(e) => updateRevenue(activePlanMonth, parseFloat(e.target.value) || 0)}
              className="w-36 px-3 py-1.5 border-2 border-primary-200 rounded-lg text-base font-bold text-right text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500" />
            <span className="text-gray-400">元</span>
            {smartPlan && (
              <span className="flex items-center gap-3 ml-2">
                <span className="text-blue-600">利润4%: <strong>{fmtNum(smartPlan.profit)}</strong></span>
                <span className="text-orange-600">税费1%: <strong>{fmtNum(smartPlan.taxReserve)}</strong></span>
                <span className="text-purple-600">需套现95%: <strong>{fmtNum(smartPlan.cashoutTarget)}</strong></span>
              </span>
            )}
          </div>

          {/* 员工选择 */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">参与套现员工：</span>
            {employees.map(emp => (
              <button key={emp.id} onClick={() => togglePlanEmp(emp.id)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  planEnabledIds.includes(emp.id)
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
                }`}>
                {planEnabledIds.includes(emp.id) ? '✓ ' : ''}{emp.name}
              </button>
            ))}
            <span className="text-xs text-gray-400 ml-2">
              已选 {planEnabledIds.length} 人 · 免税额度 {fmt(planEnabledIds.length * 5000)}
            </span>
          </div>
        </div>

        {smartPlan && smartPlan.salaryPlan && (
          <>
            {/* 三层瀑布可视化 */}
            <div className="px-5 py-4 bg-gradient-to-b from-gray-50 to-white border-b border-gray-100">
              <div className="grid grid-cols-3 gap-3 mb-3">
                {/* 第一层：免税工资 */}
                <div className={`rounded-lg border p-3 ${smartPlan.taxFreeSalary > 0 ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50 opacity-50'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-bold text-green-700">第一层 · 免税工资</span>
                    {smartPlan.taxFreeSalary > 0 && <CheckCircle2 size={12} className="text-green-600" />}
                  </div>
                  <p className="text-xl font-bold text-green-700">{fmtNum(smartPlan.taxFreeSalary)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {planEnabledIds.length}人 × ¥5,000 · 零个税零社保成本
                  </p>
                </div>

                {/* 第二层：报销套现 */}
                <div className={`rounded-lg border p-3 ${smartPlan.reimburseAmount > 0 ? 'border-cyan-300 bg-cyan-50' : 'border-gray-200 bg-gray-50 opacity-50'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-bold text-cyan-700">第二层 · 报销套现</span>
                    {smartPlan.reimburseAmount > 0 && <Receipt size={12} className="text-cyan-600" />}
                  </div>
                  <p className="text-xl font-bold text-cyan-700">{fmtNum(smartPlan.reimburseAmount)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    占营收 {smartPlan.reimbursePct}% · 零个税零社保成本
                  </p>
                </div>

                {/* 第三层：征税工资 */}
                <div className={`rounded-lg border p-3 ${smartPlan.salaryNeeded > smartPlan.taxFreeSalary ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-gray-50 opacity-50'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs font-bold text-orange-700">第三层 · 征税工资</span>
                    {smartPlan.salaryNeeded > smartPlan.taxFreeSalary && smartPlan.mixedSalaryIIT > 0 && <AlertTriangle size={12} className="text-orange-500" />}
                  </div>
                  <p className="text-xl font-bold text-orange-700">{fmtNum(smartPlan.salaryNeeded)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    个税 {fmtNum(smartPlan.mixedSalaryIIT)} · 等额化分配最小化税率
                  </p>
                </div>
              </div>

              {/* 合计 + 对比 */}
              <div className="grid grid-cols-2 gap-3">
                {/* 混合方案 */}
                <div className="rounded-lg border-2 border-primary-300 bg-primary-50/50 p-3">
                  <p className="text-xs font-bold text-primary-700 mb-2">混合方案（推荐）</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-gray-500">合计套现</p>
                      <p className="font-bold text-gray-800">{fmtNum(smartPlan.cashoutTarget)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">总个税</p>
                      <p className={`font-bold ${smartPlan.mixedSalaryIIT > 0 ? 'text-orange-600' : 'text-green-600'}`}>{fmtNum(smartPlan.mixedSalaryIIT)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">总成本</p>
                      <p className="font-bold text-orange-700">{fmtNum(smartPlan.mixedTotalCost)}</p>
                    </div>
                  </div>
                </div>
                {/* 纯工资对比 */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs font-bold text-gray-500 mb-2">纯工资方案（对比）</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-gray-400">合计套现</p>
                      <p className="font-medium text-gray-600">{fmtNum(smartPlan.cashoutTarget)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">总个税</p>
                      <p className="font-medium text-gray-500">{fmtNum(smartPlan.pureSalaryIIT)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">总成本</p>
                      <p className="font-medium text-gray-500">{fmtNum(smartPlan.pureSalaryCost)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 节省金额展示 */}
              {smartPlan.savedCost > 0 && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg text-center text-sm">
                  <span className="text-green-700">
                    混合方案比纯工资方案 <strong>省成本 {fmt(smartPlan.savedCost)}</strong>
                    · <strong>省个税 {fmt(smartPlan.savedIIT)}</strong>
                  </span>
                </div>
              )}
              {smartPlan.savedCost <= 0 && smartPlan.reimburseAmount > 0 && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg text-center text-sm text-green-700">
                  报销套现 {fmt(smartPlan.reimburseAmount)} 已替代等额征税工资，零个税零社保成本
                </div>
              )}
            </div>

            {/* 推荐工资方案表 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                    <th className="px-3 py-3 text-center font-medium w-10">序号</th>
                    <th className="px-3 py-3 text-left font-medium">姓名</th>
                    <th className="px-3 py-3 text-right font-medium bg-blue-50/50">推荐应发</th>
                    <th className="px-3 py-3 text-right font-medium">个人社保</th>
                    <th className="px-3 py-3 text-right font-medium">应纳税所得</th>
                    <th className="px-3 py-3 text-right font-medium text-orange-600">个税</th>
                    <th className="px-3 py-3 text-right font-medium bg-green-50/50">实发(套现)</th>
                    <th className="px-3 py-3 text-right font-medium">企业社保</th>
                    <th className="px-3 py-3 text-right font-medium bg-orange-50/50">用工成本</th>
                    <th className="px-3 py-3 text-center font-medium">税率</th>
                  </tr>
                </thead>
                <tbody>
                  {smartPlan.salaryPlan.map((emp, idx) => {
                    const empIITRate = emp.gross > 0 ? (emp.iit / emp.gross * 100) : 0;
                    return (
                      <tr key={emp.id} className="border-b border-gray-100 hover:bg-primary-50/20">
                        <td className="px-3 py-2 text-center text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-700">{emp.name}</td>
                        <td className="px-3 py-2 text-right font-bold text-blue-700 bg-blue-50/30">{fmtNum(emp.gross)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmtNum(emp.totalSocial)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmtNum(emp.taxable)}</td>
                        <td className="px-3 py-2 text-right text-orange-600">{emp.iit > 0 ? fmtNum(emp.iit) : '—'}</td>
                        <td className="px-3 py-2 text-right font-bold text-green-700 bg-green-50/30">{fmtNum(emp.net)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{fmtNum(emp.enterprise.total)}</td>
                        <td className="px-3 py-2 text-right font-medium text-orange-700 bg-orange-50/30">{fmtNum(emp.totalCost)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-xs font-medium ${
                            empIITRate <= 0.1 ? 'text-green-600' :
                            empIITRate <= 3 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {empIITRate.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                    <td colSpan="2" className="px-3 py-3 text-center text-gray-700">工资合计</td>
                    <td className="px-3 py-3 text-right text-blue-700 bg-blue-50/50">{fmtNum(planSummary?.totalGross || 0)}</td>
                    <td className="px-3 py-3 text-right text-gray-600">{fmtNum(planSummary?.totalSocialPersonal || 0)}</td>
                    <td className="px-3 py-3 text-right text-gray-600">{fmtNum(smartPlan.salaryPlan.reduce((s, e) => s + e.taxable, 0))}</td>
                    <td className="px-3 py-3 text-right text-orange-600">{fmtNum(planSummary?.totalIIT || 0)}</td>
                    <td className="px-3 py-3 text-right text-green-700 bg-green-50/50">{fmtNum(planSummary?.totalNet || 0)}</td>
                    <td className="px-3 py-3 text-right text-gray-600">{fmtNum(planSummary?.totalEnterprise || 0)}</td>
                    <td className="px-3 py-3 text-right text-orange-700 bg-orange-50/50">{fmtNum(planSummary?.totalCost || 0)}</td>
                    <td className="px-3 py-3 text-center text-gray-600">{planSummary?.effectiveRate || 0}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* 推荐报销方案表 */}
            {smartPlan.reimburseAmount > 0 && Object.keys(smartPlan.reimbursePlan).length > 0 && (
              <div className="border-t border-gray-200">
                <div className="px-5 py-2 bg-cyan-50/30 border-b border-gray-100">
                  <p className="text-sm font-bold text-cyan-700 flex items-center gap-1.5">
                    <Receipt size={14} />
                    智能推荐报销方案（第二层套现）
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    系统已按安全范围自动分配各类别金额 · 点击下方按钮一键填入报销表
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                        <th className="px-3 py-2 text-left font-medium">类别</th>
                        <th className="px-3 py-2 text-right font-medium bg-cyan-50/50">推荐金额</th>
                        <th className="px-3 py-2 text-right font-medium">安全范围</th>
                        <th className="px-3 py-2 text-right font-medium">占营收%</th>
                        <th className="px-3 py-2 text-left font-medium">防查要点</th>
                      </tr>
                    </thead>
                    <tbody>
                      {REIMBURSE_CATEGORIES.filter(c => smartPlan.reimbursePlan[c.key] > 0).map((cat) => {
                        const amount = smartPlan.reimbursePlan[cat.key];
                        const revenue = smartPlan.commission;
                        const pct = revenue > 0 ? (amount / revenue * 100).toFixed(2) : '0.00';
                        const [minPct, maxPct] = cat.safePct;
                        return (
                          <tr key={cat.key} className="border-b border-gray-100 hover:bg-cyan-50/20">
                            <td className="px-3 py-2 font-medium text-gray-700">
                              <span className="mr-1">{cat.icon}</span>{cat.label}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-cyan-700 bg-cyan-50/30">{fmtNum(amount)}</td>
                            <td className="px-3 py-2 text-right text-gray-500 text-xs">
                              {(minPct * 100).toFixed(1)}% ~ {(maxPct * 100).toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right text-gray-600 text-xs">{pct}%</td>
                            <td className="px-3 py-2 text-xs text-gray-400">{cat.auditTip}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                        <td className="px-3 py-2 text-gray-700">报销合计</td>
                        <td className="px-3 py-2 text-right text-cyan-700 bg-cyan-50/50">{fmtNum(smartPlan.reimburseAmount)}</td>
                        <td colSpan="3" className="px-3 py-2 text-xs text-gray-500">
                          占营收 {smartPlan.reimbursePct}%（安全线20%以内） · 零个税零社保成本
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* 操作按钮 + 智能提示 */}
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={applyPlanToSalary}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">
                  <Wand2 size={14} /> 一键应用工资方案
                </button>
                {smartPlan.reimburseAmount > 0 && (
                  <button onClick={applyReimbursePlan}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-medium">
                    <Receipt size={14} /> 一键应用报销方案
                  </button>
                )}
                <span className="text-xs text-gray-400">将推荐方案填入下方工资表和报销表</span>
              </div>

              {/* 零个税提示 */}
              {planSummary && planSummary.totalIIT === 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700">
                  ✅ <strong>零个税方案！</strong>
                  佣金 {fmt(smartPlan.commission)} 的95%套现目标 {fmt(smartPlan.cashoutTarget)}
                  通过「免税工资 + 报销」即可全额覆盖，无需缴纳任何个税。
                </div>
              )}

              {/* 税率档位说明 */}
              {planSummary && planSummary.totalIIT > 0 && smartPlan.salaryPlan.length > 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
                  <strong>第三层征税工资分配说明：</strong>
                  每人月度应纳税所得额约 {fmtNum(smartPlan.salaryPlan[0].taxable)}，
                  {smartPlan.salaryPlan[0].taxable * 12 <= 36000 ? '处于3%税率档（年≤3.6万）' :
                   smartPlan.salaryPlan[0].taxable * 12 <= 144000 ? '处于10%税率档（年3.6万~14.4万）' :
                   smartPlan.salaryPlan[0].taxable * 12 <= 300000 ? '处于20%税率档（年14.4万~30万）' :
                   '处于更高税率档'}
                  ，已等额化分配（累进税率下数学最优）。
                </div>
              )}

              {/* 增加人数建议 */}
              {addPersonSuggestion && (
                <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-700">
                  💡 <strong>省钱建议：</strong>
                  当前 {planSummary.empCount} 人方案第三层个税 {fmt(planSummary.totalIIT)}。
                  若增加至 <strong>{addPersonSuggestion.minPeople} 人</strong>，
                  可将每人应纳税所得额降至3%档以内，月度个税降至 {fmt(addPersonSuggestion.virtualIIT)}，
                  每月节省 <strong className="text-green-700">{fmt(addPersonSuggestion.savedIIT)}</strong>。
                </div>
              )}

              {/* 高税负警告 */}
              {planSummary && planSummary.effectiveRate > 10 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  ⛔ <strong>第三层税负过重！</strong>
                  有效税率 {planSummary.effectiveRate}%。建议：①增加参与套现人数 ②提高报销比例（当前{smartPlan.reimbursePct}%/20%上限） ③拆分至多月发放。
                </div>
              )}
            </div>
          </>
        )}

        {/* 无佣金提示 */}
        {(!smartPlan || !smartPlan.salaryPlan) && (
          <div className="px-5 py-12 text-center text-gray-400">
            <Target size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">请在上方选择月份并输入佣金收入，系统将自动生成最优套现方案</p>
          </div>
        )}
      </div>

      {/* ══ Section 1: 月度佣金 → 套现规划 ══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h3 className="font-bold text-gray-800 px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
          <TrendingUp size={18} className="text-primary-600" />
          月度佣金 → 套现规划（工资 + 报销）
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
                <th className="px-3 py-3 text-right font-medium text-cyan-600 bg-cyan-50/30">报销套现</th>
                <th className="px-3 py-3 text-right font-medium">合计套现</th>
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
                    <td className="px-3 py-2 text-right text-gray-700">{fmtNum(m.salaryCashout)}</td>
                    <td className="px-3 py-2 text-right text-cyan-700 font-medium bg-cyan-50/30">{fmtNum(m.reimburseCashout)}</td>
                    <td className="px-3 py-2 text-right text-gray-800 font-medium">{fmtNum(m.actualCashout)}</td>
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
                <td className="px-3 py-3 text-right text-cyan-700 bg-cyan-50/50">{fmt(annualSummary.actualReimburse)}</td>
                <td className="px-3 py-3 text-right text-gray-800">{fmt(annualSummary.actualTotal)}</td>
                <td className={`px-3 py-3 text-right ${annualSummary.cashoutDiff > 0 ? 'text-red-600' : annualSummary.cashoutDiff < 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                  {annualSummary.cashoutDiff > 0 ? '+' : ''}{fmt(annualSummary.cashoutDiff)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
          <strong>套现差额 = 需套现95% - (工资实发 + 报销套现)</strong> ·
          差额 {'>'} 0 = 套现不足（钱没发出去，留在公司账上）·
          差额 {'<'} 0 = 超额套现（发的比进账多）·
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

      {/* ══ Section 2.5: 报销套现规划（防查机制）══ */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-gray-800 flex items-center gap-2">
                <Receipt size={18} className="text-cyan-600" />
                报销套现规划（防查机制）
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                通过报销发票将公司资金合法转出 · 每月报销总额建议控制在营收 20% 以内
              </p>
            </div>
            {/* 月份选择器 */}
            <div className="flex items-center gap-1">
              {MONTHS.map((label, idx) => (
                <button key={idx} onClick={() => setActiveReimburseMonth(idx)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    activeReimburseMonth === idx
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 当前月营收展示 */}
        <div className="px-5 py-2 bg-cyan-50/30 border-b border-gray-100 flex items-center gap-4 text-xs">
          <span className="text-gray-500">
            {MONTHS[activeReimburseMonth]} 佣金收入：
            <span className="font-bold text-gray-700 ml-1">{fmt(monthlyRevenues[activeReimburseMonth] || 0)}</span>
          </span>
          <span className="text-gray-500">
            建议报销安全上限（20%）：
            <span className="font-bold text-cyan-700 ml-1">{fmt((monthlyRevenues[activeReimburseMonth] || 0) * 0.20)}</span>
          </span>
          <span className="text-gray-500">
            当前报销合计：
            <span className={`font-bold ml-1 ${
              (monthlyReimburseTotals[activeReimburseMonth] || 0) > (monthlyRevenues[activeReimburseMonth] || 0) * 0.20
                ? 'text-red-600' : 'text-green-600'
            }`}>
              {fmt(monthlyReimburseTotals[activeReimburseMonth] || 0)}
            </span>
          </span>
        </div>

        {/* 报销类别明细表 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                <th className="px-3 py-3 text-left font-medium">类别</th>
                <th className="px-3 py-3 text-right font-medium">安全范围（占营收%）</th>
                <th className="px-3 py-3 text-right font-medium">建议金额区间</th>
                <th className="px-3 py-3 text-right font-medium">本月录入</th>
                <th className="px-3 py-3 text-right font-medium">占营收%</th>
                <th className="px-3 py-3 text-center font-medium">风险</th>
                <th className="px-3 py-3 text-left font-medium">税前扣除规则</th>
                <th className="px-3 py-3 text-left font-medium">防查要点</th>
              </tr>
            </thead>
            <tbody>
              {REIMBURSE_CATEGORIES.map((cat) => {
                const amount = reimburseData[activeReimburseMonth]?.[cat.key] || 0;
                const revenue = monthlyRevenues[activeReimburseMonth] || 0;
                const pct = revenue > 0 ? (amount / revenue * 100).toFixed(2) : '0.00';
                const risk = reimburseRisk[activeReimburseMonth]?.risks[cat.key] || 'none';
                const [minPct, maxPct] = cat.safePct;
                const safeMin = Math.round(revenue * minPct * 100) / 100;
                const safeMax = Math.round(revenue * maxPct * 100) / 100;

                const riskStyle = {
                  safe:    { bg: 'bg-green-50',  text: 'text-green-700',  label: '安全',   icon: CheckCircle2 },
                  warning: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: '注意',   icon: AlertTriangle },
                  danger:  { bg: 'bg-red-50',    text: 'text-red-700',    label: '高风险', icon: XCircle },
                  none:    { bg: 'bg-gray-50',   text: 'text-gray-400',   label: '—',      icon: null },
                };
                const rs = riskStyle[risk];
                const RIcon = rs.icon;

                return (
                  <tr key={cat.key} className="border-b border-gray-100 hover:bg-gray-50/30">
                    <td className="px-3 py-2 font-medium text-gray-700">
                      <span className="mr-1">{cat.icon}</span>{cat.label}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 text-xs">
                      {(minPct * 100).toFixed(1)}% ~ {(maxPct * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 text-xs">
                      {revenue > 0 ? `${fmtNum(safeMin)} ~ ${fmtNum(safeMax)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" step="100" value={amount}
                        onChange={(e) => updateReimburse(activeReimburseMonth, cat.key, parseFloat(e.target.value) || 0)}
                        className={`w-28 px-2 py-1 border rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-cyan-500 ${
                          risk === 'danger' ? 'border-red-300 bg-red-50/30' :
                          risk === 'warning' ? 'border-yellow-300 bg-yellow-50/30' :
                          'border-gray-200'
                        }`} />
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 text-xs">{pct}%</td>
                    <td className="px-3 py-2 text-center">
                      {RIcon && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${rs.bg} ${rs.text}`}>
                          <RIcon size={12} />
                          {rs.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{cat.deductRule}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{cat.auditTip}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-300 font-bold">
                <td className="px-3 py-3 text-gray-700" colSpan="3">本月报销合计</td>
                <td className="px-3 py-3 text-right text-cyan-700">{fmtNum(monthlyReimburseTotals[activeReimburseMonth] || 0)}</td>
                <td className="px-3 py-3 text-right text-gray-600">
                  {((monthlyReimburseTotals[activeReimburseMonth] || 0) / Math.max(1, monthlyRevenues[activeReimburseMonth] || 0) * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-3 text-center">
                  {reimburseRisk[activeReimburseMonth]?.hasDanger ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-50 text-red-700">
                      <XCircle size={12} /> 高风险
                    </span>
                  ) : reimburseRisk[activeReimburseMonth]?.hasWarning ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-yellow-50 text-yellow-700">
                      <AlertTriangle size={12} /> 注意
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-50 text-green-700">
                      <CheckCircle2 size={12} /> 安全
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-gray-500" colSpan="2">
                  可税前扣除：{fmtNum(monthlyDeductible[activeReimburseMonth]?.deductible || 0)} ·
                  不可扣除：{fmtNum(monthlyDeductible[activeReimburseMonth]?.nonDeductible || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 防查机制提示 */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-200">
          <div className="flex items-start gap-2 mb-2">
            <ShieldCheck size={16} className="text-cyan-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs font-medium text-gray-700">防查机制 — 六大红线不可碰</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
            <div className="flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5">①</span>
              <span><strong>发票真实性</strong>：所有发票必须可在国家税务总局查验真伪，拒绝假票</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5">②</span>
              <span><strong>业务真实性</strong>：报销事项须与公司经营相关，有合同/审批/交付物佐证</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5">③</span>
              <span><strong>金额合理性</strong>：单张发票金额不宜过大，避免整数（如 ¥10,000.00）</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5">④</span>
              <span><strong>时间分散性</strong>：避免月末集中报销，各月金额波动不宜过大</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5">⑤</span>
              <span><strong>类别多样性</strong>：不要过度依赖单一类别，各类别占比合理</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-red-400 mt-0.5">⑥</span>
              <span><strong>供应商分散</strong>：避免同一供应商频繁开票，尤其是关联方</span>
            </div>
          </div>
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
                  <div className="flex justify-between">
                    <span className="text-gray-500">报销套现</span>
                    <span className="text-cyan-700">{fmt(q.actualReimburse)}</span>
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
            <p className="text-xs text-gray-400 mb-1">年度报销套现</p>
            <p className="text-lg font-bold text-cyan-300">{fmt(annualSummary.actualReimburse)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">年度用工成本（含企业社保）</p>
            <p className="text-lg font-bold text-gray-200">{fmt(annualSummary.actualCost)}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 pt-3 mt-3 border-t border-gray-700">
          <div>
            <p className="text-xs text-gray-400 mb-1">年度合计套现（工资+报销）</p>
            <p className="text-lg font-bold text-white">{fmt(annualSummary.actualTotal)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">报销可税前扣除</p>
            <p className="text-sm font-bold text-green-300">{fmt(annualSummary.totalDeductible)}</p>
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
              ⛔ 年度套现不足 {fmt(annualSummary.cashoutDiff)}，有部分钱未通过工资+报销发出。
              建议：提高部分员工工资、增加报销品类，使月度（工资+报销）≈ 月度佣金×95%。
            </div>
          )}
          {annualSummary.cashoutDiff < 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
              ⚠️ 年度超额套现 {fmt(Math.abs(annualSummary.cashoutDiff))}，工资+报销比佣金进账还多。
              建议：减少员工工资/报销金额，或增加佣金收入。
            </div>
          )}
          {Math.abs(annualSummary.cashoutDiff) < 100 && annualSummary.revenue > 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
              ✅ 套现精准匹配！工资实发+报销与95%佣金基本一致。
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
          {reimburseRisk.some(r => r.hasDanger) && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
              ⛔ 有 {reimburseRisk.filter(r => r.hasDanger).length} 个月份报销存在高风险！
              某些类别报销占比超出安全范围2倍以上，极易触发税务稽查。请立即调整报销结构。
            </div>
          )}
          {reimburseRisk.some(r => r.hasWarning) && !reimburseRisk.some(r => r.hasDanger) && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
              ⚠️ 有 {reimburseRisk.filter(r => r.hasWarning).length} 个月份报销接近上限，注意控制各类别报销比例。
            </div>
          )}
          <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-lg text-cyan-700">
            💡 报销套现搭配策略：当工资套现不足以覆盖95%佣金时，用报销补足差额。
            优先使用办公费、差旅费、交通费等低风险类别；
            业务招待费扣除限制最严（60%且≤营收5‰），谨慎使用；
            报销总额建议不超过月营收的 20%。
          </div>
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
            💡 当前每月工资实发 {fmt(monthlyNetTotal)}，对应每月佣金应为 {fmt(monthlyNetTotal / CASHOUT_RATE)} 才能精准匹配。
            季度佣金应控制在 {fmt(100000)} 以内（月均≤10万）以保持增值税免征。
          </div>
        </div>
      </div>
    </div>
  );
}
