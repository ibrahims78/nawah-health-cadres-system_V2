import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { DesignerCredit } from "@/components/DesignerCredit";
import {
  Loader2, CheckCircle, ChevronLeft, ChevronRight,
  User, Briefcase, MapPin, ClipboardCheck, FileText, Building2,
  AlertTriangle, Lock, Send, ExternalLink, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/context/LanguageContext";
import { FileField } from "@/components/FileField";
import type { ProjectField } from "@shared/schema";
import { isFieldVisible as checkFieldVisible } from "@/lib/fieldVisibility";

const STEP_ICONS = [User, Briefcase, Building2, MapPin, ClipboardCheck, FileText];

function escapeHtml(input: string): string {
  return String(input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface ParticipantFormData {
  project: { id: string; name: string; formTitle: string; formSubtitle?: string; steps: string[] };
  fields: ProjectField[];
  participant: { id: string; name: string; token: string; telegramChatId: string | null } | null;
  prefillData?: Record<string, any>;
  canSubmit: boolean;
  canEdit: boolean;
  locked?: boolean;
  botUsername?: string | null;
  editDeadline?: string | null;
}

export function ProjectParticipantForm() {
  const { projectId, token } = useParams<{ projectId: string; token: string }>();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [fromReview, setFromReview] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(160);
  const [botWarningDismissed, setBotWarningDismissed] = useState(false);
  const uploadFolder = useMemo(() => crypto.randomUUID(), []);

  const { data: formData, isLoading, error } = useQuery<ParticipantFormData>({
    queryKey: ["/api/pform", projectId, "p", token],
    queryFn: () =>
      fetch(`/api/pform/${projectId}/p/${token}`, { credentials: "include" })
        .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "خطأ"); return d; }),
    retry: 0,
  });

  const project = formData?.project;
  const fields = formData?.fields || [];
  const participant = formData?.participant;
  const canSubmit = formData?.canSubmit ?? false;
  const canEdit = formData?.canEdit ?? false;
  const locked = formData?.locked ?? false;
  const botUsername = formData?.botUsername;
  const editDeadline = formData?.editDeadline ? new Date(formData.editDeadline) : null;

  const steps = project?.steps || [];
  const formSteps = steps.slice(0, -1);
  const reviewStep = formSteps.length;
  const totalSteps = formSteps.length + 1;

  const { register, handleSubmit, watch, setValue, getValues, reset } = useForm<any>({ defaultValues: {} });
  const formValues = watch();

  useEffect(() => {
    if (formData?.prefillData && Object.keys(formData.prefillData).length > 0) {
      reset(formData.prefillData);
    }
  }, [formData?.prefillData]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => setHeaderH(entries[0].contentRect.height));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const submitMut = useMutation({
    mutationFn: (data: any) =>
      fetch(`/api/pform/${projectId}/p/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "خطأ"); return d; }),
    onSuccess: () => setSubmitted(true),
  });

  const editMut = useMutation({
    mutationFn: (data: any) =>
      fetch(`/api/pform/${projectId}/p/${token}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "خطأ"); return d; }),
    onSuccess: () => setSubmitted(true),
  });

  const isPending = submitMut.isPending || editMut.isPending;

  const getStepFields = (stepNum: number) =>
    fields.filter(f => (f.stepNumber ?? 1) === stepNum + 1 && f.fieldType !== "heading");
  const getStepHeadings = (stepNum: number) =>
    fields.filter(f => (f.stepNumber ?? 1) === stepNum + 1 && f.fieldType === "heading");
  const getAllStepFields = (stepNum: number) =>
    fields.filter(f => (f.stepNumber ?? 1) === stepNum + 1);

  const stepHasError = (stepNum: number) => {
    const sf = getStepFields(stepNum).filter(f => f.isRequired && f.isVisible);
    return sf.some(f => {
      const v = formValues[f.key];
      return !v || String(v).trim() === "";
    });
  };

  const onSubmitForm = handleSubmit((data) => {
    if (step === reviewStep) {
      if (canEdit) editMut.mutate(data);
      else if (canSubmit) submitMut.mutate(data);
    } else {
      setStep(reviewStep);
      setFromReview(false);
    }
  });

  const goNext = () => {
    if (step < reviewStep) setStep(s => s + 1);
  };
  const goPrev = () => {
    if (step > 0) setStep(s => s - 1);
  };
  const goToStep = (s: number) => setStep(s);

  // ── Render helpers ──
  const renderField = (f: ProjectField) => {
    const visible = checkFieldVisible(f, formValues, fields);
    if (!visible) return null;
    if (f.fieldType === "heading") return (
      <div key={f.id} className="col-span-2 pt-2">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 pb-2">{f.label}</h3>
      </div>
    );
    const isFullW = f.isFullWidth || ["textarea", "file"].includes(f.fieldType);
    return (
      <div key={f.id} className={cn("space-y-1.5", isFullW ? "col-span-2" : "col-span-1")}>
        <Label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {f.label}{f.isRequired && <span className="text-red-500 mr-0.5">*</span>}
        </Label>
        {f.fieldType === "textarea" ? (
          <Textarea {...register(f.key)} placeholder={f.placeholder || ""} rows={3} className="text-sm" />
        ) : f.fieldType === "select" || f.fieldType === "radio" ? (
          <select
            {...register(f.key)}
            className="w-full border border-slate-200 dark:border-slate-600 rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">{isAr ? "— اختر —" : "— Select —"}</option>
            {(f.options as string[] || []).map((opt: string) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : f.fieldType === "checkbox" ? (
          <div className="flex items-center gap-2 pt-1">
            <input type="checkbox" {...register(f.key)} id={f.key} className="h-4 w-4 rounded" />
            <Label htmlFor={f.key} className="text-sm cursor-pointer">{f.placeholder || f.label}</Label>
          </div>
        ) : f.fieldType === "file" ? (
          <FileField
            fieldKey={f.key}
            projectId={projectId!}
            uploadFolder={uploadFolder}
            allowedFileTypes={f.allowedFileTypes as string[] | null | undefined}
            maxFileSizeMb={f.maxFileSizeMb ?? undefined}
            value={formValues[f.key] || ""}
            onChange={(url) => setValue(f.key, url)}
          />
        ) : (
          <Input
            {...register(f.key)}
            type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : f.fieldType === "email" ? "email" : f.fieldType === "phone" ? "tel" : "text"}
            placeholder={f.placeholder || ""}
            className="text-sm"
          />
        )}
      </div>
    );
  };

  // ── Error / loading states ──
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (error || !project) return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="p-8 max-w-sm text-center">
        <div className="text-4xl mb-4">🔒</div>
        <h2 className="text-lg font-bold mb-2">{isAr ? "رابط غير صالح" : "Invalid Link"}</h2>
        <p className="text-sm text-muted-foreground">{(error as any)?.message || (isAr ? "الرابط المستخدم غير صالح أو انتهت صلاحيته." : "This link is invalid or has expired.")}</p>
      </Card>
    </div>
  );

  // ── Locked (submitted + past edit window) ──
  if (locked || (submitted && !canEdit)) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-8 max-w-sm text-center">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">{isAr ? "شكراً لك! 🎉" : "Thank You! 🎉"}</h2>
        {participant && <p className="text-sm text-muted-foreground">{isAr ? `تم تسجيل بياناتك ${participant.name ? `يا ${participant.name}` : ""} بنجاح.` : `Your registration, ${participant.name || ""}, was submitted successfully.`}</p>}
        {locked && !submitted && <p className="text-xs text-muted-foreground mt-2">{isAr ? "انتهت فترة التعديل." : "The editing period has ended."}</p>}
        <DesignerCredit />
      </Card>
    </div>
  );

  // ── After submission ──
  if (submitted) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="p-8 max-w-sm text-center">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">{isAr ? "تم بنجاح! 🎉" : "Done! 🎉"}</h2>
        <p className="text-sm text-muted-foreground">
          {canEdit
            ? (isAr ? "تم تحديث بياناتك بنجاح." : "Your data has been updated successfully.")
            : (isAr ? "تم إرسال بياناتك بنجاح." : "Your data has been submitted successfully.")}
        </p>
        {canEdit && editDeadline && (
          <p className="text-xs text-muted-foreground mt-2">
            {isAr ? `يمكنك التعديل حتى: ${editDeadline.toLocaleString("ar")}` : `Editable until: ${editDeadline.toLocaleString()}`}
          </p>
        )}
        <DesignerCredit />
      </Card>
    </div>
  );

  const errMsg = submitMut.error?.message || editMut.error?.message;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* ─── Sticky header ─── */}
      <div ref={headerRef} className="fixed top-0 inset-x-0 z-30">
        {/* Bot activation warning */}
        {participant && !participant.telegramChatId && botUsername && !botWarningDismissed && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{isAr ? "لتلقي التذكيرات على تيليغرام، فعّل البوت أولاً" : "To receive Telegram reminders, activate the bot first"}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                onClick={() => window.open(`https://t.me/${botUsername}?start=${token}`, "_blank")}
                data-testid="button-activate-bot"
              >
                <ExternalLink className="h-3 w-3 ml-1" />
                {isAr ? "فتح البوت" : "Open Bot"}
              </Button>
              <button onClick={() => setBotWarningDismissed(true)} className="text-amber-600 hover:text-amber-800">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-sm border-b border-slate-100 dark:border-slate-800">
          <div className="max-w-2xl mx-auto px-4 py-4">
            <div className="text-center">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{project.formTitle}</h1>
              {project.formSubtitle && <p className="text-xs text-muted-foreground mt-0.5">{project.formSubtitle}</p>}
              {participant && (
                <p className="text-xs text-primary mt-1 font-medium">
                  {isAr ? `مرحباً ${participant.name}` : `Welcome, ${participant.name}`}
                  {canEdit && <span className="mr-2 text-amber-600 dark:text-amber-400">✏️ {isAr ? "وضع التعديل" : "Edit Mode"}</span>}
                </p>
              )}
            </div>

            {/* Step indicator */}
            {totalSteps > 1 && (
              <div className="flex items-center justify-center gap-1.5 mt-3 overflow-x-auto pb-0.5">
                {formSteps.map((stepLabel, i) => {
                  const Icon = STEP_ICONS[i] || User;
                  const done = step > i;
                  const cur = step === i;
                  return (
                    <button
                      key={i}
                      onClick={() => { if (done || cur) goToStep(i); }}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all",
                        cur ? "bg-primary text-white shadow-md" :
                          done ? "bg-primary/10 text-primary cursor-pointer" :
                            "bg-slate-100 dark:bg-slate-800 text-slate-400",
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      <span className="hidden sm:inline">{stepLabel}</span>
                      <span className="sm:hidden">{i + 1}</span>
                    </button>
                  );
                })}
                <div className={cn("flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all",
                  step === reviewStep ? "bg-primary text-white shadow-md" : "bg-slate-100 dark:bg-slate-800 text-slate-400")}>
                  <ClipboardCheck className="h-2.5 w-2.5" />
                  <span className="hidden sm:inline">{isAr ? "مراجعة" : "Review"}</span>
                  <span className="sm:hidden">{formSteps.length + 1}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Main content ─── */}
      <div style={{ paddingTop: headerH + 16 }} className="max-w-2xl mx-auto px-4 pb-20">
        <form onSubmit={onSubmitForm}>
          {step < reviewStep ? (
            <Card className="p-6 shadow-sm">
              <div className="grid grid-cols-2 gap-4">
                {getAllStepFields(step).map(f => {
                  if (!checkFieldVisible(f, formValues, fields)) return null;
                  return renderField(f);
                })}
              </div>
            </Card>
          ) : (
            /* Review step */
            <div className="space-y-4">
              <Card className="p-5">
                <h3 className="text-sm font-bold mb-4 text-slate-700 dark:text-slate-200">
                  {isAr ? "مراجعة البيانات" : "Review Your Data"}
                </h3>
                <div className="space-y-3">
                  {fields.filter(f => f.fieldType !== "heading" && f.isVisible).map(f => {
                    const v = formValues[f.key];
                    if (!v || String(v).trim() === "") return null;
                    return (
                      <div key={f.id} className="flex items-start gap-3 text-sm border-b border-slate-100 dark:border-slate-700 pb-2 last:border-0">
                        <span className="font-medium text-slate-500 dark:text-slate-400 min-w-[120px]">{f.label}:</span>
                        <span className="text-slate-800 dark:text-slate-100 break-all">{String(v)}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {errMsg && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                  ❌ {errMsg}
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={goPrev}
              disabled={step === 0}
              className={cn("gap-1", isAr ? "flex-row-reverse" : "")}
              data-testid="button-prev-step"
            >
              <ChevronRight className="h-4 w-4" />
              {isAr ? "السابق" : "Previous"}
            </Button>

            {step < reviewStep - 1 ? (
              <Button type="button" onClick={goNext} className="gap-1" data-testid="button-next-step">
                {isAr ? "التالي" : "Next"}
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : step === reviewStep - 1 ? (
              <Button type="submit" className="gap-1" data-testid="button-go-review">
                {isAr ? "مراجعة" : "Review"}
                <ClipboardCheck className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={isPending} className="gap-1 bg-primary" data-testid="button-submit">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : canEdit ? <Send className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                {canEdit ? (isAr ? "تحديث البيانات" : "Update Data") : (isAr ? "إرسال التسجيل" : "Submit Registration")}
              </Button>
            )}
          </div>
        </form>
      </div>

      <DesignerCredit />
    </div>
  );
}
