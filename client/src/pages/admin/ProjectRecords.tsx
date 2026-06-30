import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Search, Trash2, Eye, Edit, Loader2,
  ChevronRight, ChevronLeft, Users, Copy, Check,
  Columns3, X, ChevronsLeft, ChevronsRight,
  Printer, Filter, RefreshCw, SkipForward,
  Link, Upload, Wrench,
} from "lucide-react";
import type { ProjectRecord, ProjectField } from "@shared/schema";
import { cn } from "@/lib/utils";

interface RecordsResponse { data: ProjectRecord[]; total: number; page: number; limit: number; }

function highlight(text: string, term: string) {
  if (!term || !text) return <>{text}</>;
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${safe})`, "gi"));
  return <>{parts.map((p, i) =>
    parts.length > 1 && i % 2 === 1
      ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/70 rounded-sm px-0.5">{p}</mark>
      : p
  )}</>;
}

function getPaginationPages(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push("…");
  if (total > 1) pages.push(total);
  return pages;
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <dt className="text-xs text-muted-foreground min-w-36 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-slate-800 dark:text-slate-200 break-words">
        {value != null && value !== ""
          ? String(value)
          : <span className="text-slate-300 dark:text-slate-600">—</span>}
      </dd>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  "مكتمل":          "bg-green-500",
  "منقوص":          "bg-yellow-400",
  "مرفوض":          "bg-red-500",
  "قيد المراجعة":   "bg-blue-500",
  "نشط":            "bg-emerald-500",
  "غير نشط":        "bg-slate-400",
};

function getStatusColor(val: string): string {
  return STATUS_COLORS[val] || "bg-slate-300 dark:bg-slate-600";
}

export function ProjectRecords() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewRecord, setViewRecord] = useState<ProjectRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [jumpPage, setJumpPage] = useState("");
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({});
  const [visibleColKeys, setVisibleColKeys] = useState<string[] | null>(null);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [syncDeleted, setSyncDeleted] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string; added?: number; updated?: number; skipped?: number } | null>(null);

  // Fix headers state
  const [fixingHeaders, setFixingHeaders] = useState(false);
  const [fixResult, setFixResult] = useState<string | null>(null);

  // Copy link
  const [copiedLink, setCopiedLink] = useState(false);

  const { data: project } = useQuery<{ id: string; name: string; formEnabled?: boolean; [k: string]: any }>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
  });

  const visibleFields = useMemo(() => fields.filter(f => f.isVisible !== false), [fields]);
  const defaultCols = useMemo(() => visibleFields.slice(0, 5).map(f => f.key), [visibleFields]);
  const activeCols = useMemo(() => visibleColKeys ?? defaultCols, [visibleColKeys, defaultCols]);
  const colFields = useMemo(() => visibleFields.filter(f => activeCols.includes(f.key)), [visibleFields, activeCols]);

  const statusField = useMemo(() =>
    fields.find(f => f.key === "status" || f.label === "الحالة" || f.key === "recordStatus"),
    [fields]
  );

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (debouncedSearch) p.set("search", debouncedSearch);
    Object.entries(fieldFilters).forEach(([k, v]) => { if (v) p.set(`filter_${k}`, v); });
    return p;
  }, [page, limit, debouncedSearch, fieldFilters]);

  const { data, isLoading, refetch } = useQuery<RecordsResponse>({
    queryKey: ["/api/projects", id, "records", params.toString()],
    queryFn: () => fetch(`/api/projects/${id}/records?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const deleteMut = useMutation({
    mutationFn: (recordId: string) => apiRequest("DELETE", `/api/projects/${id}/records/${recordId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      setDeleteId(null);
    },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", `/api/projects/${id}/records/bulk-delete`, { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      setSelected(new Set());
    },
  });

  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const startRow = total ? (page - 1) * limit + 1 : 0;
  const endRow = total ? Math.min(page * limit, total) : 0;

  const toggleSelect = useCallback((rid: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(rid) ? s.delete(rid) : s.add(rid);
      return s;
    });
  }, []);

  const toggleAll = () => {
    if (!data?.data) return;
    setSelected(selected.size === data.data.length ? new Set() : new Set(data.data.map(r => r.id)));
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyFormLink = () => {
    const url = `${window.location.origin}/p/${id}/register`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const doImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const res: any = await apiRequest("POST", `/api/projects/${id}/import-from-sheets`, { syncDeleted });
      setImportResult(res);
      if (res.ok) qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
    } catch (err: any) {
      setImportResult({ ok: false, message: err.message });
    } finally {
      setImporting(false);
    }
  };

  const doFixHeaders = async () => {
    setFixingHeaders(true);
    setFixResult(null);
    try {
      const res: any = await apiRequest("POST", `/api/projects/${id}/fix-sheet-headers`, {});
      setFixResult(res.message);
    } catch (err: any) {
      setFixResult(`❌ ${err.message}`);
    } finally {
      setFixingHeaders(false);
    }
  };

  const goPage = (p: number) => setPage(Math.max(1, Math.min(p, totalPages)));
  const activeFilterCount = Object.values(fieldFilters).filter(Boolean).length;

  const filterableFields = useMemo(() =>
    visibleFields.filter(f =>
      f.fieldType === "select" || f.fieldType === "radio" ||
      (Array.isArray(f.options) && (f.options as string[]).length > 0)
    ),
    [visibleFields]
  );

  return (
    <Layout projectId={id}>
      <div className="space-y-4">

        {/* ─── Header ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100">السجلات</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {isLoading ? "جاري التحميل..." : `الإجمالي: ${total.toLocaleString("ar-SY")} سجل`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              <Button variant="destructive" size="sm"
                onClick={() => { if (confirm(`حذف ${selected.size} سجل؟`)) bulkDeleteMut.mutate([...selected]); }}
                disabled={bulkDeleteMut.isPending} data-testid="button-bulk-delete">
                {bulkDeleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Trash2 className="h-4 w-4 ml-1" />}
                حذف {selected.size} محدد
              </Button>
            )}

            {/* Fix sheet headers */}
            <Button variant="outline" size="sm" onClick={doFixHeaders} disabled={fixingHeaders} title="تصحيح ترويسات الـ Sheet" data-testid="button-fix-headers">
              {fixingHeaders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            </Button>

            {/* Import from Sheets */}
            <Button variant="outline" size="sm" onClick={() => { setImportOpen(true); setImportResult(null); }} data-testid="button-import-sheets">
              <Upload className="h-4 w-4 ml-1" />
              استيراد Sheets
            </Button>

            {/* Copy form link */}
            <Button variant="outline" size="sm" onClick={copyFormLink} data-testid="button-copy-link">
              {copiedLink ? <Check className="h-4 w-4 ml-1 text-green-500" /> : <Link className="h-4 w-4 ml-1" />}
              {copiedLink ? "تم النسخ!" : "نسخ رابط النموذج"}
            </Button>

            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => nav(`/admin/projects/${id}/records/new`)} data-testid="button-add-record">
              <Plus className="h-4 w-4 ml-1" />إضافة سجل
            </Button>
          </div>
        </div>

        {/* Fix headers result */}
        {fixResult && (
          <div className={`text-xs p-2 rounded-lg border flex items-center gap-2 ${fixResult.startsWith("✅") ? "bg-green-50 dark:bg-green-900/20 border-green-200 text-green-700" : "bg-red-50 dark:bg-red-900/20 border-red-200 text-red-700"}`}>
            {fixResult}
            <button onClick={() => setFixResult(null)} className="mr-auto hover:opacity-70"><X className="h-3 w-3" /></button>
          </div>
        )}

        {/* ─── Search + Controls ─── */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في جميع الحقول..." className="pr-9" data-testid="input-search" />
            {search && (
              <button onClick={() => { setSearch(""); setDebouncedSearch(""); }} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {filterableFields.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setFilterOpen(v => !v)} data-testid="button-filters"
              className={cn(activeFilterCount > 0 && "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400")}>
              <Filter className="h-4 w-4 ml-1" />
              فلتر
              {activeFilterCount > 0 && <Badge variant="secondary" className="mr-1.5 h-4 px-1 text-[10px]">{activeFilterCount}</Badge>}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => setColPickerOpen(v => !v)} data-testid="button-columns">
            <Columns3 className="h-4 w-4 ml-1" />الأعمدة
          </Button>

          {/* Limit buttons */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            {[10, 25, 50, 100].map(n => (
              <button
                key={n}
                onClick={() => { setLimit(n); setPage(1); }}
                className={`px-2 py-1 rounded text-xs font-medium transition-all ${limit === n ? "bg-white dark:bg-slate-700 shadow-sm text-primary" : "text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300"}`}
                data-testid={`limit-${n}`}
              >{n}</button>
            ))}
          </div>
        </div>

        {/* ─── Active filter chips ─── */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">الفلاتر:</span>
            {Object.entries(fieldFilters).filter(([, v]) => v).map(([k, v]) => {
              const field = fields.find(f => f.key === k);
              return (
                <Badge key={k} variant="secondary" className="gap-1 pl-1">
                  {field?.label || k}: {v}
                  <button onClick={() => setFieldFilters(p => ({ ...p, [k]: "" }))} className="hover:text-red-500">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            <button onClick={() => setFieldFilters({})} className="text-xs text-red-500 hover:underline">مسح الكل</button>
          </div>
        )}

        {/* ─── Filter Panel ─── */}
        {filterOpen && filterableFields.length > 0 && (
          <Card className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filterableFields.map(f => {
                const opts = (f.options as string[] | null) || [];
                return (
                  <div key={f.key} className="space-y-1">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400">{f.label}</label>
                    {opts.length > 0 ? (
                      <select value={fieldFilters[f.key] || ""} onChange={e => { setFieldFilters(p => ({ ...p, [f.key]: e.target.value })); setPage(1); }}
                        className="w-full h-8 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-xs" data-testid={`filter-${f.key}`}>
                        <option value="">الكل</option>
                        {opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <Input value={fieldFilters[f.key] || ""} onChange={e => { setFieldFilters(p => ({ ...p, [f.key]: e.target.value })); setPage(1); }} className="h-8 text-xs" data-testid={`filter-${f.key}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* ─── Column Picker ─── */}
        {colPickerOpen && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">اختر الأعمدة المعروضة ({activeCols.length}/{visibleFields.length})</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setVisibleColKeys(visibleFields.map(f => f.key))}>تحديد الكل</Button>
                <Button size="sm" variant="outline" onClick={() => setVisibleColKeys(null)}>الافتراضي</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {visibleFields.map(f => {
                const checked = activeCols.includes(f.key);
                return (
                  <label key={f.key} className="flex items-center gap-2 text-xs cursor-pointer hover:text-primary select-none">
                    <input type="checkbox" checked={checked}
                      onChange={() => {
                        setVisibleColKeys(prev => {
                          const cur = prev ?? defaultCols;
                          return checked ? cur.filter(k => k !== f.key) : [...cur, f.key];
                        });
                      }}
                      className="accent-primary" data-testid={`col-toggle-${f.key}`} />
                    {f.label}
                  </label>
                );
              })}
            </div>
          </Card>
        )}

        {/* ─── Table ─── */}
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : !data?.data?.length ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">لا توجد سجلات{search && " مطابقة للبحث"}</p>
              <Button size="sm" className="mt-4" onClick={() => nav(`/admin/projects/${id}/records/new`)}>
                <Plus className="h-4 w-4 ml-1" /> إضافة أول سجل
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox" checked={selected.size === data.data.length && data.data.length > 0} onChange={toggleAll} className="rounded" data-testid="checkbox-select-all" />
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold text-xs text-muted-foreground">#</th>
                    {statusField && <th className="px-1 py-2.5 w-2" />}
                    {colFields.map(f => (
                      <th key={f.id} className="px-3 py-2.5 text-right font-semibold text-xs text-muted-foreground whitespace-nowrap">{f.label}</th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-semibold text-xs text-muted-foreground whitespace-nowrap">التاريخ</th>
                    <th className="px-3 py-2.5 w-28" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {data.data.map(record => {
                    const rdata = record.data as Record<string, any>;
                    const statusVal = statusField ? String(rdata[statusField.key] || "") : "";
                    return (
                      <tr key={record.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors group" data-testid={`row-record-${record.id}`}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelect(record.id)} className="rounded" />
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{record.sequentialNumber}</td>
                        {statusField && (
                          <td className="px-1 py-2.5">
                            <div className={`w-1.5 h-8 rounded-full ${getStatusColor(statusVal)}`} title={statusVal} />
                          </td>
                        )}
                        {colFields.map(f => {
                          const val = rdata[f.key];
                          const txt = val != null ? String(val) : "";
                          const copyKey = `${record.id}-${f.key}`;
                          return (
                            <td key={f.id} className="px-3 py-2.5 text-xs max-w-[180px]">
                              <div className="flex items-center gap-1">
                                <span className="truncate block flex-1">
                                  {debouncedSearch ? highlight(txt, debouncedSearch) : (txt || <span className="text-slate-300 dark:text-slate-600">—</span>)}
                                </span>
                                {txt && (
                                  <button onClick={() => handleCopy(txt, copyKey)} className="shrink-0 text-slate-300 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" title="نسخ">
                                    {copiedId === copyKey ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {record.submittedAt ? new Date(record.submittedAt).toLocaleDateString("ar") : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-0.5 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="عرض" onClick={() => setViewRecord(record)} data-testid={`button-view-${record.id}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="تعديل" onClick={() => nav(`/admin/projects/${id}/records/${record.id}/edit`)} data-testid={`button-edit-${record.id}`}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" title="حذف" onClick={() => setDeleteId(record.id)} data-testid={`button-delete-${record.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ─── Pagination ─── */}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              عرض {startRow.toLocaleString("ar")}–{endRow.toLocaleString("ar")} من {total.toLocaleString("ar")} سجل
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goPage(1)} disabled={page === 1} data-testid="button-first-page">
                <ChevronsRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goPage(page - 1)} disabled={page === 1} data-testid="button-prev-page">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {getPaginationPages(page, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`e-${i}`} className="px-1 text-muted-foreground text-xs">…</span>
                ) : (
                  <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="h-7 min-w-7 px-2 text-xs" onClick={() => goPage(p as number)} data-testid={`button-page-${p}`}>{p}</Button>
                )
              )}
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goPage(page + 1)} disabled={page === totalPages} data-testid="button-next-page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => goPage(totalPages)} disabled={page === totalPages} data-testid="button-last-page">
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1 mr-1">
                <Input value={jumpPage} onChange={e => setJumpPage(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { goPage(Number(jumpPage)); setJumpPage(""); } }}
                  placeholder="صفحة" className="h-7 w-14 text-xs text-center" data-testid="input-jump-page" />
                <Button variant="outline" size="icon" className="h-7 w-7"
                  onClick={() => { goPage(Number(jumpPage)); setJumpPage(""); }} data-testid="button-jump">
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ─── View Record Dialog ─── */}
        <Dialog open={!!viewRecord} onOpenChange={() => setViewRecord(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            {viewRecord && (
              <>
                <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-700">
                  <DialogTitle className="text-base font-bold">تفاصيل السجل #{viewRecord.sequentialNumber}</DialogTitle>
                  <p className="text-xs text-muted-foreground">
                    {viewRecord.submittedAt ? `تاريخ التسجيل: ${new Date(viewRecord.submittedAt).toLocaleDateString("ar")}` : ""}
                  </p>
                </DialogHeader>
                <div className="overflow-y-auto flex-1 p-4">
                  <dl>{visibleFields.map(f => {
                    const rdata = viewRecord.data as Record<string, any>;
                    return <DetailRow key={f.id} label={f.label} value={rdata[f.key]} />;
                  })}</dl>
                </div>
                <DialogFooter className="pt-3 border-t border-slate-100 dark:border-slate-700 gap-2 flex-row">
                  <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print">
                    <Printer className="h-4 w-4 ml-1" /> طباعة
                  </Button>
                  <Button size="sm" onClick={() => { setViewRecord(null); nav(`/admin/projects/${id}/records/${viewRecord.id}/edit`); }} data-testid="button-edit-from-dialog">
                    <Edit className="h-4 w-4 ml-1" /> تعديل
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setViewRecord(null)} className="mr-auto" data-testid="button-close-dialog">إغلاق</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ─── Delete Confirm Dialog ─── */}
        <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>تأكيد الحذف</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء.</p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">إلغاء</Button>
              <Button variant="destructive"
                onClick={async () => {
                  if (!deleteId) return;
                  setDeleting(true);
                  try { await deleteMut.mutateAsync(deleteId); }
                  finally { setDeleting(false); }
                }}
                disabled={deleting} data-testid="button-confirm-delete">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Trash2 className="h-4 w-4 ml-1" />}
                حذف
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Import from Sheets Dialog ─── */}
        <Dialog open={importOpen} onOpenChange={v => { if (!importing) { setImportOpen(v); if (!v) setImportResult(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-green-600" />
                استيراد البيانات من Google Sheets
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                سيتم قراءة البيانات من الـ Sheet المربوط بهذا المشروع ومطابقتها مع السجلات الموجودة بناءً على الرقم التسلسلي.
              </p>

              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <input type="checkbox" checked={syncDeleted} onChange={e => setSyncDeleted(e.target.checked)} className="accent-primary mt-0.5" data-testid="check-sync-deleted" />
                <div>
                  <p className="text-sm font-medium">مزامنة المحذوفات</p>
                  <p className="text-xs text-muted-foreground">حذف السجلات غير الموجودة في الـ Sheet</p>
                </div>
              </label>

              {importResult && (
                <div className={`p-3 rounded-lg border text-sm space-y-2 ${importResult.ok ? "bg-green-50 dark:bg-green-900/20 border-green-200" : "bg-red-50 dark:bg-red-900/20 border-red-200"}`}>
                  <p className={importResult.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
                    {importResult.message}
                  </p>
                  {importResult.ok && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="text-center p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                        <p className="text-lg font-bold text-green-600">{importResult.added ?? 0}</p>
                        <p className="text-[11px] text-muted-foreground">مُضاف</p>
                      </div>
                      <div className="text-center p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                        <p className="text-lg font-bold text-blue-600">{importResult.updated ?? 0}</p>
                        <p className="text-[11px] text-muted-foreground">مُحدَّث</p>
                      </div>
                      <div className="text-center p-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm">
                        <p className="text-lg font-bold text-slate-500">{importResult.skipped ?? 0}</p>
                        <p className="text-[11px] text-muted-foreground">مُتجاوَز</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setImportOpen(false); setImportResult(null); }} disabled={importing} data-testid="button-cancel-import">إلغاء</Button>
              <Button onClick={doImport} disabled={importing} className="bg-green-600 hover:bg-green-700" data-testid="button-confirm-import">
                {importing ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Upload className="h-4 w-4 ml-1" />}
                {importing ? "جاري الاستيراد..." : "بدء الاستيراد"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </Layout>
  );
}
