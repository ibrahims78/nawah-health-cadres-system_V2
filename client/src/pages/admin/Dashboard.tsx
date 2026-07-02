import { useQuery } from "@tanstack/react-query";
import { Users, Calendar, TrendingUp, BarChart3, Loader2, ArrowUpRight } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from "recharts";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLang } from "@/context/LanguageContext";
import { apiRequest } from "@/lib/queryClient";

const COLORS = ["#1a3cb3", "#0a7d6e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16"];

interface Stats {
  total: number;
  today: number;
  week: number;
  month: number;
  byGovernorate: { name: string; value: number }[];
  byGender: { name: string; value: number }[];
}

const STAT_CARDS = (stats: Stats | undefined, ar: boolean) => [
  {
    title: ar ? "إجمالي الكوادر" : "Total Staff",
    value: stats?.total ?? 0,
    icon: Users,
    color: "bg-primary",
    lightColor: "bg-primary/10 dark:bg-primary/20",
    textColor: "text-primary dark:text-blue-400",
    bar: "bg-primary",
  },
  {
    title: ar ? "مسجّل اليوم" : "Today",
    value: stats?.today ?? 0,
    icon: Calendar,
    color: "bg-secondary",
    lightColor: "bg-secondary/10 dark:bg-secondary/20",
    textColor: "text-secondary dark:text-teal-400",
    bar: "bg-secondary",
  },
  {
    title: ar ? "هذا الأسبوع" : "This Week",
    value: stats?.week ?? 0,
    icon: TrendingUp,
    color: "bg-amber-500",
    lightColor: "bg-amber-50 dark:bg-amber-900/20",
    textColor: "text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  {
    title: ar ? "هذا الشهر" : "This Month",
    value: stats?.month ?? 0,
    icon: BarChart3,
    color: "bg-violet-600",
    lightColor: "bg-violet-50 dark:bg-violet-900/20",
    textColor: "text-violet-600 dark:text-violet-400",
    bar: "bg-violet-600",
  },
];

function StatCard({
  title, value, icon: Icon, lightColor, textColor, bar, ar,
}: {
  title: string; value: number; icon: React.ElementType;
  color: string; lightColor: string; textColor: string; bar: string;
  ar: boolean;
}) {
  return (
    <Card className="relative overflow-hidden group hover:shadow-card-md transition-shadow duration-200">
      {/* Left accent bar */}
      <div className={`absolute inset-y-0 right-0 w-1 ${bar} rounded-s-none rounded-e-full`} />
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate mb-1">
              {title}
            </p>
            <p className="text-3xl font-black text-slate-800 dark:text-slate-100 tabular-nums">
              {value.toLocaleString(ar ? "ar-SY" : "en-US")}
            </p>
          </div>
          <div className={`p-3 rounded-2xl ${lightColor} transition-transform group-hover:scale-110 duration-200`}>
            <Icon className={`h-6 w-6 ${textColor}`} />
          </div>
        </div>
        <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
          <ArrowUpRight className="h-3 w-3 text-emerald-500" />
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{ar ? "محدّث" : "Updated"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

const CustomTooltip = ({ active, payload, label, ar }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-card-lg px-4 py-2.5">
        <p className="font-bold text-slate-800 dark:text-slate-200 text-sm">{label}</p>
        <p className="text-primary font-black text-lg">{payload[0].value.toLocaleString(ar ? "ar-SY" : "en-US")}</p>
      </div>
    );
  }
  return null;
};

export function Dashboard() {
  const { lang } = useLang();
  const ar = lang === "ar";

  const { data: stats, isLoading } = useQuery<Stats>({
    queryKey: ["admin-stats"],
    queryFn: () => apiRequest("GET", "/api/admin/stats"),
    refetchInterval: 60000,
  });

  if (isLoading) return (
    <Layout>
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground text-sm">{ar ? "جاري تحميل الإحصائيات..." : "Loading stats..."}</p>
      </div>
    </Layout>
  );

  const statCards = STAT_CARDS(stats, ar);

  return (
    <Layout>
      <div className="space-y-6 animate-fade-in">
        {/* Page header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100">
              {ar ? "لوحة الإحصائيات" : "Dashboard"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {ar ? "نظرة عامة على المشاريع والبيانات المسجّلة" : "Overview of projects and registered data"}
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              {ar ? "مباشر" : "Live"}
            </span>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map(c => (
            <StatCard key={c.title} {...c} ar={ar} />
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Governorate Bar Chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold">
                {ar ? "توزيع الكوادر حسب المحافظة" : "Staff by Governorate"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.byGovernorate && stats.byGovernorate.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={stats.byGovernorate}
                    margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 91%)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: ar ? "Cairo" : "Inter" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip ar={ar} />} cursor={{ fill: "hsl(210 40% 96%)", radius: 8 }} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-52 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <BarChart3 className="h-10 w-10 opacity-20" />
                  <p className="text-sm">{ar ? "لا توجد بيانات بعد" : "No data yet"}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Gender Pie Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold">
                {ar ? "توزيع الجنس" : "Gender Distribution"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.byGender && stats.byGender.some(g => g.value > 0) ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={stats.byGender}
                      cx="50%" cy="45%"
                      outerRadius={90}
                      innerRadius={45}
                      dataKey="value"
                      nameKey="name"
                      paddingAngle={3}
                    >
                      {stats.byGender.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString(ar ? "ar-SY" : "en-US"), ""]}
                      contentStyle={{
                        borderRadius: "12px",
                        border: "1px solid hsl(214 32% 91%)",
                        fontFamily: ar ? "Cairo" : "Inter",
                        fontSize: "13px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-52 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  <Users className="h-10 w-10 opacity-20" />
                  <p className="text-sm">{ar ? "لا توجد بيانات بعد" : "No data yet"}</p>
                </div>
              )}
              {/* Legend */}
              {stats?.byGender && stats.byGender.some(g => g.value > 0) && (
                <div className="flex flex-wrap justify-center gap-3 mt-2">
                  {stats.byGender.filter(g => g.value > 0).map((g, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      {g.name} ({g.value.toLocaleString(ar ? "ar-SY" : "en-US")})
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
