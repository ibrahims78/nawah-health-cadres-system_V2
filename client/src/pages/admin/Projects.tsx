import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/context/ProjectContext";
import {
  Plus, FolderKanban, Users, Settings, Trash2, LayoutDashboard,
  ExternalLink, Loader2, Search, Copy, Check, Download,
  SortAsc, ArrowUpDown, Clock, AlignLeft,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

// ── Deterministic gradient per project ──────────────────────────
const GRADIENTS = [
  ["#6366f1","#8b5cf6"], // indigo → violet
  ["#0ea5e9","#6366f1"], // sky → indigo
  ["#10b981","#0ea5e9"], // emerald → sky
  ["#f59e0b","#ef4444"], // amber → red
  ["#ec4899","#8b5cf6"], // pink → violet
  ["#14b8a6","#10b981"], // teal → emerald
  ["#f97316","#ec4899"], // orange → pink
  ["#3b82f6","#14b8a6"], // blue → teal
];
function projectGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}

type SortKey = "newest" | "alpha" | "steps";

export function Projects() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const { user } = useAuth();
  const canCreateProject = user?.role === "admin" || user?.role === "editor";
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { setCurrentProject } = useProject();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/projects"] }); setDeleteId(null); },
  });

  const sorted = useMemo(() => {
    const list = [...projects];
    if (sort === "alpha") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "steps") list.sort((a, b) => ((b as any).steps?.length || 0) - ((a as any).steps?.length || 0));
    // newest: keep server order (descending created_at)
    return list;
  }, [projects, sort]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter(p => p.name.toLowerCase().includes(s) || (p.description || "").toLowerCase().includes(s));
  }, [sorted, search]);

  const openProject = (p: Project) => { setCurrentProject(p); nav(`/admin/projects/${p.id}/dashboard`); };

  const copyLink = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`${window.location.origin}/p/${p.id}/register`);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const SORT_OPTIONS: { key: SortKey; label: string; labelEn: string; icon: any }[] = [
    { key: "newest", label: "الأحدث", labelEn: "Newest", icon: Clock },
    { key: "alpha",  label: "أبجدي",  labelEn: "A–Z",    icon: AlignLeft },
    { key: "steps",  label: "الخطوات", labelEn: "Steps",  icon: SortAsc },
  ];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
              {ar ? "المشاريع" : "Projects"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading
                ? (ar ? "جاري التحميل..." : "Loading...")
                : (ar ? `${projects.length} مشروع` : `${projects.length} project${projects.length !== 1 ? "s" : ""}`)}
            </p>
          </div>
          {canCreateProject && (
            <Button onClick={() => nav("/admin/projects/new")} data-testid="button-new-project"
              className="shadow-sm">
              <Plus className="h-4 w-4 ml-2" />
              {ar ? "مشروع جديد" : "New Project"}
            </Button>
          )}
        </div>

        {/* ── Search + Sort ── */}
        {projects.length > 0 && (
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={ar ? "بحث في المشاريع..." : "Search projects..."}
                className="pr-9"
                data-testid="input-search-projects"
              />
            </div>
            {/* Sort pills */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setSort(opt.key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    sort === opt.key
                      ? "bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  }`}
                >
                  <opt.icon className="h-3 w-3" />
                  {ar ? opt.label : opt.labelEn}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Content ── */}
        {isLoading ? (
          /* Skeleton cards */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="overflow-hidden flex flex-col">
                <Skeleton className="h-24 w-full rounded-none" />
                <div className="p-5 space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <div className="flex gap-2 pt-2">
                    <Skeleton className="h-8 flex-1 rounded-lg" />
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <Skeleton className="h-8 w-8 rounded-lg" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 && search ? (
          /* No search results */
          <Card className="p-10 text-center text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>{ar ? `لا توجد مشاريع مطابقة لـ "${search}"` : `No projects match "${search}"`}</p>
          </Card>
        ) : projects.length === 0 ? (
          /* Empty state */
          <Card className="flex flex-col items-center justify-center py-20 text-center border-dashed border-2">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center mb-5">
              <FolderKanban className="h-10 w-10 text-primary/50" />
            </div>
            <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-1">
              {ar ? "ابدأ مشروعك الأول" : "Create your first project"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs">
              {ar
                ? "حوّل أي ملف Excel إلى نموذج تسجيل متعدد الخطوات بدقائق"
                : "Turn any Excel file into a multi-step registration form in minutes"}
            </p>
            {canCreateProject && (
              <Button onClick={() => nav("/admin/projects/new")} className="shadow-sm">
                <Plus className="h-4 w-4 ml-2" />
                {ar ? "إنشاء مشروع" : "Create Project"}
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(p => {
              const [c1, c2] = projectGradient(p.name);
              return (
                <Card
                  key={p.id}
                  className="overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer group flex flex-col border-slate-200/80 dark:border-slate-700/60"
                  data-testid={`card-project-${p.id}`}
                  onClick={() => openProject(p)}
                >
                  {/* Gradient header strip */}
                  <div
                    className="h-24 relative flex-shrink-0 flex items-end p-3"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  >
                    {/* Decorative circles */}
                    <div className="absolute top-2 left-3 w-14 h-14 rounded-full opacity-10 bg-white" />
                    <div className="absolute bottom-1 left-10 w-8 h-8 rounded-full opacity-10 bg-white" />

                    {/* Hover actions */}
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/35 backdrop-blur-sm flex items-center justify-center transition-colors"
                        title={ar ? "نسخ رابط النموذج" : "Copy Form Link"}
                        onClick={e => copyLink(p, e)}
                        data-testid={`button-copy-link-${p.id}`}
                      >
                        {copiedId === p.id
                          ? <Check className="h-3.5 w-3.5 text-white" />
                          : <Copy className="h-3.5 w-3.5 text-white" />}
                      </button>
                      <button
                        className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/35 backdrop-blur-sm flex items-center justify-center transition-colors"
                        title={ar ? "فتح النموذج" : "Open Form"}
                        onClick={e => { e.stopPropagation(); window.open(`/p/${p.id}/register`, "_blank"); }}
                        data-testid={`button-form-${p.id}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-white" />
                      </button>
                      <button
                        className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/35 backdrop-blur-sm flex items-center justify-center transition-colors"
                        title={ar ? "إعدادات" : "Settings"}
                        onClick={e => { e.stopPropagation(); nav(`/admin/projects/${p.id}/settings`); }}
                        data-testid={`button-settings-${p.id}`}
                      >
                        <Settings className="h-3.5 w-3.5 text-white" />
                      </button>
                      <button
                        className="w-7 h-7 rounded-lg bg-black/20 hover:bg-red-500/70 backdrop-blur-sm flex items-center justify-center transition-colors"
                        title={ar ? "حذف" : "Delete"}
                        onClick={e => { e.stopPropagation(); setDeleteId(p.id); }}
                        data-testid={`button-delete-${p.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-white" />
                      </button>
                    </div>

                    {/* Project initial avatar */}
                    <div className="w-9 h-9 rounded-xl bg-white/25 backdrop-blur-sm border border-white/30 flex items-center justify-center shadow-sm">
                      <span className="text-white font-bold text-sm">{p.name[0]}</span>
                    </div>

                    {/* Status badge */}
                    <div className="mr-auto">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full backdrop-blur-sm border ${
                        p.formEnabled
                          ? "bg-green-500/20 border-green-300/40 text-green-100"
                          : "bg-black/20 border-white/20 text-white/70"
                      }`}>
                        {p.formEnabled ? (ar ? "🟢 مفعّل" : "🟢 Active") : (ar ? "متوقف" : "Inactive")}
                      </span>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 flex flex-col flex-1">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-1 leading-tight">{p.name}</h3>
                    {p.description ? (
                      <p className="text-xs text-muted-foreground mb-3 line-clamp-2 leading-relaxed">{p.description}</p>
                    ) : (
                      <div className="mb-3" />
                    )}

                    <div className="flex items-center gap-2 mb-4">
                      {Array.isArray((p as any).steps) && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600">
                          {(p as any).steps.length} {ar ? "خطوات" : "steps"}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-auto">
                      <Button
                        size="sm"
                        className="flex-1 h-8 shadow-sm"
                        onClick={e => { e.stopPropagation(); openProject(p); }}
                        data-testid={`button-open-${p.id}`}
                      >
                        <LayoutDashboard className="h-3.5 w-3.5 ml-1" />
                        {ar ? "فتح" : "Open"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-2.5"
                        title={ar ? "تصدير" : "Export"}
                        onClick={e => { e.stopPropagation(); nav(`/admin/projects/${p.id}/export`); }}
                        data-testid={`button-export-${p.id}`}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-2.5"
                        title={ar ? "السجلات" : "Records"}
                        onClick={e => { e.stopPropagation(); nav(`/admin/projects/${p.id}/records`); }}
                        data-testid={`button-records-${p.id}`}>
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── Delete Dialog ── */}
        <Dialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{ar ? "تأكيد حذف المشروع" : "Delete Project"}</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                {ar
                  ? <> هل أنت متأكد من حذف <strong>"{projects.find(p => p.id === deleteId)?.name}"</strong>؟<br />سيتم حذف <span className="text-red-500 font-semibold">جميع السجلات والبيانات</span> نهائياً.</>
                  : <> Delete <strong>"{projects.find(p => p.id === deleteId)?.name}"</strong>?<br />All <span className="text-red-500 font-semibold">records and data</span> will be permanently removed.</>}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2">
                ⚠️ {ar
                  ? "ملفات Google Drive المزامنة لن تُحذف تلقائياً."
                  : "Google Drive synced files will NOT be deleted automatically."}
              </p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteId(null)} data-testid="button-cancel-delete">
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!deleteId) return;
                  setDeleting(true);
                  try { await deleteMut.mutateAsync(deleteId); }
                  finally { setDeleting(false); }
                }}
                disabled={deleting || deleteMut.isPending}
                data-testid="button-confirm-delete"
              >
                {(deleting || deleteMut.isPending)
                  ? <Loader2 className="h-4 w-4 animate-spin ml-1" />
                  : <Trash2 className="h-4 w-4 ml-1" />}
                {ar ? "حذف المشروع" : "Delete Project"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
