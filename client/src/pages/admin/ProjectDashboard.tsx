import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, TrendingUp, Calendar, Clock, Plus, ExternalLink,
  Settings, Download, BarChart2, PieChart as PieIcon, ArrowUpRight,
} from "lucide-react";
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
  "#6366f1","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#06b6d4","#f97316","#84cc16","#ec4899","#3b82f6",
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
    {
      label: isAr ? "إجمالي السجلات" : "Total Records",
      value: stats?.total ?? 0,
      icon: Users,
      gradient: "from-blue-500 to-indigo-600",
      bg: "bg-blue-50 dark:bg-blue-900/20",
      text: "text-blue-600 dark:text-blue-400",
      filter: "",
    },
    {
      label: isAr ? "هذا الشهر" : "This Month",
      value: stats?.month ?? 0,
      icon: Calendar,
      gradient: "from-violet-500 to-purple-600",
      bg: "bg-violet-50 dark:bg-violet-900/20",
      text: "text-violet-600 dark:text-violet-400",
      filter: "month",
    },
    {
      label: isAr ? "هذا الأسبوع" : "This Week",
      value: stats?.week ?? 0,
      icon: TrendingUp,
      gradient: "from-emerald-500 to-teal-600",
      bg: "bg-emerald-50 dark:bg-emerald-900/20",
      text: "text-emerald-600 dark:text-emerald-400",
      filter: "week",
    },
    {
      label: isAr ? "اليوم" : "Today",
      value: stats?.today ?? 0,
      icon: Clock,
      gradient: "from-orange-500 to-red-500",
      bg: "bg-orange-50 dark:bg-orange-900/20",
      text: "text-orange-600 dark:text-orange-400",
      filter: "today",
    },
  ];

  const distFields = distData?.fields || [];
  const barField = distFields[0];
  const pieField = distFields[1];
  const barData = barField ? (distData?.distributions[barField.key] || []) : [];
  const pieData = pieField ? (distData?.distributions[pieField.key] || []) : [];

  return (
    <Layout projectId={id}>
      <div className="space-y-6 max-w-5xl">

        {/* ─── Hero Header ─── */}
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 dark:from-slate-900 dark:to-slate-950 p-6 shadow-lg">
          {/* Decorative blobs */}
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-primary/10 blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-secondary/10 blur-3xl translate-y-1/2 -translate-x-1/4 pointer-events-none" />

          <div className="relative flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h1 className="text-2xl font-bold text-white">
                  {project?.name || <Skeleton className="h-7 w-48 bg-white/10" />}
                </h1>
                {project?.formEnabled ? (
                  <Badge className="bg-green-500/20 text-green-300 border border-green-400/30 gap-1.5 px-2.5 py-0.5 text-xs backdrop-blur-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                    {isAr ? "مباشر" : "Live"}
                  </Badge>
                ) : project ? (
                  <Badge className="bg-white/10 text-white/60 border border-white/20 text-xs">
                    {isAr ? "متوقف" : "Inactive"}
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-white/50">
                {(project as any)?.description || (isAr ? "لوحة تحكم المشروع" : "Project Dashboard")}
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(`/p/${id}/register`, "_blank")}
                data-testid="button-open-form"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm"
              >
                <ExternalLink className="h-3.5 w-3.5 ml-1" />
                {isAr ? "فتح النموذج" : "Open Form"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => nav(`/admin/projects/${id}/export`)}
                data-testid="button-export"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm"
              >
                <Download className="h-3.5 w-3.5 ml-1" />
                {isAr ? "تصدير" : "Export"}
              </Button>
              <Button
                size="sm"
                onClick={() => nav(`/admin/projects/${id}/records/new`)}
                data-testid="button-add-record"
                className="bg-primary hover:bg-primary/90 shadow-md"
              >
                <Plus className="h-3.5 w-3.5 ml-1" />
                {isAr ? "إضافة سجل" : "Add Record"}
              </Button>
            </div>
          </div>
        </div>

        {/* ─── Stat cards ─── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {isLoading
            ? [...Array(4)].map((_, i) => (
                <Card key={i} className="p-5 overflow-hidden">
                  <Skeleton className="h-10 w-10 rounded-xl mb-4" />
                  <Skeleton className="h-8 w-16 mb-1.5" />
                  <Skeleton className="h-3 w-24" />
                </Card>
              ))
            : statCards.map(card => (
                <Card
                  key={card.label}
                  className="p-5 cursor-pointer hover:shadow-md hover:border-primary/20 transition-all duration-200 overflow-hidden group relative"
                  data-testid={`stat-${card.label}`}
                  onClick={() => nav(`/admin/projects/${id}/records${card.filter ? `?period=${card.filter}` : ""}`)}
                >
                  {/* Subtle gradient accent top border */}
                  <div className={`absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r ${card.gradient} opacity-60 group-hover:opacity-100 transition-opacity`} />

                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${card.bg}`}>
                    <card.icon className={`h-5 w-5 ${card.text}`} />
                  </div>
                  <div className="text-3xl font-bold text-slate-800 dark:text-slate-100 leading-none mb-1">
                    {card.value.toLocaleString(isAr ? "ar-EG" : "en-US")}
                  </div>
                  <div className="text-xs text-muted-foreground">{card.label}</div>
                  <ArrowUpRight className="absolute bottom-4 left-4 h-4 w-4 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Card>
              ))}
        </div>

        {/* ─── Trend chart ─── */}
        {stats?.dailyTrend && stats.dailyTrend.length > 0 && (
          <Card className="p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {isAr ? "التسجيلات — آخر ١٤ يوم" : "Registrations — Last 14 Days"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAr ? "إجمالي السجلات اليومية" : "Daily record submissions"}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">
                <TrendingUp className="h-3.5 w-3.5" />
                {isAr ? "اتجاه" : "Trend"}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={stats.dailyTrend}>
                <defs>
                  <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={dateLabel} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                  formatter={(v: any) => [v, isAr ? "سجل" : "records"]}
                  labelFormatter={l => `${isAr ? "تاريخ" : "Date"}: ${l}`}
                />
                <Area type="monotone" dataKey="count" stroke="#6366f1" fill="url(#grad1)" strokeWidth={2.5} dot={{ r: 3, fill: "#6366f1", strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* ─── Distribution Charts ─── */}
        {(barData.length > 0 || pieData.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {barData.length > 0 && barField && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart2 className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {isAr ? `توزيع حسب: ${barField.label}` : `By: ${barField.label}`}
                  </h3>
                </div>
                <p className="text-[10px] text-muted-foreground mb-4">
                  {isAr ? "انقر على شريط لعرض السجلات المفلترة" : "Click a bar to filter records"}
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData} layout="vertical" margin={{ right: 16, left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="value" tick={{ fontSize: 10, textAnchor: "end" }} width={90} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: any) => [v, isAr ? "سجل" : "records"]}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} style={{ cursor: "pointer" }}
                      onClick={(d: any) => nav(`/admin/projects/${id}/records?filter=${encodeURIComponent(barField.key)}:${encodeURIComponent(d.value)}`)}>
                      {barData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {pieData.length > 0 && pieField && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <PieIcon className="h-4 w-4 text-violet-500" />
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {isAr ? `توزيع حسب: ${pieField.label}` : `By: ${pieField.label}`}
                  </h3>
                </div>
                <p className="text-[10px] text-muted-foreground mb-4">
                  {isAr ? "انقر على شريحة لعرض السجلات المفلترة" : "Click a slice to filter records"}
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="count" nameKey="value" cx="50%" cy="50%"
                      outerRadius={80} innerRadius={30}
                      label={({ value, percent }) => `${value} (${(percent * 100).toFixed(0)}%)`}
                      labelLine={false} style={{ cursor: "pointer" }}
                      onClick={(d: any) => nav(`/admin/projects/${id}/records?filter=${encodeURIComponent(pieField.key)}:${encodeURIComponent(d.value)}`)}>
                      {pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Legend iconSize={10} formatter={(v) => <span className="text-xs">{v}</span>} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: any) => [v, isAr ? "سجل" : "records"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            )}
          </div>
        )}

        {/* ─── Quick Actions ─── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Users,
              gradient: "from-blue-500 to-indigo-600",
              bg: "bg-blue-50 dark:bg-blue-900/20",
              text: "text-blue-600 dark:text-blue-400",
              title: isAr ? "عرض السجلات" : "View Records",
              sub: stats ? `${stats.total.toLocaleString()} ${isAr ? "سجل" : "records"}` : "—",
              action: () => nav(`/admin/projects/${id}/records`),
            },
            {
              icon: ExternalLink,
              gradient: "from-emerald-500 to-teal-600",
              bg: "bg-emerald-50 dark:bg-emerald-900/20",
              text: "text-emerald-600 dark:text-emerald-400",
              title: isAr ? "رابط التسجيل" : "Registration Link",
              sub: isAr ? "مشاركة النموذج العام" : "Share the public form",
              action: () => window.open(`/p/${id}/register`, "_blank"),
            },
            {
              icon: Settings,
              gradient: "from-violet-500 to-purple-600",
              bg: "bg-violet-50 dark:bg-violet-900/20",
              text: "text-violet-600 dark:text-violet-400",
              title: isAr ? "إعدادات المشروع" : "Project Settings",
              sub: "Google Sheets · Telegram",
              action: () => nav(`/admin/projects/${id}/settings`),
            },
          ].map((item, i) => (
            <Card
              key={i}
              className="p-5 cursor-pointer hover:shadow-md transition-all duration-200 group overflow-hidden relative"
              onClick={item.action}
            >
              <div className={`absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r ${item.gradient} opacity-50 group-hover:opacity-100 transition-opacity`} />
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${item.bg} group-hover:scale-105 transition-transform duration-200`}>
                  <item.icon className={`h-5 w-5 ${item.text}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.sub}</p>
                </div>
              </div>
              <ArrowUpRight className="absolute bottom-4 left-4 h-4 w-4 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
            </Card>
          ))}
        </div>

      </div>
    </Layout>
  );
}
