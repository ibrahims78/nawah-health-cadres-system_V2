import { useEffect } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { LanguageProvider, useLang } from "@/context/LanguageContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ProjectProvider } from "@/context/ProjectContext";
import { AppSettingsProvider } from "@/context/AppSettingsContext";
import { queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

import { Setup } from "@/pages/Setup";
import { AdminRegister } from "@/pages/AdminRegister";
import { Login } from "@/pages/admin/Login";
import { Projects } from "@/pages/admin/Projects";
import { CreateProject } from "@/pages/admin/CreateProject";
import { ProjectDashboard } from "@/pages/admin/ProjectDashboard";
import { ProjectRecords } from "@/pages/admin/ProjectRecords";
import { ProjectRecordDetails } from "@/pages/admin/ProjectRecordDetails";
import { ProjectRecordEdit } from "@/pages/admin/ProjectRecordEdit";
import { ProjectAddRecord } from "@/pages/admin/ProjectAddRecord";
import { ProjectExport } from "@/pages/admin/ProjectExport";
import { ProjectImport } from "@/pages/admin/ProjectImport";
import { ProjectSettings } from "@/pages/admin/ProjectSettings";
import { GlobalSettings } from "@/pages/admin/GlobalSettings";
import { ProjectRegister } from "@/pages/ProjectRegister";
import { ProjectEditForm } from "@/pages/ProjectEditForm";
import { ProjectParticipantForm } from "@/pages/ProjectParticipantForm";
import { ProjectParticipants } from "@/pages/admin/ProjectParticipants";
import { Toaster } from "@/components/ui/toaster";

const ROLE_LEVEL: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };

function ProtectedRoute({ children, minRole = "viewer" }: { children: React.ReactNode; minRole?: "admin" | "editor" | "viewer" }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-10 w-10 animate-spin text-primary" /></div>;
  if (!user) return <Redirect to="/admin/login" />;
  if ((ROLE_LEVEL[user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) return <Redirect to="/admin/projects" />;
  return <>{children}</>;
}

function NotFound() {
  const { lang } = useLang();
  const isAr = lang === "ar";
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-200 dark:text-slate-700 mb-4">404</h1>
        <p className="text-slate-500">{isAr ? "الصفحة غير موجودة" : "Page not found"}</p>
        <a href="/admin/projects" className="mt-4 inline-block text-primary hover:underline">{isAr ? "العودة للمشاريع" : "Back to projects"}</a>
      </div>
    </div>
  );
}

function SetupCheck({ children }: { children: React.ReactNode }) {
  const [location, nav] = useLocation();
  useEffect(() => {
    if (location === "/setup") return;
    fetch("/api/auth/setup-required", { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (d.required) nav("/setup"); })
      .catch(err => console.error("[SetupCheck] failed to check setup status:", err));
  }, []);
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <SetupCheck>
      <Switch>
        {/* Public */}
        <Route path="/" component={() => <Redirect to="/admin/login" />} />
        <Route path="/setup" component={Setup} />
        <Route path="/admin/register/:token" component={AdminRegister} />
        <Route path="/admin/login" component={Login} />
        <Route path="/admin" component={() => <Redirect to="/admin/projects" />} />
        <Route path="/admin/dashboard" component={() => <Redirect to="/admin/projects" />} />

        {/* Public project forms */}
        <Route path="/p/:projectId/register" component={ProjectRegister} />
        <Route path="/p/:projectId/edit/:token" component={ProjectEditForm} />
        <Route path="/p/:projectId/p/:token" component={ProjectParticipantForm} />

        {/* Admin — Projects list */}
        <Route path="/admin/projects">
          <ProtectedRoute><Projects /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/new">
          <ProtectedRoute minRole="editor"><CreateProject /></ProtectedRoute>
        </Route>

        {/* Admin — Project scoped pages */}
        <Route path="/admin/projects/:id/dashboard">
          <ProtectedRoute><ProjectDashboard /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/records/new">
          <ProtectedRoute minRole="editor"><ProjectAddRecord /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/records/:recordId/edit">
          <ProtectedRoute minRole="editor"><ProjectRecordEdit /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/records/:recordId">
          <ProtectedRoute><ProjectRecordDetails /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/records">
          <ProtectedRoute><ProjectRecords /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/export">
          <ProtectedRoute><ProjectExport /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/import">
          <ProtectedRoute minRole="editor"><ProjectImport /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/settings">
          <ProtectedRoute minRole="editor"><ProjectSettings /></ProtectedRoute>
        </Route>
        <Route path="/admin/projects/:id/participants">
          <ProtectedRoute minRole="editor"><ProjectParticipants /></ProtectedRoute>
        </Route>

        {/* Global settings */}
        <Route path="/admin/settings">
          <ProtectedRoute minRole="admin"><GlobalSettings /></ProtectedRoute>
        </Route>

        <Route component={NotFound} />
      </Switch>
    </SetupCheck>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <LanguageProvider>
          <AppSettingsProvider>
            <AuthProvider>
              <ProjectProvider>
                <AppRoutes />
                <Toaster />
              </ProjectProvider>
            </AuthProvider>
          </AppSettingsProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
