import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Download, FileSpreadsheet, FileText, Loader2,
  Filter, Columns, ChevronDown, ChevronUp, CheckSquare, Square, Calendar,
} from "lucide-react";
import { useState, useMemo } from "react";
import type { ProjectField } from "@shared/schema";
import { useLang } from "@/context/LanguageContext";

interface PreviewData { total: number; }

function smartDefault(projectName?: string, isAr?: boolean) {
  const now = new Date();
  const monthsAr = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const monthsEn = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const months = isAr ? monthsAr : monthsEn;
  return `${projectName || (isAr ? "بيانات" : "Data")}_${months[now.getMonth()]}${now.getFullYear()}`;
}

export function ProjectExport() {
  const { id } = useParams<{ id: string }>();
  const { lang } = useLang();
  const isAr = lang === "ar";

  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [exporting, setExporting] = useState(false);
  const [preset, setPreset] = useState("full");
  const [customCols, setCustomCols] = useState<string[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [fileName, setFileName] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sheetPerGroup, setSheetPerGroup] = useState(false);
  const [groupByField, setGroupByField] = useState("");

  const { data: fields = [] } = useQuery<ProjectField[]>({
    queryKey: ["/api/projects", id, "fields"],
    queryFn: () => fetch(`/api/projects/${id}/fields`, { credentials: "include" }).then(r => r.json()),
  });

  const { data: project } = useQuery<{ id: string; name: string; steps?: string[]; [k: string]: any }>({
    queryKey: ["/api/projects", id],
    queryFn: () => fetch(`/api/projects/${id}`, { credentials: "include" }).then(r => r.json()),
  });

  const visibleFields = useMemo(() => fields.filter(f => f.isVisible !== false), [fields]);
  const allKeys = useMemo(() => visibleFields.map(f => f.key), [visibleFields]);

  const steps: string[] = Array.isArray(project?.steps) ? project.steps : [];

  const groupedByStep = useMemo(() => {
    const g: Record<number, ProjectField[]> = {};
    for (const f of visibleFields) {
      const s = f.stepNumber || 1;
      if (!g[s]) g[s] = [];
      g[s].push(f);
    }
    return g;
  }, [visibleFields]);

  const stepNums = Object.keys(groupedByStep).map(Number).sort();

  const dynamicPresets = useMemo(() => {
    const base = [
      { id: "full", icon: "📋", label: isAr ? "كامل" : "Full", desc: isAr ? `جميع الحقول (${visibleFields.length})` : `All fields (${visibleFields.length})`, keys: allKeys },
    ];
    for (const s of stepNums) {
      const stepFields = groupedByStep[s] || [];
      const stepName = steps[s - 1] || (isAr ? `الخطوة ${s}` : `Step ${s}`);
      base.push({
        id: `step_${s}`,
        icon: `${s}️⃣`,
        label: stepName,
        desc: isAr ? `${stepFields.length} حقل` : `${stepFields.length} fields`,
        keys: stepFields.map(f => f.key),
      });
    }
    base.push({ id: "custom", icon: "⚙️", label: isAr ? "مخصص" : "Custom", desc: isAr ? "اختر الحقول يدوياً" : "Select fields manually", keys: [] });
    return base;
  }, [visibleFields, allKeys, stepNums, groupedByStep, steps, isAr]);

  const activePreset = dynamicPresets.find(p => p.id === preset);
  const activeCols = preset === "custom" ? customCols : (activePreset?.keys || allKeys);

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) p.set(`filter_${k}`, v); });
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return p.toString();
  }, [filters, dateFrom, dateTo]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  const { data: preview, isLoading: previewLoading } = useQuery<PreviewData>({
    queryKey: ["/api/projects", id, "export-preview", filterParams],
    queryFn: () =>
      fetch(`/api/projects/${id}/records?page=1&limit=1&${filterParams}`, { credentials: "include" })
        .then(r => r.json()).then(d => ({ total: d.total ?? 0 })),
    staleTime: 30_000,
  });

  const filterableFields = useMemo(() =>
    visibleFields.filter(f =>
      f.fieldType === "select" || f.fieldType === "radio" ||
      (Array.isArray(f.options) && (f.options as string[]).length > 0)
    ),
    [visibleFields]
  );

  const governorateField = useMemo(() =>
    visibleFields.find(f =>
      f.key.includes("governorate") || f.key.includes("محافظة") || f.label.includes("محافظة") || f.label.includes("المحافظة")
    ),
    [visibleFields]
  );

  const toggleCustomCol = (key: string) =>
    setCustomCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const addToFileName = (suffix: string) => {
    if (suffix) setFileName(prev => `${prev ? prev + "_" : ""}${suffix}`);
  };

  const doExport = async () => {
    if (activeCols.length === 0) { alert(isAr ? "اختر حقلاً واحداً على الأقل" : "Select at least one field"); return; }
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.set("format", format);
      params.set("filename", fileName || smartDefault(project?.name, isAr));
      params.set("columns", activeCols.join(","));
      if (sheetPerGroup && groupByField && format === "xlsx") params.set("groupBy", groupByField);
      Object.entries(filters).forEach(([k, v]) => { if (v) params.set(`filter_${k}`, v); });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/projects/${id}/export?${params}`, { credentials: "include" });
      if (!res.ok) { const e = await res.json().catch(() => ({ error: isAr ? "فشل التصدير" : "Export failed" })); throw new Error(e.error || (isAr ? "فشل" : "Failed")); }
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${fileName || smartDefault(project?.name, isAr)}.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Layout projectId={id}>
      <div className="max-w-3xl space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{isAr ? "📤 تصدير البيانات" : "📤 Export Data"}</h1>
          <p className="text-muted-foreground text-sm mt-1">{isAr ? "تصدير سجلات المشروع مع تحكم كامل في الفلاتر والأعمدة" : "Export project records with full control over filters and columns"}</p>
        </div>

        {/* ① File name */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
              {isAr ? "اسم الملف" : "File Name"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              placeholder={smartDefault(project?.name, isAr)}
              data-testid="input-filename"
              dir={isAr ? "rtl" : "ltr"}
            />
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">{isAr ? "أضف سريعاً:" : "Quick add:"}</span>
              <Button size="sm" variant="outline" onClick={() => {
                const now = new Date();
                addToFileName(`${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}`);
              }} data-testid="button-add-date">📅 {isAr ? "التاريخ" : "Date"}</Button>
              <Button size="sm" variant="outline"
                onClick={() => preview && addToFileName(`${preview.total}${isAr ? "سجل" : "records"}`)}
                disabled={previewLoading} data-testid="button-add-count">
                🔢 {isAr ? "عدد السجلات" : "Record Count"}
              </Button>
              {governorateField && (
                <Button size="sm" variant="outline"
                  onClick={() => addToFileName(isAr ? "المحافظة" : "Governorate")}
                  data-testid="button-add-governorate">
                  🗺️ {isAr ? "المحافظة" : "Governorate"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ② Filters + Date Range */}
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer select-none"
            onClick={() => setShowFilters(v => !v)}
          >
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-blue-600" />
                {isAr ? "فلترة السجلات" : "Filter Records"}
                {activeFilterCount > 0 && (
                  <Badge variant="secondary">{isAr ? `${activeFilterCount} فلتر نشط` : `${activeFilterCount} active filters`}</Badge>
                )}
              </span>
              {showFilters ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
          {showFilters && (
            <CardContent className="space-y-4">
              {/* Date range */}
              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {isAr ? "نطاق التاريخ" : "Date Range"}
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{isAr ? "من" : "From"}</Label>
                    <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-8 text-sm" data-testid="input-date-from" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">{isAr ? "إلى" : "To"}</Label>
                    <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-8 text-sm" data-testid="input-date-to" />
                  </div>
                </div>
              </div>

              {/* Field filters */}
              {filterableFields.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">{isAr ? "فلتر حسب القيمة" : "Filter by value"}</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filterableFields.map(f => {
                      const opts = (f.options as string[] | null) || [];
                      return (
                        <div key={f.key} className="space-y-1">
                          <Label className="text-xs">{f.label}</Label>
                          {opts.length > 0 ? (
                            <select
                              value={filters[f.key] || ""}
                              onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))}
                              className="w-full h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
                              data-testid={`filter-${f.key}`}
                            >
                              <option value="">{isAr ? "الكل" : "All"}</option>
                              {opts.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <Input value={filters[f.key] || ""} onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))} className="h-8 text-xs" data-testid={`filter-${f.key}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeFilterCount > 0 && (
                <Button size="sm" variant="ghost" className="text-red-500 h-7 text-xs"
                  onClick={() => { setFilters({}); setDateFrom(""); setDateTo(""); }}>
                  ✕ {isAr ? "مسح جميع الفلاتر" : "Clear all filters"}
                </Button>
              )}
            </CardContent>
          )}
        </Card>

        {/* ③ Column presets (dynamic from project steps) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Columns className="h-4 w-4 text-purple-600" />
              {isAr ? "الحقول المُصدَّرة" : "Exported Fields"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {dynamicPresets.map(p => (
                <button
                  key={p.id}
                  data-testid={`preset-${p.id}`}
                  onClick={() => {
                    setPreset(p.id);
                    if (p.id === "custom") {
                      setCustomCols(allKeys);
                      setShowCustom(true);
                    } else {
                      setShowCustom(false);
                    }
                  }}
                  className={`text-right p-3 rounded-xl border-2 transition-all text-sm ${
                    preset === p.id
                      ? "border-primary bg-primary/5 dark:bg-primary/10"
                      : "border-slate-200 dark:border-slate-700 hover:border-primary/40"
                  }`}
                >
                  <div className="font-semibold text-xs">{p.icon} {p.label}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>

            {/* Custom columns panel — grouped by step */}
            {preset === "custom" && showCustom && (
              <div className="border rounded-xl p-3 space-y-4 bg-slate-50 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{isAr ? `اختر الحقول (${customCols.length} / ${visibleFields.length})` : `Select fields (${customCols.length} / ${visibleFields.length})`}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCustomCols(allKeys)}>{isAr ? "تحديد الكل" : "Select All"}</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCustomCols([])}>{isAr ? "إلغاء الكل" : "Clear All"}</Button>
                  </div>
                </div>
                {stepNums.map(s => {
                  const stepFields = groupedByStep[s] || [];
                  const stepName = steps[s - 1] || (isAr ? `الخطوة ${s}` : `Step ${s}`);
                  const stepKeys = stepFields.map(f => f.key);
                  const allChecked = stepKeys.every(k => customCols.includes(k));
                  return (
                    <div key={s}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                          <span className="inline-flex w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold items-center justify-center">{s}</span>
                          {stepName}
                        </span>
                        <button
                          onClick={() => {
                            if (allChecked) setCustomCols(prev => prev.filter(k => !stepKeys.includes(k)));
                            else setCustomCols(prev => [...new Set([...prev, ...stepKeys])]);
                          }}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {allChecked ? (isAr ? "إلغاء تحديد الخطوة" : "Deselect Step") : (isAr ? "تحديد الخطوة" : "Select Step")}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {stepFields.map(f => (
                          <label key={f.key} className="flex items-center gap-2 text-xs cursor-pointer hover:text-primary select-none">
                            {customCols.includes(f.key)
                              ? <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />
                              : <Square className="h-3.5 w-3.5 text-slate-400 shrink-0" />}
                            <input type="checkbox" hidden checked={customCols.includes(f.key)} onChange={() => toggleCustomCol(f.key)} data-testid={`col-${f.key}`} />
                            <span className="truncate">{f.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {isAr ? "سيتم تصدير " : "Will export "}
              <span className="font-bold text-primary">{activeCols.length}</span>
              {isAr ? " حقل من أصل " : " fields out of "}
              {visibleFields.length}
            </p>
          </CardContent>
        </Card>

        {/* ④ Format */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-orange-500" />
              {isAr ? "صيغة التصدير" : "Export Format"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button data-testid="format-xlsx" onClick={() => setFormat("xlsx")}
                className={`p-4 rounded-xl border-2 text-right transition-all ${format === "xlsx" ? "border-green-500 bg-green-50 dark:bg-green-900/20" : "border-slate-200 dark:border-slate-700 hover:border-green-300"}`}>
                <div className="text-2xl mb-1">📗</div>
                <div className="font-semibold text-sm">Excel (.xlsx)</div>
                <div className="text-xs text-muted-foreground">{isAr ? "تنسيق احترافي وعناوين عربية" : "Professional format with localized headers"}</div>
              </button>
              <button data-testid="format-csv" onClick={() => setFormat("csv")}
                className={`p-4 rounded-xl border-2 text-right transition-all ${format === "csv" ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-700 hover:border-blue-300"}`}>
                <div className="text-2xl mb-1">📄</div>
                <div className="font-semibold text-sm">CSV (.csv)</div>
                <div className="text-xs text-muted-foreground">{isAr ? "UTF-8 مع BOM لدعم Excel العربي" : "UTF-8 with BOM for Excel compatibility"}</div>
              </button>
            </div>

            {format === "xlsx" && visibleFields.length > 0 && (
              <div className="space-y-3 border rounded-xl p-3 bg-slate-50 dark:bg-slate-800/40">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={sheetPerGroup} onChange={e => setSheetPerGroup(e.target.checked)} data-testid="check-sheet-per-group" className="accent-primary w-4 h-4" />
                  <div>
                    <div className="text-sm font-medium">{isAr ? "تجميع في Sheets منفصلة" : "Group into separate Sheets"}</div>
                    <div className="text-xs text-muted-foreground">{isAr ? "ورقة عمل منفصلة لكل قيمة في الحقل المحدد" : "A separate worksheet for each value in the selected field"}</div>
                  </div>
                </label>
                {sheetPerGroup && (
                  <div className="space-y-1 pr-7">
                    <Label className="text-xs">{isAr ? "التجميع حسب حقل" : "Group by field"}</Label>
                    <select value={groupByField} onChange={e => setGroupByField(e.target.value)}
                      className="w-full h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm"
                      data-testid="select-group-field">
                      <option value="">{isAr ? "اختر حقلاً..." : "Select a field..."}</option>
                      {visibleFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ⑤ Preview summary */}
        <Card className="border-2 border-primary/20 bg-primary/5 dark:bg-primary/10">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-base font-bold">📊 {isAr ? "ملخص التصدير" : "Export Summary"}</span>
              {previewLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>
            <div className="grid grid-cols-4 gap-3 text-center mb-5">
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm">
                <div className="text-2xl font-bold text-primary">
                  {previewLoading ? "…" : (preview?.total ?? 0).toLocaleString(isAr ? "ar-EG" : "en-US")}
                </div>
                <div className="text-xs text-muted-foreground">{isAr ? "إجمالي السجلات" : "Total Records"}</div>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm">
                <div className="text-2xl font-bold text-purple-600">{activeCols.length}</div>
                <div className="text-xs text-muted-foreground">{isAr ? "حقل مُصدَّر" : "Exported Fields"}</div>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm">
                <div className="text-2xl font-bold text-orange-500 uppercase">{format}</div>
                <div className="text-xs text-muted-foreground">{isAr ? "صيغة الملف" : "File Format"}</div>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl p-3 shadow-sm">
                <div className="text-2xl font-bold text-blue-600">{activeFilterCount}</div>
                <div className="text-xs text-muted-foreground">{isAr ? "فلتر نشط" : "Active Filters"}</div>
              </div>
            </div>

            <div className="text-sm bg-white dark:bg-slate-800 rounded-lg p-3 space-y-1.5 mb-4">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{isAr ? "اسم الملف:" : "File name:"}</span>
                <span className="font-mono font-medium">{(fileName || smartDefault(project?.name, isAr))}.{format}</span>
              </div>
              {(dateFrom || dateTo) && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{isAr ? "نطاق التاريخ:" : "Date range:"}</span>
                  <span className="font-medium">{dateFrom || "—"} → {dateTo || "—"}</span>
                </div>
              )}
              {sheetPerGroup && groupByField && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{isAr ? "التجميع حسب:" : "Group by:"}</span>
                  <span className="font-medium">{visibleFields.find(f => f.key === groupByField)?.label || groupByField}</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{isAr ? "الباقة:" : "Preset:"}</span>
                <span className="font-medium">{activePreset?.label || (isAr ? "كامل" : "Full")}</span>
              </div>
            </div>

            <Button className="w-full" size="lg" onClick={doExport} disabled={exporting || activeCols.length === 0} data-testid="button-export">
              {exporting
                ? <>{isAr ? "جاري التصدير..." : "Exporting..."}<Loader2 className="h-5 w-5 animate-spin ml-2" /></>
                : <>{isAr ? "تصدير الآن" : "Export Now"}<Download className="h-5 w-5 ml-2" /></>}
            </Button>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
