import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useProject } from "@/context/ProjectContext";
import {
  Plus, FolderKanban, Users, Settings, Trash2, LayoutDashboard,
  ExternalLink, Loader2, Search, Copy, Check, Download
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Project } from "@shared/schema";
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";

export function Projects() {
  const { lang } = useLang();
  const ar = lang === "ar";
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canCreateProject = user?.role === "admin" || user?.role === "editor";
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { setCurrentProject } = useProject();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects"] });
      setDeleteId(null);
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const s = search.toLowerCase();
    return projects.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.description || "").toLowerCase().includes(s)
    );
  }, [projects, search]);

  const openProject = (p: Project) => {
    setCurrentProject(p);
    nav(`/admin/projects/${p.id}/dashboard`);
  };

  const copyLink = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/p/${p.id}/register`;
    navigator.clipboard.writeText(url);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{ar ? "المشاريع" : "Projects"}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isLoading ? (ar ? "جاري التحميل..." : "Loading...") : (ar ? `${projects.length} مشروع` : `${projects.length} project${projects.length !== 1 ? "s" : ""}`)}
            </p>
          </div>
          {canCreateProject && (
            <Button onClick={() => nav("/admin/projects/new")} data-testid="button-new-project">
              <Plus className="h-4 w-4 ml-2" />
              {ar ? "مشروع جديد" : "New Project"}
            </Button>
          )}
        </div>

        {/* Search */}
        {projects.length > 2 && (
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={ar ? "بحث في المشاريع..." : "Search projects..."}
              className="pr-9"
              data-testid="input-search-projects"
            />
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 && search ? (
          <Card className="p-10 text-center text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>{ar ? `لا توجد مشاريع مطابقة لـ "${search}"` : `No projects match "${search}"`}</p>
          </Card>
        ) : projects.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 text-center">
            <FolderKanban className="h-16 w-16 text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-lg font-semibold text-slate-600 dark:text-slate-400 mb-2">
              {ar ? "لا يوجد مشاريع بعد" : "No projects yet"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6">{ar ? "أنشئ مشروعك الأول لبدء جمع البيانات" : "Create your first project to start collecting data"}</p>
            {canCreateProject && (
              <Button onClick={() => nav("/admin/projects/new")}>
                <Plus className="h-4 w-4 ml-2" />
                {ar ? "إنشاء مشروع" : "Create Project"}
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(p => (
              <Card
                key={p.id}
                className="p-5 hover:shadow-md transition-shadow cursor-pointer group flex flex-col"
                data-testid={`card-project-${p.id}`}
                onClick={() => openProject(p)}
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-sm flex-shrink-0">
                    <span className="text-white font-bold text-sm">{p.name[0]}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      title={ar ? "نسخ رابط النموذج" : "Copy Form Link"}
                      onClick={e => copyLink(p, e)}
                      data-testid={`button-copy-link-${p.id}`}
                    >
                      {copiedId === p.id
                        ? <Check className="h-3.5 w-3.5 text-green-500" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      title={ar ? "فتح النموذج" : "Open Form"}
                      onClick={e => { e.stopPropagation(); window.open(`/p/${p.id}/register`, "_blank"); }}
                      data-testid={`button-form-${p.id}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7"
                      title={ar ? "إعدادات" : "Settings"}
                      onClick={e => { e.stopPropagation(); nav(`/admin/projects/${p.id}/settings`); }}
                      data-testid={`button-settings-${p.id}`}
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500"
                      title={ar ? "حذف" : "Delete"}
                      onClick={e => { e.stopPropagation(); setDeleteId(p.id); }}
                      data-testid={`button-delete-${p.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-1">{p.name}</h3>
                {p.description && (
                  <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{p.description}</p>
                )}

                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <Badge
                    variant={p.formEnabled ? "default" : "secondary"}
                    className={`text-[10px] ${p.formEnabled ? "bg-green-500/90 hover:bg-green-500" : ""}`}
                  >
                    {p.formEnabled ? (ar ? "🟢 مفعّل" : "🟢 Active") : (ar ? "متوقف" : "Inactive")}
                  </Badge>
                  {Array.isArray((p as any).steps) && (
                    <Badge variant="outline" className="text-[10px]">
                      {(p as any).steps.length} {ar ? "خطوات" : "steps"}
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2 mt-auto">
                  <Button
                    size="sm"
                    className="flex-1 h-8"
                    onClick={e => { e.stopPropagation(); openProject(p); }}
                    data-testid={`button-open-${p.id}`}
                  >
                    <LayoutDashboard className="h-3.5 w-3.5 ml-1" />
                    {ar ? "فتح" : "Open"}
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-8 px-2"
                    title={ar ? "تصدير" : "Export"}
                    onClick={e => { e.stopPropagation(); nav(`/admin/projects/${p.id}/export`); }}
                    data-testid={`button-export-${p.id}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="outline" className="h-8 px-2"
                    title={ar ? "السجلات" : "Records"}
                    onClick={e => { e.stopPropagation(); nav(`/admin/projects/${p.id}/records`); }}
                    data-testid={`button-records-${p.id}`}
                  >
                    <Users className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{ar ? "تأكيد حذف المشروع" : "Delete Project"}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {ar ? <>هل أنت متأكد من حذف المشروع{" "}<strong>"{projects.find(p => p.id === deleteId)?.name}"</strong>؟<br />سيتم حذف <span className="text-red-500 font-semibold">جميع السجلات والبيانات</span> المرتبطة به نهائياً.</>
                 : <>Are you sure you want to delete <strong>"{projects.find(p => p.id === deleteId)?.name}"</strong>?<br />All <span className="text-red-500 font-semibold">records and data</span> will be permanently deleted.</>}
            </p>
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
