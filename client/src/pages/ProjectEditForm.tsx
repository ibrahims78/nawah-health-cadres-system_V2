import { useParams } from "wouter";
import { fetchJson } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { DesignerCredit } from "@/components/DesignerCredit";
import type { ProjectField, ProjectRecord } from "@shared/schema";
import { isFieldVisible as checkFieldVisible } from "@/lib/fieldVisibility";
import { FileField } from "@/components/FileField";

export function ProjectEditForm() {
  const { projectId, token } = useParams<{ projectId: string; token: string }>();
  const [saved, setSaved] = useState(false);
  const { lang } = useLang();
  const isAr = lang === "ar";

  const { data: record, isLoading, error } = useQuery<ProjectRecord & { error?: string }>({
    queryKey: ["/api/pform", projectId, "edit", token],
    queryFn: () => fetchJson(`/api/pform/${projectId}/edit/${token}`),
    retry: false,
  });

  const { data: formInfo } = useQuery<{ project: any; fields: ProjectField[] }>({
    queryKey: ["/api/pform", projectId, "info"],
    queryFn: () => fetchJson(`/api/pform/${projectId}/info`),
  });

  const fields = formInfo?.fields || [];
  const project = formInfo?.project;

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<Record<string, any>>({ mode: "onBlur" });

  useEffect(() => {
    if (record && !record.error) {
      reset(record.data as Record<string, any>);
    }
  }, [record, reset]);

  const saveMut = useMutation({
    mutationFn: (formData: Record<string, any>) => fetch(`/api/pform/${projectId}/edit/${token}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(formData),
    }),
    onSuccess: (data) => { if (data.ok) setSaved(true); },
  });

  const watchedValues = watch();

  const isFieldVisible = (f: ProjectField) => checkFieldVisible(f as any, watchedValues);

  // إصلاح: مسح قيمة الحقل عند إخفائه بسبب شرط غير متحقق — يمنع إرسال قيمة قديمة
  // لحقل لم يعد المستخدم يراه.
  useEffect(() => {
    for (const f of fields) {
      if (f.fieldType === "heading" || f.fieldType === "autoincrement") continue;
      if (!checkFieldVisible(f as any, watchedValues) && watchedValues[f.key] !== undefined && watchedValues[f.key] !== "") {
        setValue(f.key, "");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(watchedValues), fields]);

  const grouped = fields
    .filter(f => f.fieldType !== "autoincrement")
    .reduce<Record<number, ProjectField[]>>((acc, f) => {
      const s = f.stepNumber || 1;
      if (!acc[s]) acc[s] = [];
      acc[s].push(f);
      return acc;
    }, {});

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if ((record as any)?.error || error) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <Card className="p-8 max-w-sm w-full text-center space-y-3">
        <AlertCircle className="h-12 w-12 text-red-400 mx-auto" />
        <h2 className="font-bold text-slate-800">{(record as any)?.error || (isAr ? "الرابط غير صالح" : "Invalid link")}</h2>
      </Card>
    </div>
  );

  if (saved) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 p-4">
      <Card className="p-8 max-w-sm w-full text-center space-y-4">
        <CheckCircle className="h-14 w-14 text-green-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-800">{isAr ? "تم حفظ التعديلات بنجاح!" : "Changes saved successfully!"}</h2>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 py-8 px-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="max-w-xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{project?.formTitle || (isAr ? "تعديل البيانات" : "Edit Data")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{isAr ? "يمكنك تعديل بياناتك أدناه" : "You can edit your data below"}</p>
        </div>

        <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="space-y-5">
          {Object.entries(grouped).map(([step, stepFields]) => (
            <Card key={step} className="p-5">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 pb-2 border-b border-slate-100 dark:border-slate-700">
                {Array.isArray(project?.steps) ? (project.steps[Number(step) - 1] || (isAr ? `الخطوة ${step}` : `Step ${step}`)) : (isAr ? `الخطوة ${step}` : `Step ${step}`)}
              </h3>
              <div className="space-y-4">
                {stepFields.filter(f => f.fieldType !== "autoincrement" && isFieldVisible(f)).map(f => {
                  // heading fields render as static instructional text — no input
                  if (f.fieldType === "heading") {
                    return (
                      <div key={f.id} className="pt-2">
                        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 border-r-4 border-primary pr-3 py-1">
                          {f.label}
                        </p>
                        {f.placeholder && (
                          <p className="text-xs text-muted-foreground mt-1 pr-4">{f.placeholder}</p>
                        )}
                      </div>
                    );
                  }
                  return (
                  <div key={f.id} className={`space-y-1.5${((f as any).isFullWidth || f.fieldType === "textarea" || f.fieldType === "file" || f.fieldType === "checkbox") ? " col-span-2" : ""}`}>
                    <Label className="text-sm font-medium">
                      {f.label}{f.isRequired && <span className="text-red-500 mr-1">*</span>}
                    </Label>
                    {(f as any).isReadOnly ? (
                      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-600 dark:text-slate-400 select-none">
                        <input type="hidden" {...register(f.key)} />
                        <span className="font-medium">{watchedValues[f.key] || "—"}</span>
                        <span className="text-xs text-muted-foreground">({isAr ? "للقراءة فقط" : "read only"})</span>
                      </div>
                    ) : f.fieldType === "textarea" ? (
                      <Textarea {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
                        placeholder={f.placeholder || ""} rows={3} data-testid={`input-${f.key}`} />
                    ) : f.fieldType === "select" && f.options ? (
                      <select {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
                        className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        data-testid={`select-${f.key}`}>
                        <option value="">{isAr ? "— اختر —" : "— Select —"}</option>
                        {(f.options as string[]).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : f.fieldType === "radio" && f.options ? (
                      <div className="space-y-2">
                        {(f.options as string[]).map(opt => (
                          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="radio" {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })} value={opt} className="accent-primary" />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : f.fieldType === "checkbox" ? (
                      <label className="flex items-center gap-2 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
                          className="accent-primary w-4 h-4 rounded"
                          data-testid={`checkbox-${f.key}`}
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-300">{f.placeholder || ""}</span>
                      </label>
                    ) : f.fieldType === "file" ? (
                      <>
                        <input type="hidden" {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })} />
                        <FileField
                          value={watchedValues[f.key]}
                          onChange={url => setValue(f.key, url, { shouldValidate: true })}
                          uploadUrl={`/api/pform/${projectId}/upload`}
                          fieldKey={f.key}
                          uploadFolder={token}
                          authSuffix={`?token=${token}&project=${projectId}`}
                        />
                      </>
                    ) : (
                      <Input {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
                        type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : f.fieldType === "email" ? "email" : f.fieldType === "phone" ? "tel" : "text"}
                        placeholder={f.placeholder || ""}
                        data-testid={`input-${f.key}`} />
                    )}
                    {(errors as any)[f.key] && <p className="text-xs text-red-500">{(errors as any)[f.key]?.message}</p>}
                  </div>
                  );
                })}
              </div>
            </Card>
          ))}

          <Button type="submit" className="w-full" disabled={saveMut.isPending} data-testid="button-save">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
            {isAr ? "حفظ التعديلات" : "Save Changes"}
          </Button>
        </form>
        <DesignerCredit />
      </div>
    </div>
  );
}
