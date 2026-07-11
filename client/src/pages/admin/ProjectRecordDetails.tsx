import { useParams, useLocation } from "wouter";
import { fetchJson } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, Edit, Loader2, Clock, Printer, CheckCircle2, Circle,
  FileText, FolderSync, ExternalLink, HardDrive, AlertTriangle,
} from "lucide-react";
import type { ProjectRecord, ProjectField, ProjectAuditLog, Project } from "@shared/schema";
import { useLang } from "@/context/LanguageContext";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface DetailsResponse { record: ProjectRecord; auditLog: ProjectAuditLog[]; }

// Sync status display helpers
const SYNC_BADGE: Record<string, { icon: string; cls: string; label: string; labelEn: string }> = {
  local:       { icon: "🟡", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",   label: "محلي", labelEn: "Local" },
  syncing:     { icon: "🔄", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",       label: "جارٍ المزامنة", labelEn: "Syncing" },
  synced:      { icon: "✅", cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",   label: "مُزامَن", labelEn: "Synced" },
  sync_failed: { icon: "🔴", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",           label: "فشلت المزامنة", labelEn: "Sync Failed" },
};

export function ProjectRecordDetails() {
  const { id, recordId } = useParams<{ id: string; recordId: string }>();
  const [, nav] = useLocation();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const { toast } = useToast();
  const qc = useQueryClient();

  const [syncModal, setSyncModal] = useState(false);
  const [syncMode, setSyncMode] = useState<"keep_local" | "delete_local">("keep_local");

  const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
    "مكتمل":      { label: isAr ? "مكتمل" : "Completed",      cls: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    "منقوص":      { label: isAr ? "منقوص" : "Incomplete",      cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
    "مرفوض":      { label: isAr ? "مرفوض" : "Rejected",        cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    "قيد المراجعة": { label: isAr ? "قيد المراجعة" : "Under Review", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  };

  function getStatusStyle(val: string) {
    return STATUS_STYLES[val] || { label: val, cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" };
  }

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetchJson(`/api/projects/${id}`),
  });

  const { data, isLoading, refetch } = useQuery<DetailsResponse>({
    queryKey: ["/api/projects", id, "records", recordId],
    queryFn: () => fetchJson(`/api/projects/${id}/records/${recordId}`),
  });

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetchJson(`/api/projects/${id}/fields`),
  });

  const syncMut = useMutation({
    mutationFn: (mode: "keep_local" | "delete_local") =>
      apiRequest("POST", `/api/projects/${id}/records/${recordId}/sync-drive`, { mode }),
    onSuccess: (res: any) => {
      toast({ description: isAr ? `✅ تمت مزامنة ${res.synced} ملف` : `✅ Synced ${res.synced} file(s)` });
      setSyncModal(false);
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records", recordId] });
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "sync-stats"] });
    },
    onError: (err: any) => {
      toast({ variant: "destructive", description: err.message || (isAr ? "فشلت المزامنة" : "Sync failed") });
    },
  });

  const record = data?.record;
  const rdata = (record?.data || {}) as Record<string, any>;
  const driveFiles = (record?.driveFiles || {}) as Record<string, any>;
  const syncStatus = (record as any)?.syncStatus || "local";

  const steps: string[] = Array.isArray((project as any)?.steps) ? (project as any).steps : [];
  const fileFields = fields.filter(f => f.fieldType === "file" && rdata[f.key]);
  const hasLocalFiles = fileFields.some(f => String(rdata[f.key] || "").startsWith("/uploads/"));

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

  const syncBadgeInfo = SYNC_BADGE[syncStatus] || SYNC_BADGE.local;

  return (
    <Layout projectId={id}>
      <div className="max-w-3xl space-y-5 print:max-w-full">

        {/* ─── Header ─── */}
        <div className="flex items-center gap-3 print:hidden flex-wrap">
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
          {/* Sync status badge */}
          {fileFields.length > 0 && (
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${syncBadgeInfo.cls}`}>
              {syncBadgeInfo.icon} {isAr ? syncBadgeInfo.label : syncBadgeInfo.labelEn}
            </span>
          )}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print">
            <Printer className="h-4 w-4 ml-1" />
            {isAr ? "طباعة" : "Print"}
          </Button>
          <Button size="sm" onClick={() => nav(`/admin/projects/${id}/records/${recordId}/edit`)} data-testid="button-edit">
            <Edit className="h-4 w-4 ml-1" />
            {isAr ? "تعديل" : "Edit"}
          </Button>
        </div>

        {/* Print header */}
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
                            {f.fieldType === "file" && !isEmpty ? (
                              <a
                                href={String(val)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-medium text-primary hover:underline flex items-center gap-1.5"
                                data-testid={`link-file-${f.key}`}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0" />
                                {isAr ? "عرض الملف" : "View File"}
                              </a>
                            ) : (
                              <p className={`text-sm font-medium ${isEmpty ? "text-slate-300 dark:text-slate-600" : "text-slate-800 dark:text-slate-100"}`}>
                                {isEmpty ? "—" : String(val)}
                              </p>
                            )}
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

            {/* ─── Files & Drive Sync Card ─── */}
            {fileFields.length > 0 && (
              <Card className="p-5 print:hidden space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <HardDrive className="h-4 w-4" />
                    {isAr ? "الملفات المرفقة" : "Attached Files"}
                  </h3>
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${syncBadgeInfo.cls}`}>
                    {syncBadgeInfo.icon} {isAr ? syncBadgeInfo.label : syncBadgeInfo.labelEn}
                  </span>
                </div>

                <div className="space-y-2">
                  {fileFields.map(f => {
                    const val = String(rdata[f.key] || "");
                    const df = driveFiles[f.key] as any;
                    const isLocal = val.startsWith("/uploads/");
                    const isDrive = val.startsWith("https://drive.google.com") || df?.driveUrl;
                    const displayUrl = df?.driveUrl || val;
                    const originalName = df?.originalName || val.split("/").pop() || f.key;
                    const syncedAt = df?.syncedAt ? new Date(df.syncedAt).toLocaleString(isAr ? "ar-EG" : "en-US") : null;

                    return (
                      <div key={f.key} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                        <FileText className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground mb-0.5">{f.label}</p>
                          <p className="text-sm font-medium truncate">{decodeURIComponent(originalName)}</p>
                          {syncedAt && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {isAr ? `تمت المزامنة: ${syncedAt}` : `Synced: ${syncedAt}`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isLocal && (
                            <a href={val} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                                <ExternalLink className="h-3 w-3" />
                                {isAr ? "محلي" : "Local"}
                              </Button>
                            </a>
                          )}
                          {(isDrive || df?.driveUrl) && (
                            <a href={df?.driveUrl || displayUrl} target="_blank" rel="noopener noreferrer">
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-green-600 border-green-300">
                                <ExternalLink className="h-3 w-3" />
                                Drive
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Local files warning + sync button */}
                {hasLocalFiles && (
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                        {isAr ? "ملفات محفوظة مؤقتاً على الخادم" : "Files stored temporarily on server"}
                      </p>
                      <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                        {isAr ? "قد تُفقد عند تحديث المنصة. زامِن مع Drive لحفظها دائماً." : "May be lost on platform updates. Sync to Drive for permanent storage."}
                      </p>
                    </div>
                    <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={() => setSyncModal(true)}>
                      <FolderSync className="h-3 w-3" />
                      {isAr ? "مزامنة" : "Sync"}
                    </Button>
                  </div>
                )}

                {/* Sync modal */}
                {syncModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <Card className="w-full max-w-sm p-5 space-y-4" dir={isAr ? "rtl" : "ltr"}>
                      <div className="flex items-center gap-2">
                        <FolderSync className="h-5 w-5 text-primary" />
                        <h2 className="font-bold text-sm">{isAr ? "مزامنة ملفات السجل" : "Sync Record Files"}</h2>
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="radio" name="syncMode" value="keep_local" checked={syncMode === "keep_local"}
                            onChange={() => setSyncMode("keep_local")} className="mt-0.5 accent-primary" />
                          <div>
                            <p className="text-sm font-medium">{isAr ? "إبقاء النسخة المحلية + Drive" : "Keep local + Drive"}</p>
                            <p className="text-xs text-muted-foreground">{isAr ? "الملفات تبقى على الخادم وفي Drive" : "Files remain on server and in Drive"}</p>
                          </div>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="radio" name="syncMode" value="delete_local" checked={syncMode === "delete_local"}
                            onChange={() => setSyncMode("delete_local")} className="mt-0.5 accent-primary" />
                          <div>
                            <p className="text-sm font-medium">{isAr ? "حذف النسخة المحلية بعد المزامنة" : "Delete local after sync"}</p>
                            <p className="text-xs text-red-500">{isAr ? "⚠️ لا يمكن التراجع" : "⚠️ Irreversible"}</p>
                          </div>
                        </label>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => setSyncModal(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
                        <Button size="sm" disabled={syncMut.isPending} onClick={() => syncMut.mutate(syncMode)} className="gap-1">
                          {syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderSync className="h-3.5 w-3.5" />}
                          {isAr ? "بدء المزامنة" : "Start Sync"}
                        </Button>
                      </div>
                    </Card>
                  </div>
                )}
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
