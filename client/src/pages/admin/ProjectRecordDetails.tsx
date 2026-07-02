import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Edit, Loader2, Clock, Printer, CheckCircle2, Circle } from "lucide-react";
import type { ProjectRecord, ProjectField, ProjectAuditLog, Project } from "@shared/schema";
import { useLang } from "@/context/LanguageContext";

interface DetailsResponse { record: ProjectRecord; auditLog: ProjectAuditLog[]; }

export function ProjectRecordDetails() {
  const { id, recordId } = useParams<{ id: string; recordId: string }>();
  const [, nav] = useLocation();
  const { lang } = useLang();
  const isAr = lang === "ar";

  const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
    "مكتمل":      { label: isAr ? "مكتمل" : "Completed",      cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    "منقوص":      { label: isAr ? "منقوص" : "Incomplete",      cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
    "مرفوض":      { label: isAr ? "مرفوض" : "Rejected",      cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    "قيد المراجعة": { label: isAr ? "قيد المراجعة" : "Under Review", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  };

  function getStatusStyle(val: string) {
    return STATUS_STYLES[val] || { label: val, cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  }

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data, isLoading } = useQuery<DetailsResponse>({
    queryKey: ["/api/projects", id, "records", recordId],
    queryFn: () => fetch(`/api/projects/${id}/records/${recordId}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
  });

  const record = data?.record;
  const rdata = (record?.data || {}) as Record<string, any>;

  const steps: string[] = Array.isArray((project as any)?.steps) ? (project as any).steps : [];

  const grouped = fields.reduce<Record<number, ProjectField[]>>((acc, f) => {
    const s = f.stepNumber || 1;
    if (!acc[s]) acc[s] = [];
    acc[s].push(f);
    return acc;
  }, {});

  const statusField = fields.find(f =>
    f.key === "status" || f.label === "الحالة" || f.key === "recordStatus"
  );
  const statusValue = statusField ? rdata[statusField.key] : null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <Layout projectId={id}>
      <div className="max-w-3xl space-y-5 print:max-w-full">

        {/* ─── Header ─── */}
        <div className="flex items-center gap-3 print:hidden">
          <Button variant="ghost" size="sm" onClick={() => nav(`/admin/projects/${id}/records`)}>
            <ArrowRight className="h-4 w-4 ml-1" />
            {isAr ? "السجلات" : "Records"}
          </Button>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {isAr ? "تفاصيل السجل" : "Record Details"} #{record?.sequentialNumber}
          </h1>
          {statusValue && (
            <Badge className={`text-xs px-2 py-0.5 ${getStatusStyle(String(statusValue)).cls}`}>
              {getStatusStyle(String(statusValue)).label}
            </Badge>
          )}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print">
            <Printer className="h-4 w-4 ml-1" />
            {isAr ? "طباعة" : "Print"}
          </Button>
          <Button size="sm" onClick={() => nav(`/admin/projects/${id}/records/${recordId}/edit`)} data-testid="button-edit">
            <Edit className="h-4 w-4 ml-1" />
            {isAr ? "تعديل" : "Edit"}
          </Button>
        </div>

        {/* Print header (only visible when printing) */}
        <div className="hidden print:block mb-6">
          <h1 className="text-xl font-bold">{project?.name || (isAr ? "بيانات التسجيل" : "Registration Data")}</h1>
          <p className="text-sm text-gray-500">{isAr ? "السجل" : "Record"} #{record?.sequentialNumber} — {record?.submittedAt ? new Date(record.submittedAt).toLocaleDateString(isAr ? "ar-EG" : "en-US") : ""}</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20 print:hidden">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : record ? (
          <>
            {/* ─── Submission Meta ─── */}
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground bg-slate-50 dark:bg-slate-800/50 rounded-lg px-4 py-3">
              <span>📅 {isAr ? "تاريخ التسجيل:" : "Submission Date:"} <span className="font-medium text-slate-700 dark:text-slate-300">{record.submittedAt ? new Date(record.submittedAt).toLocaleString(isAr ? "ar-EG" : "en-US") : "—"}</span></span>
              {record.updatedAt && <span>✏️ {isAr ? "آخر تحديث:" : "Last Update:"} <span className="font-medium text-slate-700 dark:text-slate-300">{new Date(record.updatedAt).toLocaleString(isAr ? "ar-EG" : "en-US")}</span></span>}
            </div>

            {/* ─── Stepped Cards ─── */}
            {Object.keys(grouped).length > 0 ? (
              Object.entries(grouped).sort(([a], [b]) => Number(a) - Number(b)).map(([stepStr, stepFields]) => {
                const stepNum = Number(stepStr);
                const stepName = steps[stepNum - 1] || (isAr ? `الخطوة ${stepNum}` : `Step ${stepNum}`);
                return (
                  <Card key={stepStr} className="p-5 print:shadow-none print:border">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4 pb-2 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
                      <span className="inline-flex w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold items-center justify-center">{stepNum}</span>
                      {stepName}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {stepFields.map(f => {
                        const val = rdata[f.key];
                        const isEmpty = val == null || String(val).trim() === "";
                        return (
                          <div key={f.id} className="space-y-0.5">
                            <p className="text-[11px] text-muted-foreground font-medium">{f.label}</p>
                            <p className={`text-sm font-medium ${isEmpty ? "text-slate-300 dark:text-slate-600" : "text-slate-800 dark:text-slate-100"}`}>
                              {isEmpty ? "—" : String(val)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                );
              })
            ) : (
              <Card className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(rdata).map(([key, val]) => {
                    const field = fields.find(f => f.key === key);
                    return (
                      <div key={key} className="space-y-0.5">
                        <p className="text-[11px] text-muted-foreground font-medium">{field?.label || key}</p>
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{String(val ?? "—")}</p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* ─── Audit Log ─── */}
            {data?.auditLog && data.auditLog.length > 0 && (
              <Card className="p-5 print:hidden">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {isAr ? "سجل التعديلات" : "Audit Log"}
                </h3>
                <div className="space-y-0">
                  {data.auditLog.map((log, idx) => (
                    <div key={log.id} className="flex items-start gap-3 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
                      <div className="mt-0.5 shrink-0">
                        {log.action === "create"
                          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                          : <Circle className="h-4 w-4 text-blue-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {log.action === "create" ? (isAr ? "تم الإنشاء" : "Created") : (isAr ? "تم التحديث" : "Updated")}
                          {log.changedBy && <span className="text-muted-foreground font-normal"> — {isAr ? "بواسطة" : "by"} {log.changedBy}</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {log.changedAt ? new Date(log.changedAt).toLocaleString(isAr ? "ar-EG" : "en-US") : "—"}
                        </p>
                      </div>
                      <Badge variant={log.action === "create" ? "default" : "secondary"} className="text-[10px] shrink-0">
                        #{data.auditLog.length - idx}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        ) : (
          <Card className="p-10 text-center text-muted-foreground">{isAr ? "السجل غير موجود" : "Record not found"}</Card>
        )}
      </div>
    </Layout>
  );
}
