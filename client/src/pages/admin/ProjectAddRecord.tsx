import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { ArrowRight, Plus, Loader2, CheckCircle2 } from "lucide-react";
import type { ProjectField, Project } from "@shared/schema";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useLang } from "@/context/LanguageContext";
import { FileField } from "@/components/FileField";

function FieldInput({ f, register, errors, watch, setValue, projectId }: {
  f: ProjectField;
  register: any;
  errors: any;
  watch: any;
  setValue: any;
  projectId: string;
}) {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const opts = (f.options as string[] | null) || [];
  const val = watch(f.key);

  if (f.fieldType === "autoincrement") {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-sm text-muted-foreground select-none">
        <span className="font-mono text-xs bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">123</span>
        {isAr ? "يُملأ تلقائياً عند الحفظ" : "Auto-filled on save"}
      </div>
    );
  }

  if (f.fieldType === "textarea") {
    return (
      <Textarea
        {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
        placeholder={f.placeholder || ""}
        rows={3}
        className="text-sm"
        data-testid={`input-${f.key}`}
      />
    );
  }

  if ((f.fieldType === "select") && opts.length > 0) {
    return (
      <select
        {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
        className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        data-testid={`select-${f.key}`}
      >
        <option value="">{isAr ? "— اختر —" : "— Select —"}</option>
        {opts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }

  if (f.fieldType === "radio" && opts.length > 0) {
    return (
      <div className="flex flex-wrap gap-2">
        {opts.map(opt => (
          <label
            key={opt}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition-all",
              val === opt
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-slate-200 dark:border-slate-700 hover:border-primary/50"
            )}
          >
            <input
              type="radio"
              {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
              value={opt}
              className="accent-primary"
              data-testid={`radio-${f.key}-${opt}`}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (f.fieldType === "checkbox") {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          {...register(f.key)}
          className="accent-primary w-4 h-4 rounded"
          data-testid={`checkbox-${f.key}`}
        />
        <span className="text-sm">{f.placeholder || f.label}</span>
      </label>
    );
  }

  if (f.fieldType === "file") {
    return (
      <>
        <input type="hidden" {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })} />
        <FileField
          value={val}
          onChange={url => setValue(f.key, url, { shouldValidate: true })}
          uploadUrl={`/api/projects/${projectId}/upload`}
          fieldKey={f.key}
        />
      </>
    );
  }

  return (
    <Input
      {...register(f.key, { required: f.isRequired ? (isAr ? `${f.label} مطلوب` : `${f.label} is required`) : false })}
      type={
        f.fieldType === "number" ? "number"
        : f.fieldType === "date" ? "date"
        : f.fieldType === "email" ? "email"
        : f.fieldType === "phone" ? "tel"
        : "text"
      }
      placeholder={f.placeholder || ""}
      className="text-sm"
      data-testid={`input-${f.key}`}
    />
  );
}

export function ProjectAddRecord() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const [success, setSuccess] = useState(false);

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<Record<string, any>>();

  const steps: string[] = Array.isArray((project as any)?.steps) ? (project as any).steps : [];

  const addMut = useMutation({
    mutationFn: (formData: Record<string, any>) => apiRequest("POST", `/api/projects/${id}/records`, formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "stats"] });
      setSuccess(true);
      reset();
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  const watchedValues = watch();

  const isFieldVisible = (f: ProjectField) => {
    const cf = (f as any).conditionField as string | null | undefined;
    const cv = (f as any).conditionValue as string | null | undefined;
    if (!cf) return true;
    const triggerVal = watchedValues[cf];
    if (cv === null || cv === undefined || cv === "") {
      return triggerVal !== "" && triggerVal !== null && triggerVal !== undefined;
    }
    return String(triggerVal ?? "") === cv;
  };

  const grouped = fields.reduce<Record<number, ProjectField[]>>((acc, f) => {
    const s = f.stepNumber || 1;
    if (!acc[s]) acc[s] = [];
    acc[s].push(f);
    return acc;
  }, {});

  const stepNums = Object.keys(grouped).map(Number).sort();

  return (
    <Layout projectId={id}>
      <form onSubmit={handleSubmit(d => addMut.mutate(d))} className="max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => nav(`/admin/projects/${id}/records`)}>
            <ArrowRight className="h-4 w-4 ml-1" />
            {isAr ? "السجلات" : "Records"}
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-lg font-bold">{isAr ? "إضافة سجل جديد" : "Add New Record"}</h1>
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleSubmit(d => addMut.mutate(d))}
            disabled={addMut.isPending}
            data-testid="button-submit-and-another"
            className="hidden sm:flex"
          >
            {isAr ? "إضافة وجديد" : "Add & New"}
          </Button>
          <Button type="submit" size="sm" disabled={addMut.isPending} data-testid="button-submit">
            {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Plus className="h-4 w-4 ml-1" />}
            {isAr ? "إضافة" : "Add"}
          </Button>
        </div>

        {success && (
          <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm flex items-center gap-2" data-testid="alert-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {isAr ? "تم إضافة السجل بنجاح" : "Record added successfully"}
          </div>
        )}

        {addMut.isError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            {(addMut.error as any)?.message || (isAr ? "حدث خطأ أثناء الإضافة" : "An error occurred while adding the record")}
          </div>
        )}

        {stepNums.length === 0 && fields.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground text-sm">
            {isAr ? <>لا يوجد حقول. أضف حقولاً من{" "}<button type="button" className="text-primary underline" onClick={() => nav(`/admin/projects/${id}/settings`)}>إعدادات المشروع</button>{" "}أولاً.</> : <>No fields found. Add fields from{" "}<button type="button" className="text-primary underline" onClick={() => nav(`/admin/projects/${id}/settings`)}>Project Settings</button>{" "}first.</>}
          </Card>
        )}

        {stepNums.map(s => {
          const stepFields = grouped[s] || [];
          const stepName = steps[s - 1] || (isAr ? `الخطوة ${s}` : `Step ${s}`);
          return (
            <Card key={s} className="p-5">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 pb-2 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
                <span className="inline-flex w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold items-center justify-center">{s}</span>
                {stepName}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stepFields.filter(isFieldVisible).map(f => (
                  <div key={f.id} className={cn("space-y-1.5", f.fieldType === "textarea" && "md:col-span-2")}>
                    <Label className="text-xs font-medium">
                      {f.label}
                      {f.isRequired && <span className="text-red-500 mr-1">*</span>}
                    </Label>
                    <FieldInput f={f} register={register} errors={errors} watch={watch} setValue={setValue} projectId={id!} />
                    {(errors as any)[f.key] && (
                      <p className="text-xs text-red-500">{(errors as any)[f.key]?.message}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}

        {stepNums.length > 0 && (
          <div className="flex gap-2">
            <Button type="submit" disabled={addMut.isPending} className="flex-1" data-testid="button-submit-bottom">
              {addMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Plus className="h-4 w-4 ml-1" />}
              {addMut.isPending ? (isAr ? "جاري الإضافة..." : "Adding...") : (isAr ? "إضافة السجل" : "Add Record")}
            </Button>
            <Button type="button" variant="outline" onClick={() => nav(`/admin/projects/${id}/records`)}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
          </div>
        )}
      </form>
    </Layout>
  );
}
