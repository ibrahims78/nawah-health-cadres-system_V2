import { useState, useEffect, useMemo, useCallback } from "react";
import { fetchJson } from "@/lib/queryClient";
import { useParams, useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus, Search, Trash2, Eye, Edit, Loader2,
  ChevronRight, ChevronLeft, Users, Copy, Check,
  Columns3, X, ChevronsLeft, ChevronsRight,
  Printer, Filter, RefreshCw, SkipForward,
  Link, Upload, Wrench, ArrowUpToLine,
} from "lucide-react";
import type { ProjectRecord, ProjectField } from "@shared/schema";
import { cn } from "@/lib/utils";
import { useLang } from "@/context/LanguageContext";
import { useToast } from "@/hooks/use-toast";

interface RecordsResponse { data: ProjectRecord[]; total: number; page: number; limit: number; }

function highlight(text: string, term: string) {
  if (!term || !text) return <>{text}</>;
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\$&");
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

const STATUS_MAP_EN: Record<string, string> = {
  "مكتمل":          "Completed",
  "منقوص":          "Incomplete",
  "مرفوض":          "Rejected",
  "قيد المراجعة":   "Under Review",
  "نشط":            "Active",
  "غير نشط":        "Inactive",
};

function getStatusColor(val: string): string {
  return STATUS_COLORS[val] || "bg-slate-300 dark:bg-slate-600";
}

function periodToRange(period: string): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  if (period === "today") {
    // from/to already set to today's bounds
  } else if (period === "week") {
    const day = from.getDay();
    from.setDate(from.getDate() - day);
  } else if (period === "month") {
    from.setDate(1);
  } else {
    return {};
  }
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

export function ProjectRecords() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const urlSearch = useSearch();
  const qc = useQueryClient();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const { toast } = useToast();

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
  const [dateRange, setDateRange] = useState<{ dateFrom?: string; dateTo?: string }>({});
  const [activePeriod, setActivePeriod] = useState<string>("");

  useEffect(() => {
    if (!urlSearch) return;
    const sp = new URLSearchParams(urlSearch);
    const filterParam = sp.get("filter");
    const periodParam = sp.get("period");

    if (filterParam) {
      const idx = filterParam.indexOf(":");
      if (idx > -1) {
        const key = decodeURIComponent(filterParam.slice(0, idx));
        const value = decodeURIComponent(filterParam.slice(idx + 1));
        setFieldFilters(p => ({ ...p, [key]: value }));
        setFilterOpen(true);
      }
    }

    if (periodParam) {
      setActivePeriod(periodParam);
      setDateRange(periodToRange(periodParam));
    }

    setPage(1);
  }, [urlSearch]);

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [syncDeleted, setSyncDeleted] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string; added?: number; updated?: number; skipped?: number } | null>(null);

  // Fix headers state
  const [fixingHeaders, setFixingHeaders] = useState(false);
  const [fixResult, setFixResult] = useState<string | null>(null);

  // Export to sheets state
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ ok: boolean; message: string; exported?: number } | null>(null);

  // Copy link
  const [copiedLink, setCopiedLink] = useState(false);

  const { data: project } = useQuery<{ id: string; name: string; formEnabled?: boolean; [k: string]: any }>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetchJson(`/api/projects/${id}`),
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetchJson(`/api/projects/${id}/fields`),
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
    if (dateRange.dateFrom) p.set("dateFrom", dateRange.dateFrom);
    if (dateRange.dateTo) p.set("dateTo", dateRange.dateTo);
    return p;
  }, [page, limit, debouncedSearch, fieldFilters, dateRange]);

  const { data, isLoading, refetch } = useQuery<RecordsResponse>({
    queryKey: ["/api/projects", id, "records", params.toString()],
    queryFn: () => fetchJson(`/api/projects/${id}/records?${params}`),
  });

  const deleteMut = useMutation({
    mutationFn: (recordId: string) => apiRequest("DELETE", `/api/projects/${id}/records/${recordId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      setDeleteId(null);
    },
    onError: (err: any) => {
      toast({ title: isAr ? "خطأ في الحذف" : "Delete failed", description: err?.message || (isAr ? "حدث خطأ غير متوقع" : "Unexpected error"), variant: "destructive" });
    },
  });

  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", `/api/projects/${id}/records/bulk-delete`, { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
      setSelected(new Set());
    },
    onError: (err: any) => {
      toast({ title: isAr ? "خطأ في الحذف الجماعي" : "Bulk delete failed", description: err?.message || (isAr ? "حدث خطأ غير متوقع" : "Unexpected error"), variant: "destructive" });
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

  const doExport = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res: any = await apiRequest("POST", `/api/projects/${id}/export-to-sheets`, {});
      setExportResult(res);
      if (res.ok) qc.invalidateQueries({ queryKey: ["/api/projects", id, "records"] });
    } catch (err: any) {
      setExportResult({ ok: false, message: `❌ ${err.message}` });
    } finally {
      setExporting(false);
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
            <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100">{isAr ? "السجلات" : "Records"}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {isLoading ? (isAr ? "جاري التحميل..." : "Loading...") : (isAr ? `الإجمالي: ${total.toLocaleString("ar-SY")} سجل` : `Total: ${total.toLocaleString()} records`)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.size > 0 && (
              <Button variant="destructive" size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkDeleteMut.isPending} data-testid="button-bulk-delete">
                {bulkDeleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Trash2 className="h-4 w-4 ml-1" />}
                {isAr ? `حذف ${selected.size} محدد` : `Delete ${selected.size} selected`}
              </Button>
            )}

            {/* Fix sheet headers */}
            <Button variant="outline" size="sm" onClick={doFixHeaders} disabled={fixingHeaders} title={isAr ? "تصحيح ترويسات الـ Sheet" : "Fix Sheet Headers"} data-testid="button-fix-headers">
              {fixingHeaders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            </Button>

            {/* Export DB → Sheet */}
            <Button variant="outline" size="sm" onClick={() => { setExportOpen(true); setExportResult(null); }} data-testid="button-export-sheets">
              <ArrowUpToLine className="h-4 w-4 ml-1" />
              {isAr ? "رفع إلى Sheet" : "Push to Sheet"}
            </Button>

            {/* Import from Sheets */}
            <Button variant="outline" size="sm" onClick={() => { setImportOpen(true); setImportResult(null); }} data-testid="button-import-sheets">
              <Upload className="h-4 w-4 ml-1" />
              {isAr ? "جلب من Sheet" : "Pull from Sheet"}
            </Button>

            {/* Copy form link */}
            <Button variant="outline" size="sm" onClick={copyFormLink} data-testid="button-copy-link">
              {copiedLink ? <Check className="h-4 w-4 ml-1 text-green-500" /> : <Link className="h-4 w-4 ml-1" />}
              {copiedLink ? (isAr ? "تم النسخ!" : "Copied!") : (isAr ? "نسخ رابط النموذج" : "Copy Form Link")}
            </Button>

            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => nav(`/admin/projects/${id}/records/new`)} data-testid="button-add-record">
              <Plus className="h-4 w-4 ml-1" />{isAr ? "إضافة سجل" : "Add Record"}
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
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={isAr ? "بحث في جميع الحقول..." : "Search all fields..."} className="pr-9" data-testid="input-search" />
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
              {isAr ? "فلتر" : "Filter"}
              {activeFilterCount > 0 && <Badge variant="secondary" className="mr-1.5 h-4 px-1 text-[10px]">{activeFilterCount}</Badge>}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => setColPickerOpen(v => !v)} data-testid="button-columns">
            <Columns3 className="h-4 w-4 ml-1" />{isAr ? "الأعمدة" : "Columns"}
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
        {(activeFilterCount > 0 || activePeriod) && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">{isAr ? "الفلاتر:" : "Filters:"}</span>
            {activePeriod && (
              <Badge variant="secondary" className="gap-1 pl-1">
                {isAr
                  ? (activePeriod === "today" ? "اليوم" : activePeriod === "week" ? "هذا الأسبوع" : activePeriod === "month" ? "هذا الشهر" : activePeriod)
                  : (activePeriod === "today" ? "Today" : activePeriod === "week" ? "This Week" : activePeriod === "month" ? "This Month" : activePeriod)}
                <button onClick={() => { setActivePeriod(""); setDateRange({}); }} className="hover:text-red-500">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
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
            <button onClick={() => { setFieldFilters({}); setActivePeriod(""); setDateRange({}); }} className="text-xs text-red-500 hover:underline">{isAr ? "مسح الكل" : "Clear All"}</button>
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
                        <option value="">{isAr ? "الكل" : "All"}</option>
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
              <span className="text-sm font-semibold">{isAr ? `اختر الأعمدة المعروضة (${activeCols.length}/${visibleFields.length})` : `Select Visible Columns (${activeCols.length}/${visibleFields.length})`}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setVisibleColKeys(visibleFields.map(f => f.key))}>{isAr ? "تحديد الكل" : "Select All"}</Button>
                <Button size="sm" variant="outline" onClick={() => setVisibleColKeys(null)}>{isAr ? "الافتراضي" : "Default"}</Button>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="px-3 py-2.5 w-8"><Skeleton className="h-4 w-4 rounded" /></th>
                    <th className="px-3 py-2.5"><Skeleton className="h-3 w-6" /></th>
                    {[1,2,3,4,5].map(i => (
                      <th key={i} className="px-3 py-2.5"><Skeleton className="h-3 w-20" /></th>
                    ))}
                    <th className="px-3 py-2.5"><Skeleton className="h-3 w-16" /></th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-3"><Skeleton className="h-4 w-4 rounded" /></td>
                      <td className="px-3 py-3"><Skeleton className="h-3 w-8" /></td>
                      {[1,2,3,4,5].map(j => (
                        <td key={j} className="px-3 py-3"><Skeleton className={`h-3 ${j % 2 === 0 ? "w-24" : "w-32"}`} /></td>
                      ))}
                      <td className="px-3 py-3"><Skeleton className="h-6 w-16 rounded-full" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !data?.data?.length ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{isAr ? `لا توجد سجلات${search ? " مطابقة للبحث" : ""}` : `No records${search ? " matching the search" : ""}`}</p>
              <Button size="sm" className="mt-4" onClick={() => nav(`/admin/projects/${id}/records/new`)}>
                <Plus className="h-4 w-4 ml-1" /> {isAr ? "إضافة أول سجل" : "Add First Record"}
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
                    <th className="px-3 py-2.5 text-right font-semibold text-xs text-muted-foreground whitespace-nowrap">{isAr ? "التاريخ" : "Date"}</th>
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
                            <div className={`w-1.5 h-8 rounded-full ${getStatusColor(statusVal)}`} title={isAr ? statusVal : (STATUS_MAP_EN[statusVal] || statusVal)} />
                          </td>
                        )}
                        {colFields.map(f => {
                          const val = rdata[f.key];
                          const txt = val != null ? String(val) : "";
                          const copyKey = `${record.id}-${f.key}`;
                          if (f.fieldType === "file") {
                            const syncSt = (record as any).syncStatus || "local";
                            const syncIcon = syncSt === "synced" ? "✅" : syncSt === "sync_failed" ? "🔴" : "🟡";
                            const syncTitle = syncSt === "synced"
                              ? (isAr ? "مُزامَن مع Drive" : "Synced to Drive")
                              : syncSt === "sync_failed"
                              ? (isAr ? "فشلت المزامنة" : "Sync failed")
                              : (isAr ? "محلي — لم يُزامَن" : "Local — not synced");
                            return (
                              <td key={f.id} className="px-3 py-2.5 text-xs max-w-[200px]">
                                {txt ? (
                                  <div className="flex items-center gap-1.5">
                                    <a
                                      href={txt}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="text-primary hover:underline truncate"
                                      data-testid={`link-file-${copyKey}`}
                                    >
                                      {isAr ? "عرض الملف" : "View File"}
                                    </a>
                                    <span title={syncTitle} className="shrink-0 text-xs">{syncIcon}</span>
                                  </div>
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-600">—</span>
                                )}
                              </td>
                            );
                          }
                          return (
                            <td key={f.id} className="px-3 py-2.5 text-xs max-w-[180px]">
                              <div className="flex items-center gap-1">
                                <span className="truncate block flex-1">
                                  {debouncedSearch ? highlight(txt, debouncedSearch) : (txt || <span className="text-slate-300 dark:text-slate-600">—</span>)}
                                </span>
                                {txt && (
                                  <button onClick={() => handleCopy(txt, copyKey)} className="shrink-0 text-slate-300 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity" title={isAr ? "نسخ" : "Copy"}>
                                    {copiedId === copyKey ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {record.submittedAt ? new Date(record.submittedAt).toLocaleDateString(isAr ? "ar" : "en-US") : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-0.5 justify-end">
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={isAr ? "عرض" : "View"} onClick={() => setViewRecord(record)} data-testid={`button-view-${record.id}`}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={isAr ? "تعديل" : "Edit"} onClick={() => nav(`/admin/projects/${id}/records/${record.id}/edit`)} data-testid={`button-edit-${record.id}`}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" title={isAr ? "حذف" : "Delete"} onClick={() => setDeleteId(record.id)} data-testid={`button-delete-${record.id}`}>
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
        {!isLoading && total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-sm">
            <div className="text-xs text-muted-foreground order-2 sm:order-1">
              {isAr ? `عرض ${startRow} - ${endRow} من أصل ${total}` : `Showing ${startRow} - ${endRow} of ${total}`}
            </div>
            <div className="flex items-center gap-1 order-1 sm:order-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => goPage(1)} disabled={page === 1}><ChevronsRight className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => goPage(page - 1)} disabled={page === 1}><ChevronRight className="h-4 w-4" /></Button>
              <div className="flex items-center gap-1 mx-1">
                {getPaginationPages(page, totalPages).map((p, i) => (
                  p === "…" ? <span key={`sep-${i}`} className="px-1 text-slate-300">...</span> :
                  <Button key={p} variant={page === p ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => goPage(p)}>{p}</Button>
                ))}
              </div>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => goPage(page + 1)} disabled={page === totalPages}><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => goPage(totalPages)} disabled={page === totalPages}><ChevronsLeft className="h-4 w-4" /></Button>

              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1 hidden sm:block" />
              <div className="flex items-center gap-1 hidden sm:flex">
                <span className="text-[10px] text-muted-foreground">{isAr ? "انتقال:" : "Go to:"}</span>
                <Input value={jumpPage} onChange={e => setJumpPage(e.target.value)} onKeyDown={e => e.key === "Enter" && (goPage(Number(jumpPage)), setJumpPage(""))}
                  className="h-7 w-12 text-center text-xs p-0 px-1" placeholder="#" />
              </div>
            </div>
          </div>
        )}

        {/* ─── View Record Dialog ─── */}
        <Dialog open={!!viewRecord} onOpenChange={o => !o && setViewRecord(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader className="border-b pb-3 mb-4">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-xl font-bold">{isAr ? "تفاصيل السجل" : "Record Details"}</DialogTitle>
                <Badge variant="outline" className="font-mono text-xs">#{viewRecord?.sequentialNumber}</Badge>
              </div>
            </DialogHeader>
            {viewRecord && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  <section>
                    <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2">
                      <div className="w-1.5 h-4 bg-primary rounded-full" />
                      {isAr ? "معلومات الحقول" : "Field Information"}
                    </h3>
                    <dl className="space-y-0.5">
                      {fields.map(f => (
                        <DetailRow key={f.key} label={f.label} value={(viewRecord.data as any)[f.key]} />
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2">
                      <div className="w-1.5 h-4 bg-primary rounded-full" />
                      {isAr ? "معلومات النظام" : "System Information"}
                    </h3>
                    <dl className="space-y-0.5">
                      <DetailRow label={isAr ? "تاريخ التقديم" : "Submission Date"} value={viewRecord.submittedAt ? new Date(viewRecord.submittedAt).toLocaleString(isAr ? "ar" : "en-US") : "—"} />
                      <DetailRow label={isAr ? "المعرف الفريد" : "Unique ID"} value={viewRecord.id} />
                      <DetailRow label={isAr ? "رقم التسلسل" : "Sequence Number"} value={viewRecord.sequentialNumber} />
                    </dl>
                  </section>
                </div>
              </div>
            )}
            <DialogFooter className="border-t pt-4 mt-6 flex justify-between gap-2">
              <Button variant="outline" onClick={() => window.print()} className="gap-2">
                <Printer className="h-4 w-4" /> {isAr ? "طباعة" : "Print"}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setViewRecord(null)}>{isAr ? "إغلاق" : "Close"}</Button>
                <Button onClick={() => nav(`/admin/projects/${id}/records/${viewRecord?.id}/edit`)}>{isAr ? "تعديل السجل" : "Edit Record"}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Bulk Delete Confirmation ─── */}
        <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isAr ? "حذف السجلات المحددة" : "Delete Selected Records"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {isAr
                ? `هل أنت متأكد من حذف ${selected.size} سجل؟ لا يمكن التراجع عن هذا الإجراء.`
                : `Are you sure you want to delete ${selected.size} records? This action cannot be undone.`}
            </p>
            <DialogFooter className="gap-2 pt-4">
              <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button variant="destructive" onClick={() => { bulkDeleteMut.mutate([...selected]); setBulkDeleteOpen(false); }} disabled={bulkDeleteMut.isPending}>
                {bulkDeleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 ml-1" />}
                {isAr ? "حذف" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Delete Confirmation ─── */}
        <Dialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isAr ? "حذف السجل" : "Delete Record"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{isAr ? "هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء." : "Are you sure you want to delete this record? This action cannot be undone."}</p>
            <DialogFooter className="gap-2 pt-4">
              <Button variant="outline" onClick={() => setDeleteId(null)}>{isAr ? "إلغاء" : "Cancel"}</Button>
              <Button variant="destructive" onClick={() => deleteMut.mutate(deleteId!)} disabled={deleteMut.isPending}>
                {deleteMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 ml-1" />}
                {isAr ? "حذف" : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Import Dialog ─── */}
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                {isAr ? "استيراد من Google Sheets" : "Import from Google Sheets"}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {isAr ? "سيتم جلب جميع البيانات من ملف الـ Spreadsheet المرتبط بالمشروع ومزامنتها مع قاعدة البيانات المحلية." : "All data will be fetched from the Spreadsheet linked to the project and synced with the local database."}
              </p>

              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                <div>
                  <p className="text-sm font-semibold">{isAr ? "مزامنة الحذف" : "Sync Deletion"}</p>
                  <p className="text-[11px] text-muted-foreground">{isAr ? "حذف السجلات المحلية غير الموجودة في الـ Sheet" : "Delete local records not present in the Sheet"}</p>
                </div>
                <input type="checkbox" checked={syncDeleted} onChange={e => setSyncDeleted(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
              </div>

              {importResult && (
                <Card className={cn("p-4 border-l-4", importResult.ok ? "bg-green-50 border-green-400 text-green-800" : "bg-red-50 border-red-400 text-red-800")}>
                  <p className="text-sm font-bold mb-1">{importResult.ok ? (isAr ? "✅ اكتمل الاستيراد بنجاح" : "✅ Import completed successfully") : (isAr ? "❌ فشل الاستيراد" : "❌ Import failed")}</p>
                  <p className="text-xs opacity-90 mb-3">{importResult.message}</p>
                  {importResult.ok && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-green-200">
                      <div className="text-center">
                        <p className="text-xs text-green-600 mb-0.5">{isAr ? "جديد" : "New"}</p>
                        <p className="font-bold text-lg">{importResult.added || 0}</p>
                      </div>
                      <div className="text-center border-x border-green-200">
                        <p className="text-xs text-green-600 mb-0.5">{isAr ? "محدث" : "Updated"}</p>
                        <p className="font-bold text-lg">{importResult.updated || 0}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-green-600 mb-0.5">{isAr ? "تخطي" : "Skipped"}</p>
                        <p className="font-bold text-lg">{importResult.skipped || 0}</p>
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>{isAr ? "إغلاق" : "Close"}</Button>
              <Button onClick={doImport} disabled={importing} className="min-w-[120px]">
                {importing ? (
                  <><Loader2 className="h-4 w-4 animate-spin ml-2" /> {isAr ? "جاري الاستيراد..." : "Importing..."}</>
                ) : (
                  <><Upload className="h-4 w-4 ml-2" /> {isAr ? "بدء المزامنة" : "Start Sync"}</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Export Dialog ─── */}
        <Dialog open={exportOpen} onOpenChange={o => { setExportOpen(o); if (!o) setExportResult(null); }}>
          <DialogContent className="sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowUpToLine className="h-5 w-5 text-primary" />
                {isAr ? "رفع إلى Google Sheets" : "Push to Google Sheets"}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {isAr
                  ? "سيتم رفع جميع سجلات المنصة إلى ملف الـ Spreadsheet المرتبط — الاتجاه: قاعدة البيانات ← Sheet."
                  : "All platform records will be pushed to the linked Spreadsheet — direction: Database → Sheet."}
              </p>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 flex items-start gap-2">
                <span className="text-amber-600 text-base mt-0.5">⚠️</span>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  {isAr
                    ? "سيتم محو محتوى الـ Sheet الحالي كاملاً (بما فيه أي تعديلات يدوية) وإعادة كتابته من بيانات المنصة."
                    : "The current Sheet content (including any manual edits) will be fully erased and rewritten from platform data."}
                </p>
              </div>
              {exportResult && (
                <div className={`p-4 rounded-lg border-l-4 text-sm ${exportResult.ok ? "bg-green-50 border-green-400 text-green-800" : "bg-red-50 border-red-400 text-red-800"}`}>
                  <p className="font-bold mb-1">{exportResult.ok ? (isAr ? "✅ اكتمل الرفع" : "✅ Push completed") : (isAr ? "❌ فشل الرفع" : "❌ Push failed")}</p>
                  <p className="text-xs opacity-90">{exportResult.message}</p>
                  {exportResult.ok && exportResult.exported !== undefined && (
                    <div className="mt-2 pt-2 border-t border-green-200">
                      <p className="text-lg font-black">{exportResult.exported} <span className="text-xs font-normal">{isAr ? "سجل" : "records"}</span></p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>{isAr ? "إغلاق" : "Close"}</Button>
              <Button onClick={doExport} disabled={exporting} className="min-w-[120px] bg-primary">
                {exporting
                  ? <><Loader2 className="h-4 w-4 animate-spin ml-2" /> {isAr ? "جاري الرفع..." : "Pushing..."}</>
                  : <><ArrowUpToLine className="h-4 w-4 ml-2" /> {isAr ? "رفع الآن" : "Push Now"}</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    </Layout>
  );
}
