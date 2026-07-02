import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Loader2, CheckCircle, ChevronLeft, ChevronRight, Shield,
  User, Briefcase, MapPin, ClipboardCheck, ClipboardList,
  FileText, Building2, Copy, Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/context/LanguageContext";
import type { ProjectField } from "@shared/schema";

const STEP_ICONS = [Shield, User, Briefcase, Building2, MapPin, ClipboardCheck, FileText];

interface FormInfo {
  project: {
    id: string; name: string; formTitle: string; formSubtitle?: string;
    formEnabled: boolean; formDisabledMessage?: string; steps: string[]; requiresCode: boolean;
  };
  fields: ProjectField[];
}

export function ProjectRegister() {
  const { projectId } = useParams<{ projectId: string }>();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const [step, setStep] = useState(0);
  const [codeVerified, setCodeVerified] = useState(false);
  const [codeSkipped, setCodeSkipped] = useState(false);
  const [invitationCode, setInvitationCode] = useState("");
  const [codeError, setCodError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [editToken, setEditToken] = useState("");
  const [tokenHours, setTokenHours] = useState(48);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fromReview, setFromReview] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(200);

  const { data: formInfo, isLoading } = useQuery<FormInfo>({
    queryKey: ["/api/pform", projectId, "info"],
    queryFn: () => fetch(`/api/pform/${projectId}/info`).then(r => r.json()),
  });

  const { register, handleSubmit, trigger, getValues, formState: { errors } } = useForm<Record<string, any>>();

  const project = formInfo?.project;
  const fields = formInfo?.fields || [];
  const steps = project?.steps || [isAr ? "التسجيل" : "Registration"];
  const totalSteps = steps.length;

  useEffect(() => {
    if (project && !project.requiresCode && !codeVerified && !codeSkipped) {
      setCodeSkipped(true);
      setCodeVerified(true);
    }
  }, [project]);

  useEffect(() => {
    if (headerRef.current) {
      const obs = new ResizeObserver(() => {
        if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
      });
      obs.observe(headerRef.current);
      setHeaderH(headerRef.current.offsetHeight);
      return () => obs.disconnect();
    }
  }, [codeVerified]);

  const getStepFields = (stepNum: number) => fields.filter(f => (f.stepNumber || 1) === stepNum);
  const isReviewStep = step === totalSteps - 1;
  const progressPercent = totalSteps > 1 ? Math.round((step / (totalSteps - 1)) * 100) : 100;

  const verifyCode = async () => {
    setVerifying(true); setCodError("");
    try {
      const res = await fetch(`/api/pform/${projectId}/verify-code`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ code: invitationCode }),
      });
      const data = await res.json();
      if (res.ok) { setCodeVerified(true); }
      else { setCodError(data.error || (isAr ? "رمز الدعوة غير صحيح" : "Invalid invitation code")); }
    } catch { setCodError(isAr ? "حدث خطأ. حاول مجدداً." : "An error occurred. Please try again."); }
    setVerifying(false);
  };

  const submitMut = useMutation({
    mutationFn: (formData: Record<string, any>) => fetch(`/api/pform/${projectId}/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(formData),
    }).then(r => r.json()),
    onSuccess: (data) => {
      if (data.ok) { setSubmitted(true); setEditToken(data.editToken); setTokenHours(data.tokenHours); }
    },
  });

  const nextStep = async () => {
    const stepFields = getStepFields(step + 1);
    const keys = stepFields.map(f => f.key);
    const valid = await trigger(keys);
    if (valid) {
      if (fromReview) {
        setFromReview(false);
        setStep(totalSteps - 1);
      } else {
        setStep(s => Math.min(s + 1, totalSteps - 1));
      }
    }
  };

  const goToStepForEdit = (si: number) => {
    setFromReview(true);
    setStep(si);
  };

  const printReport = () => {
    const vals = getValues();
    const printSteps = steps.slice(0, -1);
    const date = new Date().toLocaleDateString(isAr ? "ar-SY" : "en-US", { year: "numeric", month: "long", day: "numeric" });

    const sectionsHtml = printSteps.map((stepName, si) => {
      const stepFields = getStepFields(si + 1);
      if (stepFields.length === 0) return "";
      const rows = stepFields.map(f => {
        const val = vals[f.key];
        const display = (val !== undefined && val !== "" && val !== null) ? String(val) : "—";
        return `<tr>
          <td class="label-cell">${f.label}</td>
          <td class="value-cell">${display}</td>
        </tr>`;
      }).join("");
      return `
        <div class="section">
          <div class="section-header">
            <span class="section-num">${si + 1}</span>
            <span class="section-title">${stepName}</span>
          </div>
          <table class="data-table">
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");

    const html = `<!DOCTYPE html>
<html lang="${isAr ? "ar" : "en"}" dir="${isAr ? "rtl" : "ltr"}">
<head>
  <meta charset="UTF-8"/>
  <title>${isAr ? "تقرير بيانات" : "Data Report"} — ${project?.formTitle || ""}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 11pt;
      color: #1e293b;
      background: #fff;
      direction: ${isAr ? "rtl" : "ltr"};
    }
    .page { max-width: 210mm; margin: 0 auto; padding: 12mm 15mm; }

    /* ── Header ── */
    .report-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #1d4ed8;
      padding-bottom: 10mm;
      margin-bottom: 8mm;
    }
    .report-header-right { display: flex; align-items: center; gap: 12px; }
    .logo-circle {
      width: 52px; height: 52px;
      background: #1d4ed8;
      border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 22px; font-weight: 900;
      flex-shrink: 0;
    }
    .report-title { font-size: 16pt; font-weight: 900; color: #1d4ed8; line-height: 1.3; }
    .report-subtitle { font-size: 9pt; color: #64748b; margin-top: 2px; }
    .report-meta { text-align: ${isAr ? "left" : "right"}; font-size: 9pt; color: #64748b; line-height: 1.8; }
    .report-meta strong { color: #1e293b; }

    /* ── Status bar ── */
    .status-bar {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 8px 14px;
      margin-bottom: 7mm;
      font-size: 9.5pt;
      color: #15803d;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; flex-shrink: 0; }

    /* ── Sections ── */
    .section { margin-bottom: 6mm; break-inside: avoid; }
    .section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #1d4ed8;
      color: #fff;
      padding: 6px 12px;
      border-radius: 6px 6px 0 0;
    }
    .section-num {
      width: 22px; height: 22px;
      background: rgba(255,255,255,0.25);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 9pt; font-weight: 700; flex-shrink: 0;
    }
    .section-title { font-size: 11pt; font-weight: 700; }

    /* ── Table ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #e2e8f0;
      border-top: none;
      border-radius: 0 0 6px 6px;
      overflow: hidden;
    }
    .data-table tbody tr:nth-child(odd)  { background: #f8fafc; }
    .data-table tbody tr:nth-child(even) { background: #fff; }
    .data-table tr:last-child td { border-bottom: none; }
    .label-cell {
      width: 38%;
      padding: 6px 12px;
      font-size: 9.5pt;
      color: #475569;
      border-bottom: 1px solid #e2e8f0;
      border-${isAr ? "left" : "right"}: 1px solid #e2e8f0;
      font-weight: 500;
    }
    .value-cell {
      width: 62%;
      padding: 6px 12px;
      font-size: 9.5pt;
      color: #0f172a;
      border-bottom: 1px solid #e2e8f0;
      font-weight: 600;
    }
    .value-cell.empty { color: #94a3b8; font-weight: 400; }

    /* ── Footer ── */
    .report-footer {
      margin-top: 10mm;
      padding-top: 6mm;
      border-top: 1.5px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-size: 8.5pt;
      color: #94a3b8;
    }
    .signature-box {
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      padding: 8px 20px;
      text-align: center;
      font-size: 8pt;
      color: #94a3b8;
      min-width: 120px;
    }
    .signature-box .sig-line { border-top: 1px solid #cbd5e1; margin-top: 20px; padding-top: 5px; }

    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 8mm 12mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="report-header">
    <div class="report-header-right">
      <div class="logo-circle">${isAr ? "م" : "M"}</div>
      <div>
        <div class="report-title">${project?.formTitle || (isAr ? "نموذج التسجيل" : "Registration Form")}</div>
        <div class="report-subtitle">${project?.formSubtitle || (isAr ? "منصة مسارات" : "Masarat Platform")}</div>
      </div>
    </div>
    <div class="report-meta">
      <div>${isAr ? "تاريخ الطباعة" : "Print Date"}: <strong>${date}</strong></div>
      <div>${isAr ? "الحالة" : "Status"}: <strong style="color:#15803d">${isAr ? "في انتظار الإرسال" : "Pending Submission"}</strong></div>
    </div>
  </div>

  <!-- Status -->
  <div class="status-bar">
    <div class="status-dot"></div>
    ${isAr ? "تقرير مراجعة البيانات — يُرجى التحقق من صحة جميع المعلومات قبل الإرسال النهائي" : "Data Review Report — Please verify all information before final submission"}
  </div>

  <!-- Sections -->
  ${sectionsHtml}

  <!-- Footer -->
  <div class="report-footer">
    <div>
      <div>${isAr ? `هذا التقرير تم إنشاؤه تلقائياً بتاريخ ${date}` : `This report was automatically generated on ${date}`}</div>
      <div style="margin-top:3px">${isAr ? "منصة مسارات — إدارة نماذج التسجيل والبيانات" : "Masarat Platform — Forms & Data Management"}</div>
    </div>
    <div class="signature-box">
      ${isAr ? "توقيع المسؤول" : "Authorized Signature"}
      <div class="sig-line">${isAr ? "التوقيع والختم" : "Signature & Stamp"}</div>
    </div>
  </div>

</div>
<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=900,height=700");
    if (win) { win.document.write(html); win.document.close(); }
  };

  const copyLink = () => {
    const link = `${window.location.origin}/p/${projectId}/edit/${editToken}`;
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const renderField = (f: ProjectField) => (
    <div key={f.id} className={cn("space-y-1.5", f.fieldType === "textarea" ? "col-span-2" : "")}>
      <Label className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {f.label}
        {f.isRequired && <span className="text-red-500 mr-1">*</span>}
      </Label>

      {f.fieldType === "textarea" ? (
        <Textarea
          {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
          placeholder={f.placeholder || ""}
          rows={3}
          data-testid={`input-${f.key}`}
        />
      ) : f.fieldType === "select" && f.options ? (
        <select
          {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition"
          data-testid={`select-${f.key}`}>
          <option value="">{isAr ? "— اختر —" : "— Select —"}</option>
          {(f.options as string[]).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : f.fieldType === "radio" && f.options ? (
        <div className="flex flex-wrap gap-3 pt-1">
          {(f.options as string[]).map(opt => (
            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 hover:border-primary/50 transition">
              <input type="radio" {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
                value={opt} className="accent-primary w-3.5 h-3.5" />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      ) : (
        <Input
          {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
          type={
            f.fieldType === "number" ? "number" :
            f.fieldType === "date" ? "date" :
            f.fieldType === "email" ? "email" :
            f.fieldType === "phone" ? "tel" : "text"
          }
          placeholder={f.placeholder || ""}
          data-testid={`input-${f.key}`}
        />
      )}
      {(errors as any)[f.key] && (
        <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
          <span>⚠</span> {(errors as any)[f.key]?.message}
        </p>
      )}
    </div>
  );

  /* ─── Loading ─── */
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  /* ─── Form disabled ─── */
  if (!project || !project.formEnabled) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4">
      <Card className="p-8 max-w-sm w-full text-center space-y-3">
        <Shield className="h-12 w-12 text-slate-300 mx-auto" />
        <h2 className="text-lg font-bold">{project?.formDisabledMessage || (isAr ? "النموذج متوقف مؤقتاً" : "Form is temporarily disabled")}</h2>
      </Card>
    </div>
  );

  /* ─── Submitted ─── */
  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4" dir={isAr ? "rtl" : "ltr"}>
      <Card className="p-8 max-w-sm w-full text-center space-y-5">
        <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <CheckCircle className="h-12 w-12 text-green-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{isAr ? "تم التسجيل بنجاح!" : "Registration Successful!"}</h2>
          <p className="text-sm text-muted-foreground mt-1">{isAr ? "شكراً لك على تعبئة النموذج" : "Thank you for filling out the form"}</p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700 space-y-2">
          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">{isAr ? "رابط التعديل الخاص بك" : "Your personal edit link"}</p>
          <p className="text-[11px] font-mono break-all text-slate-500 dark:text-slate-400 text-left leading-relaxed">
            {`${window.location.origin}/p/${projectId}/edit/${editToken}`}
          </p>
          <p className="text-[11px] text-muted-foreground">{isAr ? `صالح لمدة ${tokenHours} ساعة` : `Valid for ${tokenHours} hours`}</p>
        </div>
        <Button onClick={copyLink} className="w-full gap-2" variant={copied ? "secondary" : "default"} data-testid="button-copy-link">
          {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? (isAr ? "تم النسخ!" : "Copied!") : (isAr ? "نسخ رابط التعديل" : "Copy edit link")}
        </Button>
      </Card>
    </div>
  );

  /* ─── Invitation code screen ─── */
  if (!codeVerified) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 p-4" dir={isAr ? "rtl" : "ltr"}>
      <Card className="p-8 max-w-sm w-full space-y-5 shadow-xl">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{project.formTitle}</h1>
            {project.formSubtitle && <p className="text-sm text-muted-foreground mt-1">{project.formSubtitle}</p>}
          </div>
          <p className="text-sm text-muted-foreground">{isAr ? "أدخل رمز الدعوة للوصول إلى النموذج" : "Enter invitation code to access the form"}</p>
        </div>
        <Input
          value={invitationCode}
          onChange={e => setInvitationCode(e.target.value)}
          placeholder="NAWAH-2026"
          className="text-center text-xl tracking-[0.3em] font-mono h-14"
          onKeyDown={e => e.key === "Enter" && verifyCode()}
          data-testid="input-invitation-code"
        />
        {codeError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-600 dark:text-red-400 text-center">
            {codeError}
          </div>
        )}
        <Button className="w-full h-12 text-base gap-2" onClick={verifyCode} disabled={verifying} data-testid="button-verify-code">
          {verifying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Shield className="h-5 w-5" />}
          {isAr ? "دخول" : "Enter"}
        </Button>
      </Card>
    </div>
  );

  /* ─── Main form ─── */
  const currentStepFields = isReviewStep ? [] : getStepFields(step + 1);
  const CurrentIcon = STEP_ICONS[step % STEP_ICONS.length];
  const allValues = getValues();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col" dir={isAr ? "rtl" : "ltr"}>

      {/* ══ Fixed top area (header + stepper) ══ */}
      <div ref={headerRef} className="fixed top-0 inset-x-0 z-50">

        {/* Header bar */}
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
            {/* Step badge */}
            <span className="bg-primary/10 text-primary text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap">
              {isAr ? `الخطوة ${step + 1} من ${totalSteps}` : `Step ${step + 1} of ${totalSteps}`}
            </span>
            {/* Title */}
            <p className="flex-1 text-sm font-bold text-slate-800 dark:text-slate-100 text-center truncate">
              {project.formTitle}
            </p>
            {/* Logo */}
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-md">
              <ClipboardList className="h-5 w-5 text-white" />
            </div>
          </div>
        </header>

        {/* Steps + Progress */}
        <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-4 pt-4 pb-3">
          <div className="max-w-3xl mx-auto">

            {/* Step circles */}
            <div className="relative flex items-start justify-between">
              {/* Background line */}
              <div className="absolute top-[18px] right-5 left-5 h-0.5 bg-slate-200 dark:bg-slate-700" />
              {/* Progress line */}
              <div
                className="absolute top-[18px] right-5 h-0.5 bg-primary transition-all duration-500"
                style={{
                  width: totalSteps > 1 ? `calc(${(step / (totalSteps - 1)) * 100}% * (100% - 40px) / 100%)` : "0%",
                  [isAr ? "right" : "left"]: "20px",
                  [isAr ? "left" : "right"]: "auto"
                }}
              />
              {steps.map((s, i) => {
                const Icon = STEP_ICONS[i % STEP_ICONS.length];
                const done = i < step;
                const active = i === step;
                return (
                  <div key={i} className="flex flex-col items-center gap-1.5 z-10" style={{ minWidth: 0, flex: 1 }}>
                    <div className={cn(
                      "w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 bg-white dark:bg-slate-800",
                      done ? "border-primary bg-primary" :
                      active ? "border-primary shadow-[0_0_0_4px_rgba(var(--primary)/0.15)]" :
                      "border-slate-300 dark:border-slate-600"
                    )}>
                      {done
                        ? <CheckCircle className="h-5 w-5 text-white" />
                        : <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-slate-400 dark:text-slate-500")} />
                      }
                    </div>
                    <span className={cn(
                      "text-[10px] font-semibold text-center leading-tight px-1 truncate w-full",
                      active ? "text-primary" : done ? "text-slate-500" : "text-slate-400 dark:text-slate-500"
                    )}>
                      {s}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar + percentage */}
            <div className="flex items-center gap-3 mt-3">
              <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={cn("h-full bg-gradient-to-l from-primary to-primary/70 rounded-full transition-all duration-500", !isAr && "bg-gradient-to-r")}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground font-semibold whitespace-nowrap">
                {isAr ? `الخطوة ${step + 1} من ${totalSteps} — ${progressPercent}% مكتمل` : `Step ${step + 1} of ${totalSteps} — ${progressPercent}% complete`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ══ Scrollable content ══ */}
      <main className="flex-1 pb-24" style={{ paddingTop: headerH + 8 }}>
        <div className="max-w-3xl mx-auto px-4 py-6">
          <form onSubmit={handleSubmit(d => submitMut.mutate(d))}>

            {isReviewStep ? (
              /* Review — read-only summary grouped by step */
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4">
                  <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center shrink-0">
                    <ClipboardCheck className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-slate-800 dark:text-slate-100">{isAr ? "مراجعة وتعديل البيانات" : "Review & Edit Data"}</h2>
                    <p className="text-xs text-muted-foreground">{isAr ? "راجع بياناتك قبل الإرسال النهائي، واضغط \"تعديل\" لتغيير أي قسم" : "Review your data before final submission, and click \"Edit\" to change any section"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={printReport}
                    data-testid="button-print-report"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 px-3 py-2 rounded-xl transition shadow-sm shrink-0"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    {isAr ? "طباعة التقرير" : "Print Report"}
                  </button>
                </div>

                {/* One card per step */}
                {steps.slice(0, -1).map((stepName, si) => {
                  const stepFields = getStepFields(si + 1);
                  if (stepFields.length === 0) return null;
                  const StepIcon = STEP_ICONS[si % STEP_ICONS.length];
                  const vals = allValues;
                  return (
                    <Card key={si} className="overflow-hidden shadow-sm">
                      {/* Card header */}
                      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <StepIcon className="h-4 w-4 text-primary" />
                          </div>
                          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{stepName}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => goToStepForEdit(si)}
                          className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition px-2 py-1 rounded-lg hover:bg-primary/5"
                          data-testid={`button-edit-step-${si}`}
                        >
                          {isAr ? "✏️ تعديل" : "✏️ Edit"}
                        </button>
                      </div>
                      {/* Read-only rows */}
                      <div className="px-5 py-3">
                        <dl>
                          {stepFields.map(f => (
                            <div
                              key={f.id}
                              className="flex items-start gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-0"
                            >
                              <dt className={cn("text-xs text-muted-foreground w-40 shrink-0 pt-0.5 leading-relaxed", isAr ? "text-right" : "text-left")}>
                                {f.label}
                              </dt>
                              <dd className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 break-words">
                                {vals[f.key] !== undefined && vals[f.key] !== "" && vals[f.key] !== null
                                  ? String(vals[f.key])
                                  : <span className="text-slate-400 dark:text-slate-500 font-normal">—</span>
                                }
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Fields card */
              <Card className="overflow-hidden shadow-sm">
                {/* Section header */}
                <div className="flex items-center gap-3 p-5 border-b border-slate-100 dark:border-slate-700 bg-primary/5 dark:bg-primary/10">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0">
                    <CurrentIcon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-bold text-slate-800 dark:text-slate-100">{steps[step]}</h2>
                    <p className="text-xs text-muted-foreground">
                      {isAr ? (
                        currentStepFields.filter(f => f.isRequired).length > 0
                          ? `${currentStepFields.filter(f => f.isRequired).length} حقول إلزامية`
                          : "جميع الحقول اختيارية"
                      ) : (
                        currentStepFields.filter(f => f.isRequired).length > 0
                          ? `${currentStepFields.filter(f => f.isRequired).length} required fields`
                          : "All fields are optional"
                      )}
                    </p>
                  </div>
                </div>

                {/* Fields grid */}
                <div className="p-5">
                  {currentStepFields.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {currentStepFields.map(f => renderField(f))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-6">{isAr ? "لا توجد حقول لهذه الخطوة" : "No fields for this step"}</p>
                  )}
                </div>
              </Card>
            )}

          </form>
        </div>
      </main>

      {/* ══ Fixed bottom navigation ══ */}
      <div className="fixed bottom-0 inset-x-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-50">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">

          {/* Back */}
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={() => setStep(s => s - 1)}
              data-testid="button-prev" className="gap-2 h-11 px-5">
              <ChevronRight className={cn("h-4 w-4", !isAr && "rotate-180")} />
              {isAr ? "رجوع" : "Back"}
            </Button>
          ) : <div />}

          {/* Next / Submit */}
          {isReviewStep ? (
            <Button
              onClick={handleSubmit(d => submitMut.mutate(d))}
              disabled={submitMut.isPending}
              data-testid="button-submit-form"
              className="gap-2 h-11 px-8 bg-green-600 hover:bg-green-700 text-white"
            >
              {submitMut.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCircle className="h-4 w-4" />
              }
              {isAr ? "إرسال البيانات" : "Submit Data"}
            </Button>
          ) : fromReview ? (
            <Button type="button" onClick={nextStep}
              data-testid="button-back-to-review" className="gap-2 h-11 px-8 bg-green-600 hover:bg-green-700 text-white">
              <CheckCircle className="h-4 w-4" />
              {isAr ? "العودة للمراجعة" : "Back to Review"}
            </Button>
          ) : (
            <Button type="button" onClick={nextStep}
              data-testid="button-next" className="gap-2 h-11 px-8">
              {isAr ? "متابعة" : "Continue"}
              <ChevronLeft className={cn("h-4 w-4", !isAr && "rotate-180")} />
            </Button>
          )}

        </div>
      </div>
    </div>
  );
}
