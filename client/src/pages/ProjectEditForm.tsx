import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import type { ProjectField, ProjectRecord } from "@shared/schema";

export function ProjectEditForm() {
  const { projectId, token } = useParams<{ projectId: string; token: string }>();
  const [saved, setSaved] = useState(false);
  const { lang } = useLang();
  const isAr = lang === "ar";

  const { data: record, isLoading, error } = useQuery<ProjectRecord & { error?: string }>({
    queryKey: ["/api/pform", projectId, "edit", token],
    queryFn: () => fetch(`/api/pform/${projectId}/edit/${token}`, { credentials: "include" }).then(r => r.json()),
    retry: false,
  });

  const { data: formInfo } = useQuery<{ project: any; fields: ProjectField[] }>({
    queryKey: ["/api/pform", projectId, "info"],
    queryFn: () => fetch(`/api/pform/${projectId}/info`).then(r => r.json()),
  });

  const fields = formInfo?.fields || [];
  const project = formInfo?.project;

  const { register, handleSubmit, reset, formState: { errors } } = useForm<Record<string, any>>();

  useEffect(() => {
    if (record && !record.error) {
      reset(record.data as Record<string, any>);
    }
  }, [record, reset]);

  const saveMut = useMutation({
    mutationFn: (formData: Record<string, any>) => fetch(`/api/pform/${projectId}/edit/${token}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify(formData),
    }).then(r => r.json()),
    onSuccess: (data) => { if (data.ok) setSaved(true); },
  });

  const grouped = fields.reduce<Record<number, ProjectField[]>>((acc, f) => {
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
                {stepFields.filter(f => f.fieldType !== "autoincrement").map(f => (
                  <div key={f.id} className="space-y-1.5">
                    <Label className="text-sm font-medium">
                      {f.label}{f.isRequired && <span className="text-red-500 mr-1">*</span>}
                    </Label>
                    {f.fieldType === "textarea" ? (
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
                    ) : (
                      <Input {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
                        type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : f.fieldType === "email" ? "email" : f.fieldType === "phone" ? "tel" : "text"}
                        placeholder={f.placeholder || ""}
                        data-testid={`input-${f.key}`} />
                    )}
                    {(errors as any)[f.key] && <p className="text-xs text-red-500">{(errors as any)[f.key]?.message}</p>}
                  </div>
                ))}
              </div>
            </Card>
          ))}

          <Button type="submit" className="w-full" disabled={saveMut.isPending} data-testid="button-save">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
            {isAr ? "حفظ التعديلات" : "Save Changes"}
          </Button>
        </form>
      </div>
    </div>
  );
}
