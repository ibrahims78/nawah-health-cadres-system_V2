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
import { ArrowRight, Save, Loader2, Trash2 } from "lucide-react";
import type { ProjectRecord, ProjectField, Project } from "@shared/schema";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";

function FieldInput({ f, register, errors, watch }: {
  f: ProjectField;
  register: any;
  errors: any;
  watch: any;
}) {
  const { lang } = useLang();
  const isAr = lang === "ar";
  const opts = (f.options as string[] | null) || [];
  const val = watch(f.key);

  if (f.fieldType === "autoincrement") {
    const currentVal = watch(f.key);
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 text-sm text-slate-600 dark:text-slate-400 select-none">
        <span className="font-mono font-bold text-primary">{currentVal || "—"}</span>
        <span className="text-xs text-muted-foreground">({isAr ? "ترقيم تلقائي — للقراءة فقط" : "Auto number — read only"})</span>
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

  if (f.fieldType === "select" && opts.length > 0) {
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

export function ProjectRecordEdit() {
  const { id, recordId } = useParams<{ id: string; recordId: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data } = useQuery<{ record: ProjectRecord }>({
    queryKey: ["/api/projects", id, "records", recordId],
    queryFn: () => fetch(`/api/projects/${id}/records/${recordId}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
  });

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<Record<string, any>>();

  useEffect(() => {
    if (data?.record) {
      reset(data.record.data as Record<string, any>);
    }
  }, [data?.record, reset]);

  const steps: string[] = Array.isArray((project as any)?.steps) ? (project as any).steps : [];

  const saveMut = useMutation({
    mutationFn: (formData: Record<string, any>) =>
      apiRequest("PATCH", `/api/projects/${id}/records/${recordId}`, formData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records", recordId] });
      nav(`/admin/projects/${id}/records/${recordId}`);
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/projects/${id}/records/${recordId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      nav(`/admin/projects/${id}/records`);
    },
  });

  const grouped = fields.reduce<Record<number, ProjectField[]>>((acc, f) => {
    const s = f.stepNumber || 1;
    if (!acc[s]) acc[s] = [];
    acc[s].push(f);
    return acc;
  }, {});

  const stepNums = Object.keys(grouped).map(Number).sort();

  return (
    <Layout projectId={id}>
      <form onSubmit={handleSubmit(d => saveMut.mutate(d))} className="max-w-3xl space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => nav(`/admin/projects/${id}/records/${recordId}`)}
          >
            <ArrowRight className="h-4 w-4 ml-1" />
            {isAr ? "تفاصيل السجل" : "Record Details"}
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-lg font-bold">
            {isAr ? "تعديل السجل" : "Edit Record"}{" "}
            {data?.record?.sequentialNumber && (
              <span className="text-muted-foreground font-normal text-base">#{data.record.sequentialNumber}</span>
            )}
          </h1>
          <div className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => setDeleteOpen(true)}
            data-testid="button-delete"
          >
            <Trash2 className="h-4 w-4 ml-1" />
            {isAr ? "حذف" : "Delete"}
          </Button>
          <Button type="submit" size="sm" disabled={saveMut.isPending} data-testid="button-save">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
            {isAr ? "حفظ" : "Save"}
          </Button>
        </div>

        {saveMut.isError && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
            {(saveMut.error as any)?.message || (isAr ? "حدث خطأ أثناء الحفظ" : "An error occurred while saving")}
          </div>
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
                {stepFields.map(f => (
                  <div key={f.id} className={cn("space-y-1.5", f.fieldType === "textarea" && "md:col-span-2")}>
                    <Label className="text-xs font-medium">
                      {f.label}
                      {f.isRequired && <span className="text-red-500 mr-1">*</span>}
                    </Label>
                    <FieldInput f={f} register={register} errors={errors} watch={watch} />
                    {(errors as any)[f.key] && (
                      <p className="text-xs text-red-500">{(errors as any)[f.key]?.message}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}

        {fields.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground text-sm">
            {isAr ? "لا يوجد حقول محددة لهذا المشروع" : "No fields defined for this project"}
          </Card>
        )}

        {stepNums.length > 0 && (
          <div className="flex gap-2">
            <Button type="submit" disabled={saveMut.isPending} className="flex-1" data-testid="button-save-bottom">
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
              {saveMut.isPending ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "حفظ التعديلات" : "Save Changes")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => nav(`/admin/projects/${id}/records/${recordId}`)}
            >
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
          </div>
        )}
      </form>

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isAr ? "تأكيد الحذف" : "Delete Record"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {isAr
              ? `هل أنت متأكد من حذف السجل #${data?.record?.sequentialNumber}؟ لا يمكن التراجع عن هذا الإجراء.`
              : `Are you sure you want to delete record #${data?.record?.sequentialNumber}? This action cannot be undone.`}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} data-testid="button-cancel-delete">
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setDeleting(true);
                try { await deleteMut.mutateAsync(); }
                finally { setDeleting(false); setDeleteOpen(false); }
              }}
              disabled={deleting}
              data-testid="button-confirm-delete"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Trash2 className="h-4 w-4 ml-1" />}
              {isAr ? "حذف" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
