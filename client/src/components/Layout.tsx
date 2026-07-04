import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard, Users, Download, Settings, LogOut,
  Menu, ChevronLeft, ChevronRight, FolderKanban, Plus,
  ChevronDown, Activity, Globe, Search,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageToggle } from "./LanguageToggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useProject } from "@/context/ProjectContext";
import { useLang } from "@/context/LanguageContext";
import { useAppSettings } from "@/context/AppSettingsContext";
import { cn } from "@/lib/utils";
import { DesignerCredit } from "@/components/DesignerCredit";
import type { Project } from "@shared/schema";

interface LayoutProps {
  children: React.ReactNode;
  projectId?: string;
}

export function Layout({ children, projectId }: LayoutProps) {
  const [location, nav] = useLocation();
  const { user, logout } = useAuth();
  const { currentProject, setCurrentProject, projects } = useProject();
  const { lang } = useLang();
  const { appName } = useAppSettings();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");

  const activeProject = projectId ? projects.find(p => p.id === projectId) || currentProject : currentProject;

  const filteredProjects = useMemo(() => {
    if (!projectSearch.trim()) return projects;
    const q = projectSearch.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(q));
  }, [projects, projectSearch]);

  const handleLogout = async () => { await logout(); nav("/admin/login"); };
  const isAr = lang === "ar";

  const projectNav = activeProject ? [
    { href: `/admin/projects/${activeProject.id}/dashboard`, icon: LayoutDashboard, label: "الرئيسية", labelEn: "Dashboard" },
    { href: `/admin/projects/${activeProject.id}/records`, icon: Users, label: "السجلات", labelEn: "Records" },
    { href: `/admin/projects/${activeProject.id}/export`, icon: Download, label: "التصدير", labelEn: "Export" },
    { href: `/admin/projects/${activeProject.id}/settings`, icon: Settings, label: "إعدادات المشروع", labelEn: "Project Settings" },
  ] : [];

  const globalNav = [
    { href: "/admin/projects", icon: FolderKanban, label: "المشاريع", labelEn: "Projects" },
    { href: "/admin/settings", icon: Globe, label: "الإعدادات العامة", labelEn: "Global Settings", adminOnly: true },
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Brand */}
      <div className={cn("flex items-center gap-3 px-4 py-4 border-b border-slate-200 dark:border-slate-700/80 flex-shrink-0 group/brand", !sidebarOpen && "justify-center px-2")}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0 shadow-md">
          <Activity className="h-5 w-5 text-white" />
        </div>
        <div className={cn(
          "min-w-0 flex-1 transition-all duration-300",
          sidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0 overflow-hidden"
        )}>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate leading-tight whitespace-nowrap">{appName}</p>
          <p className="text-[10px] text-muted-foreground whitespace-nowrap">{isAr ? "منصة إدارة نماذج التسجيل" : "Forms & Data Platform"}</p>
        </div>
        {/* Toggle button — visible on hover */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          data-testid="button-toggle-sidebar"
          className={cn(
            "flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center",
            "text-slate-400 hover:text-primary hover:bg-primary/10 transition-all duration-150",
            sidebarOpen ? "opacity-0 group-hover/brand:opacity-100" : "opacity-100"
          )}
          title={sidebarOpen ? (isAr ? "طي القائمة" : "Collapse") : (isAr ? "توسيع القائمة" : "Expand")}
        >
          {sidebarOpen
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Project Picker */}
      {sidebarOpen && activeProject && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700/80 flex-shrink-0">
          <p className="text-[10px] text-muted-foreground font-semibold mb-1 px-1">{isAr ? "المشروع الحالي" : "Current Project"}</p>
          <button
            onClick={() => setProjectPickerOpen(!projectPickerOpen)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-primary/10 dark:bg-primary/20 hover:bg-primary/15 transition-colors text-right"
          >
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">{activeProject.name[0]}</span>
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate flex-1">{activeProject.name}</span>
            <ChevronDown className={cn("h-3 w-3 text-slate-400 transition-transform flex-shrink-0", projectPickerOpen && "rotate-180")} />
          </button>

          {projectPickerOpen && (
            <div className="mt-1 bg-white dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 shadow-lg overflow-hidden">
              {projects.length > 4 && (
                <div className="p-2 border-b border-slate-100 dark:border-slate-600">
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600">
                    <Search className="h-3 w-3 text-slate-400 flex-shrink-0" />
                    <input
                      value={projectSearch}
                      onChange={e => setProjectSearch(e.target.value)}
                      placeholder={isAr ? "بحث..." : "Search..."}
                      className="flex-1 text-xs bg-transparent outline-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                      data-testid="input-project-search"
                      autoFocus
                    />
                  </div>
                </div>
              )}
              {filteredProjects.map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    setCurrentProject(p);
                    nav(`/admin/projects/${p.id}/dashboard`);
                    setProjectPickerOpen(false);
                    setProjectSearch("");
                    setMobileOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors text-right",
                    p.id === activeProject.id && "bg-primary/10 dark:bg-primary/20 font-semibold"
                  )}
                >
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-primary/60 to-secondary/60 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-[9px] font-bold">{p.name[0]}</span>
                  </div>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              {user?.role !== "viewer" && (
                <button
                  onClick={() => { nav("/admin/projects/new"); setProjectPickerOpen(false); setMobileOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-primary hover:bg-primary/5 border-t border-slate-100 dark:border-slate-600"
                >
                  <Plus className="h-3 w-3" />
                  <span>{isAr ? "مشروع جديد" : "New Project"}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {/* Project nav */}
        {activeProject && projectNav.filter(item => !("adminOnly" in item) || !item.adminOnly || user?.role === "admin").map(item => {
          const isActive = location === item.href || location.startsWith(item.href + "/");
          return (
            <button
              key={item.href}
              onClick={() => { nav(item.href); setMobileOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150",
                isActive ? "bg-primary text-white shadow-sm" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-slate-100",
                !sidebarOpen && "justify-center px-2"
              )}
              title={!sidebarOpen ? (isAr ? item.label : item.labelEn) : undefined}
              data-testid={`nav-${item.href.split("/").pop()}`}
            >
              <item.icon className="h-[18px] w-[18px] flex-shrink-0" />
              {sidebarOpen && <span>{isAr ? item.label : item.labelEn}</span>}
            </button>
          );
        })}

        {/* Divider */}
        {activeProject && sidebarOpen && <div className="h-px bg-slate-200 dark:border-slate-700 my-2 mx-1" />}

        {/* Global nav */}
        {globalNav.filter(item => !("adminOnly" in item) || !item.adminOnly || user?.role === "admin").map(item => {
          const isActive = location === item.href || location.startsWith(item.href);
          return (
            <button
              key={item.href}
              onClick={() => { nav(item.href); setMobileOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150",
                isActive ? "bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/60 hover:text-slate-700 dark:hover:text-slate-300",
                !sidebarOpen && "justify-center px-2"
              )}
              title={!sidebarOpen ? (isAr ? item.label : item.labelEn) : undefined}
              data-testid={`nav-${item.href.split("/").pop()}`}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {sidebarOpen && <span>{isAr ? item.label : item.labelEn}</span>}
            </button>
          );
        })}
      </nav>

      {/* User section */}
      <div className={cn("p-3 border-t border-slate-200 dark:border-slate-700/80 flex-shrink-0", !sidebarOpen && "flex justify-center")}>
        {sidebarOpen ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-700/40">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary/80 to-secondary/80 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-bold">{user?.fullName?.[0] || "م"}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate leading-tight">{user?.fullName}</p>
                <p className="text-[10px] text-muted-foreground">{user?.role === "admin" ? (isAr ? "مدير" : "Admin") : user?.role === "editor" ? (isAr ? "محرر" : "Editor") : (isAr ? "مشاهد" : "Viewer")}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout}
              className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 font-semibold"
              data-testid="button-logout">
              <LogOut className="h-3.5 w-3.5 ml-2" />
              {isAr ? "تسجيل خروج" : "Logout"}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="icon" onClick={handleLogout} title={isAr ? "تسجيل خروج" : "Logout"} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        )}
        {sidebarOpen && <DesignerCredit />}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-900/95">
      {/* Desktop Sidebar */}
      <aside className={cn(
        "hidden md:flex flex-col flex-shrink-0 bg-white dark:bg-slate-800 border-l border-slate-200 dark:border-slate-700/80 relative shadow-sm",
        "transition-[width] duration-300 ease-in-out overflow-hidden",
        sidebarOpen ? "w-60" : "w-[60px]"
      )}>
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 bg-white dark:bg-slate-800 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-700">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700/80 px-4 py-2.5 flex items-center justify-between flex-shrink-0 shadow-sm">
          <button onClick={() => setMobileOpen(true)} className="md:hidden p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700" data-testid="button-mobile-menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            {activeProject && <span className="font-semibold text-slate-700 dark:text-slate-300">{activeProject.name}</span>}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
