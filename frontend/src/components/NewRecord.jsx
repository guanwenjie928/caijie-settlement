import { useState, useRef } from 'react';
import {
  Upload, FileText, Loader2, Check, AlertTriangle, Save, X, RotateCcw
} from 'lucide-react';
import { uploadAndRecognize, createRecord, checkDuplicate, getSettings } from '../api/client';

/**
 * 新增票据页 — 上传 → OCR识别 → 预览编辑（金额高亮+税号校验+重复警告）→ 入库
 */
export default function NewRecord() {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dupWarning, setDupWarning] = useState(null);
  const [saving, setSaving] = useState(false);

  // 表单字段
  const [form, setForm] = useState({
    person_name: '',
    company_name: '',
    tax_number: '',
    original_amount: '',
    entry_time: new Date().toISOString().slice(0, 16),
    source_file: '',
    remark: '',
  });

  // 税号校验（18位统一社会信用代码）
  const taxNumberValid = (form.tax_number || '').length === 18 && /^[A-Z0-9]{18}$/.test(form.tax_number || '');

  // 结算金额计算
  const [settlementRate, setSettlementRate] = useState(0.05);
  const settlementAmount = form.original_amount
    ? (parseFloat(form.original_amount) * settlementRate).toFixed(2)
    : '0.00';

  // ── 文件上传处理 ────────────────────────────────────────

  const handleFileSelect = async (file) => {
    if (!file) return;

    // 文件大小检查
    if (file.size > 10 * 1024 * 1024) {
      setError('文件大小超过10MB限制');
      return;
    }

    // 文件类型检查
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['png', 'jpg', 'jpeg', 'pdf', 'bmp', 'tiff', 'webp'].includes(ext)) {
      setError(`不支持的文件格式: .${ext}，请上传图片或PDF`);
      return;
    }

    setError('');
    setUploading(true);
    setRecognizing(true);

    try {
      // 获取当前结算比例
      const settingsRes = await getSettings();
      if (settingsRes.success) {
        setSettlementRate(settingsRes.data.settlement_rate);
      }

      // 上传并识别
      const result = await uploadAndRecognize(file);

      if (!result.success) {
        setError(result.error || '识别失败，请手动填写');
        // 即使识别失败也允许手动填写
        setForm({
          person_name: '',
          company_name: '',
          tax_number: '',
          original_amount: '',
          entry_time: new Date().toISOString().slice(0, 16),
          source_file: file.name,
          remark: '',
        });
        setPreviewData({ raw_text: '' });
      } else {
        const data = result.data;
        setForm({
          person_name: data.person_name || '',
          company_name: data.company_name || '',
          tax_number: data.tax_number || '',
          original_amount: data.original_amount ? String(data.original_amount) : '',
          entry_time: data.entry_time ? data.entry_time.slice(0, 16) : new Date().toISOString().slice(0, 16),
          source_file: file.name,
          remark: '',
        });
        setPreviewData(data);
      }
    } catch (err) {
      console.error('上传失败:', err);
      setError('上传失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
      setRecognizing(false);
    }
  };

  // ── 重复检测 ────────────────────────────────────────────

  const handleCheckDup = async () => {
    if (!form.company_name || !form.original_amount) return;
    try {
      const res = await checkDuplicate({
        company_name: form.company_name,
        tax_number: form.tax_number,
        original_amount: parseFloat(form.original_amount),
        entry_time: form.entry_time,
      });
      if (res.is_duplicate) {
        setDupWarning(res.matches);
      } else {
        setDupWarning(null);
      }
    } catch (err) {
      console.error('重复检测失败:', err);
    }
  };

  // ── 保存记录 ────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.original_amount || parseFloat(form.original_amount) <= 0) {
      setError('请填写有效的金额');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await createRecord({
        person_name: form.person_name,
        company_name: form.company_name,
        tax_number: form.tax_number,
        original_amount: parseFloat(form.original_amount),
        entry_time: form.entry_time,
        source_file: form.source_file,
        remark: form.remark,
      });

      if (res.success) {
        setSaveSuccess(true);
        setTimeout(() => {
          setSaveSuccess(false);
          // 重置表单
          setForm({
            person_name: '', company_name: '', tax_number: '',
            original_amount: '', entry_time: new Date().toISOString().slice(0, 16),
            source_file: '', remark: '',
          });
          setPreviewData(null);
          setDupWarning(null);
        }, 2000);
      }
    } catch (err) {
      setError('保存失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  // ── 重置 ────────────────────────────────────────────────

  const handleReset = () => {
    setForm({
      person_name: '', company_name: '', tax_number: '',
      original_amount: '', entry_time: new Date().toISOString().slice(0, 16),
      source_file: '', remark: '',
    });
    setPreviewData(null);
    setError('');
    setDupWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">新增票据</h2>

      {/* 上传区 */}
      <div
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 mb-6 text-center hover:border-primary-400 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={(e) => e.target.files[0] && handleFileSelect(e.target.files[0])}
        />
        {recognizing ? (
          <div className="flex flex-col items-center">
            <Loader2 className="animate-spin text-primary-500 mb-3" size={40} />
            <p className="text-sm text-gray-500">正在识别票据内容...</p>
            <p className="text-xs text-gray-400 mt-1">首次加载OCR引擎可能需要较长时间</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mb-3">
              <Upload className="text-primary-500" size={28} />
            </div>
            <p className="text-sm text-gray-600 font-medium">点击或拖拽文件到此处上传</p>
            <p className="text-xs text-gray-400 mt-1">支持 PNG / JPG / PDF 格式，最大 10MB</p>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* 识别结果表单 */}
      {previewData && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-primary-600" />
            <h3 className="text-lg font-semibold text-gray-800">识别结果（请核对并修改）</h3>
          </div>

          <div className="space-y-4">
            {/* 人名 */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="text-sm text-gray-600 text-right">人名</label>
              <input
                value={form.person_name}
                onChange={(e) => setForm({ ...form, person_name: e.target.value })}
                className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="收款人/开票人姓名"
              />
            </div>

            {/* 公司名 */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="text-sm text-gray-600 text-right">公司名</label>
              <input
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                onBlur={handleCheckDup}
                className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="公司/单位名称"
              />
            </div>

            {/* 税号 */}
            <div className="grid grid-cols-3 items-start gap-4">
              <label className="text-sm text-gray-600 text-right pt-2">税号</label>
              <div className="col-span-2">
                <input
                  value={form.tax_number}
                  onChange={(e) => setForm({ ...form, tax_number: e.target.value.toUpperCase() })}
                  className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 ${
                    form.tax_number && !taxNumberValid
                      ? 'border-red-400 focus:ring-red-500 bg-red-50'
                      : 'border-gray-300 focus:ring-primary-500'
                  }`}
                  placeholder="18位统一社会信用代码"
                />
                {form.tax_number && !taxNumberValid && (
                  <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    税号格式不正确（应为18位字母+数字）
                  </p>
                )}
                {form.tax_number && taxNumberValid && (
                  <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                    <Check size={12} />
                    税号格式正确
                  </p>
                )}
              </div>
            </div>

            {/* 原始金额 — 高亮提示 */}
            <div className="grid grid-cols-3 items-start gap-4">
              <label className="text-sm text-gray-600 text-right pt-2">
                原始金额
                <span className="text-red-500 ml-1">*</span>
              </label>
              <div className="col-span-2">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.original_amount}
                    onChange={(e) => setForm({ ...form, original_amount: e.target.value })}
                    onBlur={handleCheckDup}
                    className="w-full pl-8 pr-3 py-2 border-2 border-orange-400 bg-orange-50 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="请务必核对金额"
                  />
                </div>
                <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  请务必核对金额，此为计算结算金额的基数
                </p>
              </div>
            </div>

            {/* 结算金额（只读，自动计算） */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="text-sm text-gray-600 text-right">结算金额</label>
              <div className="col-span-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
                <span className="text-green-700 font-bold">¥ {settlementAmount}</span>
                <span className="text-xs text-green-500 ml-2">（原始金额 × {(settlementRate * 100).toFixed(1)}%）</span>
              </div>
            </div>

            {/* 录入时间 */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="text-sm text-gray-600 text-right">录入时间</label>
              <input
                type="datetime-local"
                value={form.entry_time}
                onChange={(e) => setForm({ ...form, entry_time: e.target.value })}
                className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {/* 备注 */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="text-sm text-gray-600 text-right">备注</label>
              <input
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
                className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="可选备注信息"
              />
            </div>

            {/* 来源文件 */}
            {form.source_file && (
              <div className="grid grid-cols-3 items-center gap-4">
                <label className="text-sm text-gray-600 text-right">来源文件</label>
                <div className="col-span-2 text-sm text-gray-500 flex items-center gap-2">
                  <FileText size={14} />
                  {form.source_file}
                </div>
              </div>
            )}
          </div>

          {/* 重复警告 */}
          {dupWarning && dupWarning.length > 0 && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
              <div className="flex items-center gap-2 text-yellow-700 font-medium text-sm mb-2">
                <AlertTriangle size={16} />
                检测到疑似重复记录（{dupWarning.length}条）
              </div>
              <div className="space-y-1 text-xs text-yellow-600">
                {dupWarning.map((r) => (
                  <div key={r.id}>
                    {r.company_name} - ¥{r.original_amount} - {r.entry_time?.slice(0, 10)}
                  </div>
                ))}
              </div>
              <p className="text-xs text-yellow-600 mt-2">如确认为重复，请取消录入；如非重复可忽略此提示。</p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-5 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              <RotateCcw size={15} />
              重置
            </button>
            <button
              onClick={handleSave}
              disabled={saving || saveSuccess}
              className={`flex items-center gap-1.5 px-5 py-2 text-sm text-white rounded-lg ${
                saveSuccess ? 'bg-green-600' : 'bg-primary-600 hover:bg-primary-700'
              } disabled:opacity-70`}
            >
              {saveSuccess ? (
                <><Check size={15} /> 已录入</>
              ) : saving ? (
                <><Loader2 className="animate-spin" size={15} /> 保存中...</>
              ) : (
                <><Save size={15} /> 确认录入</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
