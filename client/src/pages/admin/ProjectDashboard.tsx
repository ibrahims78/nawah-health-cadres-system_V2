import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, Calendar, Clock, Plus, ExternalLink, Loader2, Settings, Download, BarChart2, PieChart as PieIcon } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, PieChart, Pie, Legend,
} from "recharts";
import type { Project } from "@shared/schema";
import { useLang } from "@/context/LanguageContext";

interface Stats {
  total: number; today: number; week: number; month: number;
  dailyTrend: { date: string; count: number }[];
}
interface DistData {
  distributions: Record<string, { value: string; count: number }[]>;
  fields: { key: string; label: string }[];
}

const CHART_COLORS = [
  "#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#84cc16","#ec4899","#6366f1",
];

const dateLabel = (d: string) => d.slice(5);

export function ProjectDashboard() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const { lang } = useLang();
  const isAr = lang === "ar";

  const { data: project } = useQuery<Project & { formEnabled?: boolean }>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["/api/projects", id, "stats"],
    queryFn: () => fetch(`/api/projects/${id}/stats`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: distData } = useQuery<DistData>({
    queryKey: ["/api/projects", id, "stats", "distributions"],
    queryFn: () => fetch(`/api/projects/${id}/stats/distributions`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  const statCards = [
    { label: isAr ? "إجمالي السجلات" : "Total Records", value: stats?.total ?? 0, icon: Users, color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20" },
    { label: isAr ? "هذا الشهر" : "This Month", value: stats?.month ?? 0, icon: Calendar, color: "text-purple-600 bg-purple-50 dark:bg-purple-900/20" },
    { label: isAr ? "هذا الأسبوع" : "This Week", value: stats?.week ?? 0, icon: TrendingUp, color: "text-green-600 bg-green-50 dark:bg-green-900/20" },
    { label: isAr ? "اليوم" : "Today", value: stats?.today ?? 0, icon: Clock, color: "text-orange-600 bg-orange-50 dark:bg-orange-900/20" },
  ];

  const distFields = distData?.fields || [];
  const barField = distFields[0];
  const pieField = distFields[1];
  const barData = barField ? (distData?.distributions[barField.key] || []) : [];
  const pieData = pieField ? (distData?.distributions[pieField.key] || []) : [];

  return (
    <Layout projectId={id}>
      <div className="space-y-6 max-w-5xl">

        {/* ─── Header ─── */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{project?.name || "..."}</h1>
              {project?.formEnabled && (
                <Badge className="bg-green-500 text-white gap-1.5 px-2 py-0.5 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse inline-block" />
                  {isAr ? "🟢 مباشر" : "🟢 Live"}
                </Badge>
              )}
              {project && !project.formEnabled && (
                <Badge variant="secondary" className="text-xs">{isAr ? "متوقف" : "Inactive"}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{(project as any)?.description || (isAr ? "لوحة تحكم المشروع" : "Project Dashboard")}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => window.open(`/p/${id}/register`, "_blank")} data-testid="button-open-form">
              <ExternalLink className="h-3.5 w-3.5 ml-1" />
              {isAr ? "فتح النموذج" : "Open Form"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => nav(`/admin/projects/${id}/export`)} data-testid="button-export">
              <Download className="h-3.5 w-3.5 ml-1" />
              {isAr ? "تصدير" : "Export"}
            </Button>
            <Button size="sm" onClick={() => nav(`/admin/projects/${id}/records/new`)} data-testid="button-add-record">
              <Plus className="h-3.5 w-3.5 ml-1" />
              {isAr ? "إضافة سجل" : "Add Record"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {/* ─── Stat cards ─── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map(card => (
                <Card key={card.label} className="p-4" data-testid={`stat-${card.label}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${card.color}`}>
                    <card.icon className="h-5 w-5" />
                  </div>
                  <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{card.value.toLocaleString(isAr ? "ar-EG" : "en-US")}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
                </Card>
              ))}
            </div>

            {/* ─── Trend chart ─── */}
            {stats?.dailyTrend && stats.dailyTrend.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4">📈 {isAr ? "التسجيلات خلال آخر 14 يوم" : "Registrations — Last 14 Days"}</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={stats.dailyTrend}>
                    <defs>
                      <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={dateLabel} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(v: any) => [v, isAr ? "سجل" : "records"]} labelFormatter={l => `${isAr ? "تاريخ" : "Date"}: ${l}`} />
                    <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#grad1)" strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* ─── Distribution Charts ─── */}
            {(barData.length > 0 || pieData.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {barData.length > 0 && barField && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                      <BarChart2 className="h-4 w-4 text-blue-500" />
                      {isAr ? `توزيع حسب: ${barField.label}` : `Distribution by: ${barField.label}`}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={barData} layout="vertical" margin={{ right: 16, left: 8 }}>
                        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                        <YAxis type="category" dataKey="value" tick={{ fontSize: 10, textAnchor: "end" }} width={90} />
                        <Tooltip formatter={(v: any) => [v, isAr ? "سجل" : "records"]} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {barData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                )}

                {pieData.length > 0 && pieField && (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                      <PieIcon className="h-4 w-4 text-purple-500" />
                      {isAr ? `توزيع حسب: ${pieField.label}` : `Distribution by: ${pieField.label}`}
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="count"
                          nameKey="value"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          label={({ value, percent }) => `${value} (${(percent * 100).toFixed(0)}%)`}
                          labelLine={false}
                        >
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Legend iconSize={10} formatter={(v) => <span className="text-xs">{v}</span>} />
                        <Tooltip formatter={(v: any) => [v, isAr ? "سجل" : "records"]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </Card>
                )}
              </div>
            )}

            {/* ─── Quick actions ─── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => nav(`/admin/projects/${id}/records`)}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{isAr ? "عرض السجلات" : "View Records"}</p>
                    <p className="text-xs text-muted-foreground">{stats?.total} {isAr ? "سجل مسجّل" : "records"}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => window.open(`/p/${id}/register`, "_blank")}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-900/20 flex items-center justify-center">
                    <ExternalLink className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{isAr ? "رابط التسجيل" : "Registration Link"}</p>
                    <p className="text-xs text-muted-foreground">{isAr ? "مشاركة النموذج العام" : "Share the public form"}</p>
                  </div>
                </div>
              </Card>
              <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => nav(`/admin/projects/${id}/settings`)}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                    <Settings className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{isAr ? "إعدادات المشروع" : "Project Settings"}</p>
                    <p className="text-xs text-muted-foreground">Google Sheets, Telegram</p>
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
