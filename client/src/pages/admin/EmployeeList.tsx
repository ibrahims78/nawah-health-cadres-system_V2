import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Search, Eye, Edit, Trash2, ChevronLeft, ChevronRight,
  Loader2, CheckSquare, Square, Users, Copy, Check,
  SlidersHorizontal, Columns3, X, ChevronsLeft, ChevronsRight,
  Printer, Filter, UserPlus, TableProperties, AlertCircle,
  Download, RefreshCw, CheckCircle2, XCircle, ArrowDownToLine,
  Minus, Plus, SkipForward,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  sequentialNumber: number;
  orgLevel1?: string; orgClassification?: string;
  orgLevel2?: string; orgLevel3?: string; orgLevel4?: string; orgLevel5?: string;
  workGovernorate?: string; employeeRefId?: string; jobTitle?: string;
  birthDate?: string; workStartDate?: string; permanentDate?: string; contractDate?: string;
  firstName: string; fatherName?: string; familyName: string; motherFullName?: string;
  nationalId: string; gender?: string; mobile?: string;
  residenceArea?: string; residenceDetail?: string; maritalStatus?: string;
  jobCategory?: string; employmentStatus?: string; appointmentPattern?: string; mergeDetails?: string;
  hasDisability?: string; disabilityType?: string; disabilityCard?: string;
  registryNumber?: string; registryPlace?: string; birthCountry?: string;
  governorate?: string; cityDistrict?: string; subDistrict?: string;
  lastQualification?: string; status?: string; statusDetail?: string;
  shamCashAccount?: string; childrenCount?: number; wivesCount?: number; centralNotes?: string;
  submittedAt?: string; updatedAt?: string;
}

interface EmployeesResponse {
  data: Employee[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_BADGE: Record<string, string> = {
  "نشط": "success", "إجازة": "warning", "منتدب": "secondary",
  "متوفى": "outline", "مفصول": "destructive",
};
const STATUS_ROW: Record<string, string> = {
  "نشط": "border-r-2 border-r-emerald-400 dark:border-r-emerald-500",
  "إجازة": "border-r-2 border-r-amber-400 dark:border-r-amber-500",
  "منتدب": "border-r-2 border-r-blue-400 dark:border-r-blue-500",
  "متوفى": "border-r-2 border-r-slate-300 dark:border-r-slate-500 opacity-70",
  "مفصول": "border-r-2 border-r-red-400 dark:border-r-red-500",
};

const GOVERNORATES = ["دمشق","ريف دمشق","حلب","حمص","حماة","اللاذقية","طرطوس","درعا","السويداء","القنيطرة","دير الزور","الرقة","الحسكة","إدلب"];
const GOVERNORATES_EN = ["Damascus", "Rif Dimashq", "Aleppo", "Homs", "Hama", "Latakia", "Tartus", "Daraa", "Sweida", "Quneitra", "Deir ez-Zor", "Raqqa", "Hasakah", "Idlib"];
const JOB_CATEGORIES = ["طبيب","صيدلاني","ممرض","مساعد طبيب","فني","إداري","تمريض","دعم صحي","أخرى"];
const JOB_CATEGORIES_EN = ["Doctor", "Pharmacist", "Nurse", "Physician Assistant", "Technician", "Administrative", "Nursing", "Health Support", "Other"];

const ALL_COLS = [
  { key: "seq",             label: "م",                    labelEn: "#",                   always: true  },
  { key: "fullName",        label: "الاسم الثلاثي",         labelEn: "Full Name",           always: true  },
  { key: "nationalId",      label: "الرقم الوطني",          labelEn: "National ID",         def: true     },
  { key: "workGovernorate", label: "محافظة العمل",           labelEn: "Work Governorate",    def: true     },
  { key: "jobTitle",        label: "مسمى العمل",             labelEn: "Job Title",           def: true     },
  { key: "jobCategory",     label: "الفئة الوظيفية",         labelEn: "Job Category",        def: true     },
  { key: "employmentStatus",label: "مثبت أو متعاقد",         labelEn: "Employment Status",   def: true     },
  { key: "status",          label: "الحالة",                 labelEn: "Status",              always: true  },
  { key: "birthDate",       label: "تاريخ التولد",           labelEn: "Birth Date",          def: false    },
  { key: "gender",          label: "الجنس",                  labelEn: "Gender",              def: false    },
  { key: "mobile",          label: "رقم الجوال",             labelEn: "Mobile",              def: false    },
  { key: "employeeRefId",   label: "الرقم الذاتي",           labelEn: "Ref. ID",             def: false    },
  { key: "maritalStatus",   label: "الوضع العائلي",          labelEn: "Marital Status",      def: false    },
  { key: "lastQualification",label: "آخر مؤهل",              labelEn: "Last Qualification",  def: false    },
  { key: "submittedAt",     label: "تاريخ التسجيل",          labelEn: "Registered At",       def: false    },
];

function highlight(text: string, term: string) {
  if (!term || !text) return <>{text}</>;
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <>{parts.map((p, i) => parts.length > 1 && i % 2 === 1
    ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/70 rounded-sm px-0.5">{p}</mark>
    : p)}</>;
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
      <dd className="text-sm font-medium text-slate-800 dark:text-slate-200">{value || <span className="text-slate-300 dark:text-slate-600">—</span>}</dd>
    </div>
  );
}

function EmployeeDetailDialog({ emp, open, onClose, onEdit, isAdmin, ar }: {
  emp: Employee | null; open: boolean; onClose: () => void;
  onEdit: () => void; isAdmin: boolean; ar: boolean;
}) {
  if (!emp) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-3 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {emp.firstName} {emp.fatherName} {emp.familyName}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ar ? "م" : "#"}: {emp.sequentialNumber} | {emp.nationalId}
                {emp.employeeRefId && ` | ${ar ? "الرقم الذاتي" : "Ref. ID"}: ${emp.employeeRefId}`}
              </p>
            </div>
            {emp.status && <Badge variant={(STATUS_BADGE[emp.status] || "outline") as any}>{ar ? emp.status : emp.status}</Badge>}
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1">
          <Tabs defaultValue="org">
            <TabsList className="w-full grid grid-cols-4 sticky top-0 bg-white dark:bg-slate-800 z-10">
              <TabsTrigger value="org">{ar ? "التنظيمية" : "Org"}</TabsTrigger>
              <TabsTrigger value="personal">{ar ? "الشخصية" : "Personal"}</TabsTrigger>
              <TabsTrigger value="residence">{ar ? "الإقامة والقيد" : "Residence"}</TabsTrigger>
              <TabsTrigger value="qual">{ar ? "المؤهلات" : "Qualifications"}</TabsTrigger>
            </TabsList>

            <TabsContent value="org" className="p-4 space-y-0">
              <dl>
                <DetailRow label={ar ? "المستوى التنظيمي الاول"    : "Org Level 1"}         value={emp.orgLevel1} />
                <DetailRow label={ar ? "التصنيف/ الجهة المرتبطة"   : "Classification"}       value={emp.orgClassification} />
                <DetailRow label={ar ? "المستوى التنظيمي الثاني"   : "Org Level 2"}          value={emp.orgLevel2} />
                <DetailRow label={ar ? "المستوى التنظيمي الثالث"   : "Org Level 3"}          value={emp.orgLevel3} />
                <DetailRow label={ar ? "المستوى التنظيمي الرابع"   : "Org Level 4"}          value={emp.orgLevel4} />
                <DetailRow label={ar ? "المستوى التنظيمي الخامس"   : "Org Level 5"}          value={emp.orgLevel5} />
                <DetailRow label={ar ? "محافظة العمل"               : "Work Governorate"}    value={emp.workGovernorate} />
                <DetailRow label={ar ? "الرقم الذاتي"               : "Ref. ID"}             value={emp.employeeRefId} />
                <DetailRow label={ar ? "مسمى العمل"                 : "Job Title"}           value={emp.jobTitle} />
                <DetailRow label={ar ? "تاريخ التولد"               : "Birth Date"}          value={emp.birthDate} />
                <DetailRow label={ar ? "تاريخ بدء العمل بالدولة"   : "Work Start Date"}     value={emp.workStartDate} />
                <DetailRow label={ar ? "تاريخ التثبيت في الدولة"   : "Permanent Date"}      value={emp.permanentDate} />
                <DetailRow label={ar ? "تاريخ التعاقد في الدولة"   : "Contract Date"}       value={emp.contractDate} />
                <DetailRow label={ar ? "الفئة الوظيفية"             : "Job Category"}        value={emp.jobCategory} />
                <DetailRow label={ar ? "مثبت أو متعاقد"             : "Employment Status"}   value={emp.employmentStatus} />
                <DetailRow label={ar ? "نمط التعيين أو التعاقد"    : "Appointment Pattern"} value={emp.appointmentPattern} />
                <DetailRow label={ar ? "تفاصيل دمج"                 : "Merge Details"}       value={emp.mergeDetails} />
              </dl>
            </TabsContent>

            <TabsContent value="personal" className="p-4 space-y-0">
              <dl>
                <DetailRow label={ar ? "الاسم"           : "First Name"}     value={emp.firstName} />
                <DetailRow label={ar ? "اسم الأب"        : "Father's Name"}  value={emp.fatherName} />
                <DetailRow label={ar ? "النسبة"          : "Family Name"}    value={emp.familyName} />
                <DetailRow label={ar ? "اسم الأم الكامل" : "Mother's Name"}  value={emp.motherFullName} />
                <DetailRow label={ar ? "الرقم الوطني"    : "National ID"}    value={emp.nationalId} />
                <DetailRow label={ar ? "الجنس"           : "Gender"}         value={emp.gender} />
                <DetailRow label={ar ? "الوضع العائلي"   : "Marital Status"} value={emp.maritalStatus} />
                <DetailRow label={ar ? "عدد الأبناء"     : "Children Count"} value={emp.childrenCount} />
                <DetailRow label={ar ? "عدد الزوجات"     : "Wives Count"}    value={emp.wivesCount} />
                <DetailRow label={ar ? "رقم الجوال"      : "Mobile"}         value={emp.mobile} />
              </dl>
            </TabsContent>

            <TabsContent value="residence" className="p-4 space-y-0">
              <dl>
                <DetailRow label={ar ? "منطقة السكن"      : "Residence Area"}   value={emp.residenceArea} />
                <DetailRow label={ar ? "تفصيل مكان السكن" : "Residence Detail"} value={emp.residenceDetail} />
                <DetailRow label={ar ? "رقم القيد"         : "Registry Number"}  value={emp.registryNumber} />
                <DetailRow label={ar ? "مكان القيد"        : "Registry Place"}   value={emp.registryPlace} />
                <DetailRow label={ar ? "دولة الولادة"      : "Birth Country"}    value={emp.birthCountry} />
                <DetailRow label={ar ? "المحافظة"          : "Governorate"}      value={emp.governorate} />
                <DetailRow label={ar ? "المنطقة_المدينة"   : "City/District"}    value={emp.cityDistrict} />
                <DetailRow label={ar ? "الناحية"           : "Sub-District"}     value={emp.subDistrict} />
              </dl>
            </TabsContent>

            <TabsContent value="qual" className="p-4 space-y-0">
              <dl>
                <DetailRow label={ar ? "آخر مؤهل علمي معين على أساسه" : "Last Qualification"}  value={emp.lastQualification} />
                <DetailRow label={ar ? "هل لديك إعاقة"               : "Has Disability"}        value={emp.hasDisability} />
                <DetailRow label={ar ? "نوع الإعاقة"                 : "Disability Type"}        value={emp.disabilityType} />
                <DetailRow label={ar ? "بطاقة الإعاقة"               : "Disability Card"}        value={emp.disabilityCard} />
                <DetailRow label={ar ? "الحالة"                       : "Status"}                value={emp.status} />
                <DetailRow label={ar ? "تفصيل الحالة"                 : "Status Detail"}         value={emp.statusDetail} />
                <DetailRow label={ar ? "حساب شام كاش"                 : "Sham Cash Account"}     value={emp.shamCashAccount} />
                <DetailRow label={ar ? "ملاحظات مركزية"               : "Central Notes"}         value={emp.centralNotes} />
                <DetailRow label={ar ? "تاريخ التسجيل"                : "Registered At"}
                  value={emp.submittedAt ? new Date(emp.submittedAt).toLocaleDateString(ar ? "ar-SY" : "en-GB") : undefined} />
              </dl>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="pt-3 border-t border-slate-100 dark:border-slate-700 gap-2 flex-row">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4 ml-1" /> {ar ? "طباعة" : "Print"}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={onEdit}>
              <Edit className="h-4 w-4 ml-1" /> {ar ? "تعديل" : "Edit"}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="mr-auto">{ar ? "إغلاق" : "Close"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmployeeList() {
  const { lang } = useLang();
  const { user } = useAuth();
  const [, nav] = useLocation();
  const ar = lang === "ar";
  const isAdmin = user?.role === "admin" || user?.role === "editor";

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [qGender, setQGender] = useState("");
  const [qStatus, setQStatus] = useState("");
  const [qGov, setQGov] = useState("");
  const [qEmpStatus, setQEmpStatus] = useState("");
  const [advOpen, setAdvOpen] = useState(false);
  const [advJobCat, setAdvJobCat] = useState("");
  const [advOrg1, setAdvOrg1] = useState("");

  const [visibleCols, setVisibleCols] = useState<string[]>(
    ALL_COLS.filter(c => c.always || c.def).map(c => c.key)
  );
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [viewEmp, setViewEmp] = useState<Employee | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedFormLink, setCopiedFormLink] = useState(false);
  const [jumpPage, setJumpPage] = useState("");

  // حالة تصحيح ترويسات الـ Sheet — تُحفظ في localStorage
  const HEADERS_KEY = "masar_headers_fixed";
  const [headersFixed, setHeadersFixed] = useState<null | boolean>(() => {
    const v = localStorage.getItem(HEADERS_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  });
  const [fixingHeaders, setFixingHeaders] = useState(false);

  const handleFixHeaders = async () => {
    setFixingHeaders(true);
    try {
      const result = await apiRequest("POST", "/api/settings/fix-sheet-headers");
      const ok = result?.ok === true;
      setHeadersFixed(ok);
      localStorage.setItem(HEADERS_KEY, String(ok));
    } catch {
      setHeadersFixed(false);
      localStorage.setItem(HEADERS_KEY, "false");
    } finally {
      setFixingHeaders(false);
    }
  };

  // ─── حالة استيراد Google Sheets ───
  const IMPORT_KEY = "masar_import_status";
  interface ImportResult { inserted: number; updated: number; skipped: number; deleted: number; total: number; }
  const [importStatus, setImportStatus] = useState<null | "success" | "error">(() => {
    const v = localStorage.getItem(IMPORT_KEY);
    return v === "success" ? "success" : v === "error" ? "error" : null;
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [syncDeletes, setSyncDeletes] = useState(false);

  const handleImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      const result: ImportResult = await apiRequest("POST", "/api/admin/import-from-sheets", { syncDeletes });
      setImportResult(result);
      setImportStatus("success");
      localStorage.setItem(IMPORT_KEY, "success");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setImportDialogOpen(true);
    } catch (err: any) {
      setImportError(err?.message || (ar ? "فشل الاستيراد" : "Import failed"));
      setImportStatus("error");
      localStorage.setItem(IMPORT_KEY, "error");
      setImportDialogOpen(true);
    } finally {
      setImporting(false);
    }
  };

  const debounce = useCallback((val: string) => {
    setSearch(val);
    clearTimeout((window as any)._st);
    (window as any)._st = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 350);
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (debouncedSearch) p.set("search", debouncedSearch);
    if (qGender && qGender !== "all") p.set("gender", qGender);
    if (qStatus && qStatus !== "all") p.set("status", qStatus);
    if (qGov && qGov !== "all") p.set("governorate", qGov);
    if (qEmpStatus && qEmpStatus !== "all") p.set("employmentStatus", qEmpStatus);
    if (advJobCat && advJobCat !== "all") p.set("jobCategory", advJobCat);
    if (advOrg1) p.set("orgLevel1", advOrg1);
    return p;
  }, [page, limit, debouncedSearch, qGender, qStatus, qGov, qEmpStatus, advJobCat, advOrg1]);

  const { data, isLoading } = useQuery<EmployeesResponse>({
    queryKey: ["employees", params.toString()],
    queryFn: () => apiRequest("GET", `/api/admin/employees?${params}`),
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 1;
  const startRow = data ? (page - 1) * limit + 1 : 0;
  const endRow = data ? Math.min(page * limit, data.total) : 0;

  const activeFilterCount = [qGender, qStatus, qGov, qEmpStatus, advJobCat, advOrg1]
    .filter(f => f && f !== "all").length;

  const clearAllFilters = () => {
    setQGender(""); setQStatus(""); setQGov(""); setQEmpStatus("");
    setAdvJobCat(""); setAdvOrg1(""); setPage(1);
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/admin/employees/${id}`);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setDeleteId(null);
    } catch (err: any) { alert(err.message); }
    finally { setDeleting(false); }
  };

  const handleBulkDelete = async () => {
    if (!selected.length || !confirm(ar ? `حذف ${selected.length} سجل؟` : `Delete ${selected.length} records?`)) return;
    try {
      await apiRequest("POST", "/api/admin/employees/bulk-delete", { ids: selected });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setSelected([]);
    } catch (err: any) { alert(err.message); }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSelect = (id: string) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleAll = () => {
    if (!data) return;
    setSelected(selected.length === data.data.length ? [] : data.data.map(e => e.id));
  };

  const toggleCol = (key: string) => {
    const col = ALL_COLS.find(c => c.key === key);
    if (col?.always) return;
    setVisibleCols(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key]);
  };

  const goPage = (p: number) => { setPage(Math.max(1, Math.min(p, totalPages))); };

  const colValue = (emp: Employee, key: string) => {
    switch (key) {
      case "seq": return String(emp.sequentialNumber);
      case "fullName": return `${emp.firstName} ${emp.fatherName || ""} ${emp.familyName}`.trim();
      case "nationalId": return emp.nationalId;
      case "workGovernorate": return emp.workGovernorate;
      case "jobTitle": return emp.jobTitle;
      case "jobCategory": return emp.jobCategory;
      case "employmentStatus": return emp.employmentStatus;
      case "status": return emp.status;
      case "birthDate": return emp.birthDate;
      case "gender": return emp.gender;
      case "mobile": return emp.mobile;
      case "employeeRefId": return emp.employeeRefId;
      case "maritalStatus": return emp.maritalStatus;
      case "lastQualification": return emp.lastQualification;
      case "submittedAt": return emp.submittedAt ? new Date(emp.submittedAt).toLocaleDateString(ar ? "ar-SY" : "en-GB") : undefined;
      default: return undefined;
    }
  };

  const filterChips = [
    { val: qGender, label: ar ? `الجنس: ${qGender}` : `Gender: ${qGender}`, clear: () => setQGender("") },
    { val: qStatus && qStatus !== "all" ? qStatus : "", label: ar ? `الحالة: ${qStatus}` : `Status: ${qStatus}`, clear: () => setQStatus("") },
    { val: qGov && qGov !== "all" ? qGov : "", label: ar ? `المحافظة: ${qGov}` : `Governorate: ${qGov}`, clear: () => setQGov("") },
    { val: qEmpStatus && qEmpStatus !== "all" ? qEmpStatus : "", label: ar ? `التوظيف: ${qEmpStatus}` : `Employment: ${qEmpStatus}`, clear: () => setQEmpStatus("") },
    { val: advJobCat && advJobCat !== "all" ? advJobCat : "", label: ar ? `الفئة: ${advJobCat}` : `Category: ${advJobCat}`, clear: () => setAdvJobCat("") },
    { val: advOrg1, label: ar ? `المستوى الأول: ${advOrg1}` : `Level 1: ${advOrg1}`, clear: () => setAdvOrg1("") },
  ].filter(c => c.val);

  return (
    <Layout>
      <div className="space-y-4">

        {/* ─── Header ─── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-800 dark:text-slate-100">{ar ? "الموظفون" : "Employees"}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {isLoading ? (ar ? "جاري التحميل..." : "Loading...") : ar ? `الإجمالي: ${(data?.total || 0).toLocaleString("ar-SY")} سجل` : `Total: ${(data?.total || 0).toLocaleString()} records`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selected.length > 0 && isAdmin && (
              <Button variant="destructive" size="sm" onClick={handleBulkDelete} data-testid="button-bulk-delete">
                <Trash2 className="h-4 w-4 ml-2" /> {ar ? `حذف ${selected.length} محدد` : `Delete ${selected.length} selected`}
              </Button>
            )}

            {/* ─── زر استيراد من Google Sheets ─── */}
            {isAdmin && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleImport}
                      disabled={importing}
                      data-testid="button-import-from-sheets"
                      className={cn(
                        "relative border transition-all duration-200 gap-2",
                        importStatus === "success" && "border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30",
                        importStatus === "error"   && "border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30",
                        importStatus === null      && "border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30",
                      )}
                    >
                      {importing
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : importStatus === "success"
                          ? <CheckCircle2 className="h-4 w-4" />
                          : importStatus === "error"
                            ? <XCircle className="h-4 w-4" />
                            : <ArrowDownToLine className="h-4 w-4" />
                      }

                      {/* نقطة الحالة */}
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full flex-shrink-0",
                        importStatus === "success" ? "bg-emerald-500" :
                        importStatus === "error"   ? "bg-red-500" :
                        "bg-blue-400 animate-pulse"
                      )} />

                      <span className="hidden sm:inline">
                        {importing ? (ar ? "جاري الاستيراد..." : "Importing...") :
                         importStatus === "success" ? (ar ? "تم الاستيراد" : "Imported") :
                         importStatus === "error"   ? (ar ? "فشل الاستيراد" : "Import Failed") :
                         (ar ? "استيراد من Sheets" : "Import from Sheets")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-72 text-xs leading-relaxed space-y-2">
                    <p className="font-medium text-center">
                      {importStatus === "success" ? (ar ? "✅ آخر استيراد تم بنجاح" : "✅ Last import successful") :
                       importStatus === "error"   ? (ar ? "❌ آخر استيراد فشل" : "❌ Last import failed") :
                       (ar ? "📥 استيراد البيانات من Google Sheets إلى قاعدة البيانات" : "📥 Import data from Google Sheets to database")}
                    </p>
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-600">
                      <button
                        onClick={e => { e.stopPropagation(); setSyncDeletes(v => !v); }}
                        className={cn(
                          "flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border transition-colors",
                          syncDeletes
                            ? "border-red-400 text-red-600 bg-red-50 dark:border-red-600 dark:text-red-400 dark:bg-red-900/20"
                            : "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400"
                        )}
                      >
                        <RefreshCw className="h-3 w-3" />
                        {syncDeletes ? (ar ? "مزامنة المحذوفات: مفعّلة" : "Sync Deletes: ON") : (ar ? "مزامنة المحذوفات: معطّلة" : "Sync Deletes: OFF")}
                      </button>
                    </div>
                    {syncDeletes && (
                      <p className="text-red-500 dark:text-red-400 text-xs">
                        {ar ? "⚠️ سيُحذف كل موظف في قاعدة البيانات غير موجود في الـ Sheet" : "⚠️ Employees in DB but not in Sheet will be deleted"}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* ─── زر تصحيح ترويسات الـ Sheet ─── */}
            {isAdmin && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleFixHeaders}
                      disabled={fixingHeaders}
                      data-testid="button-fix-sheet-headers"
                      className={cn(
                        "relative border transition-all duration-200 gap-2",
                        headersFixed === true  && "border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30",
                        headersFixed === false && "border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30",
                        headersFixed === null  && "border-amber-400 dark:border-amber-600 text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30",
                      )}
                    >
                      {fixingHeaders
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : headersFixed === true
                          ? <TableProperties className="h-4 w-4" />
                          : headersFixed === false
                            ? <AlertCircle className="h-4 w-4" />
                            : <TableProperties className="h-4 w-4" />
                      }

                      {/* نقطة الحالة */}
                      <span className={cn(
                        "inline-block w-2 h-2 rounded-full flex-shrink-0",
                        headersFixed === true  ? "bg-emerald-500" :
                        headersFixed === false ? "bg-red-500" :
                        "bg-amber-500 animate-pulse"
                      )} />

                      <span className="hidden sm:inline">
                        {headersFixed === true  ? (ar ? "الترويسات مُصحَّحة" : "Headers Corrected") :
                         headersFixed === false ? (ar ? "فشل التصحيح" : "Correction Failed") :
                         (ar ? "تصحيح ترويسات الـ Sheet" : "Fix Sheet Headers")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-64 text-center text-xs leading-relaxed">
                    {headersFixed === true
                      ? (ar ? "✅ تم تصحيح ترويسات الـ Sheet بنجاح — يمكنك الآن إرسال رابط التعبئة للموظفين" : "✅ Sheet headers corrected successfully — you can now send the form link to employees")
                      : headersFixed === false
                        ? (ar ? "❌ فشل تصحيح الترويسات — تأكد من إعداد Google Sheets في صفحة الإعدادات أولاً" : "❌ Header correction failed — ensure Google Sheets is configured in settings first")
                        : (ar ? "⚠️ يُنصح بالضغط على هذا الزر قبل إرسال رابط التعبئة للموظفين لضمان دقة البيانات في الـ Sheet" : "⚠️ Recommended to click this before sending the form link to ensure data accuracy in the Sheet")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* ─── زر نسخ رابط النموذج ─── */}
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const url = `${window.location.origin}/register`;
                      navigator.clipboard.writeText(url).then(() => {
                        setCopiedFormLink(true);
                        setTimeout(() => setCopiedFormLink(false), 2500);
                      });
                    }}
                    className={cn(
                      "border-slate-200 dark:border-slate-700 transition-all duration-200",
                      copiedFormLink && "border-green-400 text-green-600 dark:border-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
                    )}
                    data-testid="button-copy-form-link"
                  >
                    {copiedFormLink
                      ? <><Check className="h-4 w-4 ml-2 text-green-500" />{ar ? "تم نسخ الرابط" : "Copied!"}</>
                      : <><Copy className="h-4 w-4 ml-2" />{ar ? "نسخ رابط النموذج" : "Copy Form Link"}</>
                    }
                  </Button>
                </TooltipTrigger>
                {!copiedFormLink && headersFixed !== true && isAdmin && (
                  <TooltipContent side="bottom" className="max-w-64 text-center text-xs leading-relaxed bg-amber-50 dark:bg-amber-900/80 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700">
                    {ar ? "⚠️ تأكد من تصحيح ترويسات الـ Sheet أولاً قبل إرسال هذا الرابط للموظفين" : "⚠️ Ensure Sheet headers are corrected before sending this link to employees"}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>

            {isAdmin && (
              <Button size="sm" onClick={() => nav("/admin/employees/new")} data-testid="button-add-employee">
                <UserPlus className="h-4 w-4 ml-2" />
                {ar ? "إضافة موظف جديد" : "Add Employee"}
              </Button>
            )}
          </div>
        </div>

        {/* ─── Search + Quick Filters ─── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap gap-2.5">
            {/* Search */}
            <div className="relative flex-1 min-w-52">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => debounce(e.target.value)}
                placeholder={ar ? "بحث بالاسم أو الرقم الوطني أو الرقم الذاتي أو الجوال..." : "Search by name, national ID, ref. ID or mobile..."}
                className="pr-10 h-9"
                data-testid="input-search"
              />
              {search && (
                <button onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* محافظة العمل */}
            <Select value={qGov} onValueChange={v => { setQGov(v); setPage(1); }}>
              <SelectTrigger className="w-40 h-9"><SelectValue placeholder={ar ? "محافظة العمل" : "Governorate"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? "كل المحافظات" : "All Governorates"}</SelectItem>
                {GOVERNORATES.map((g, idx) => <SelectItem key={g} value={g}>{ar ? g : GOVERNORATES_EN[idx]}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* الحالة */}
            <Select value={qStatus} onValueChange={v => { setQStatus(v); setPage(1); }}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder={ar ? "الحالة" : "Status"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? "كل الحالات" : "All Statuses"}</SelectItem>
                {[
                  { ar: "نشط", en: "Active" },
                  { ar: "إجازة", en: "Leave" },
                  { ar: "منتدب", en: "Seconded" },
                  { ar: "متوفى", en: "Deceased" },
                  { ar: "مفصول", en: "Dismissed" }
                ].map(s => <SelectItem key={s.ar} value={s.ar}>{ar ? s.ar : s.en}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* الجنس */}
            <Select value={qGender} onValueChange={v => { setQGender(v); setPage(1); }}>
              <SelectTrigger className="w-28 h-9"><SelectValue placeholder={ar ? "الجنس" : "Gender"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? "الجميع" : "All"}</SelectItem>
                <SelectItem value="ذكر">{ar ? "ذكر" : "Male"}</SelectItem>
                <SelectItem value="أنثى">{ar ? "أنثى" : "Female"}</SelectItem>
              </SelectContent>
            </Select>

            {/* مثبت / متعاقد */}
            <Select value={qEmpStatus} onValueChange={v => { setQEmpStatus(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-9"><SelectValue placeholder={ar ? "مثبت / متعاقد" : "Employment"} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{ar ? "الكل" : "All"}</SelectItem>
                <SelectItem value="مثبت">{ar ? "مثبت" : "Permanent"}</SelectItem>
                <SelectItem value="متعاقد">{ar ? "متعاقد" : "Contract"}</SelectItem>
              </SelectContent>
            </Select>

            {/* Advanced + Columns */}
            <Button
              variant={advOpen ? "default" : "outline"}
              size="sm"
              onClick={() => setAdvOpen(!advOpen)}
              className="h-9 gap-1.5 relative"
              data-testid="button-advanced-filter"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {ar ? "فلاتر متقدمة" : "Advanced Filters"}
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            <Button variant="outline" size="sm" onClick={() => setColPickerOpen(!colPickerOpen)} className="h-9 gap-1.5">
              <Columns3 className="h-4 w-4" />
              {ar ? "الأعمدة" : "Columns"}
            </Button>
          </div>

          {/* ─── Advanced Filters ─── */}
          {advOpen && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground font-medium">{ar ? "الفئة الوظيفية" : "Job Category"}</span>
                <Select value={advJobCat} onValueChange={v => { setAdvJobCat(v); setPage(1); }}>
                  <SelectTrigger className="w-44 h-9"><SelectValue placeholder={ar ? "اختر الفئة..." : "Select category..."} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{ar ? "كل الفئات" : "All Categories"}</SelectItem>
                    {JOB_CATEGORIES.map((j, idx) => <SelectItem key={j} value={j}>{ar ? j : JOB_CATEGORIES_EN[idx]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground font-medium">{ar ? "المستوى التنظيمي الأول" : "Org Level 1"}</span>
                <Input
                  value={advOrg1} onChange={e => { setAdvOrg1(e.target.value); setPage(1); }}
                  placeholder={ar ? "اكتب للبحث..." : "Type to search..."} className="h-9 w-52"
                />
              </div>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-9 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                  <X className="h-3.5 w-3.5 ml-1" /> {ar ? "مسح جميع الفلاتر" : "Clear All Filters"}
                </Button>
              )}
            </div>
          )}

          {/* ─── Column Picker ─── */}
          {colPickerOpen && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-700">
              <p className="text-xs font-semibold text-muted-foreground mb-2">{ar ? "تخصيص الأعمدة المعروضة:" : "Customize visible columns:"}</p>
              <div className="flex flex-wrap gap-2">
                {ALL_COLS.map(col => (
                  <button
                    key={col.key}
                    onClick={() => toggleCol(col.key)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-xs font-medium border transition-all",
                      col.always ? "opacity-50 cursor-not-allowed bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600" :
                      visibleCols.includes(col.key)
                        ? "bg-primary text-white border-primary"
                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary/50"
                    )}
                  >
                    {ar ? col.label : (col.labelEn || col.label)}
                    {col.always && " 🔒"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Active Filter Chips + Row Count ─── */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {filterChips.map((chip, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                {chip.label}
                <button onClick={chip.clear} className="hover:text-red-500 transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {data && <span>{ar ? `عرض ${startRow}–${endRow} من ${data.total.toLocaleString("ar-SY")} سجل` : `Showing ${startRow}–${endRow} of ${data.total.toLocaleString()} records`}</span>}
            <span className="text-slate-300 dark:text-slate-600">|</span>
            <span className="text-xs">{ar ? "عرض:" : "Show:"}</span>
            {[10, 25, 50, 100].map(n => (
              <button
                key={n}
                onClick={() => { setLimit(n); setPage(1); }}
                className={cn(
                  "w-8 h-7 rounded-md text-xs font-semibold transition-all",
                  limit === n ? "bg-primary text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                )}
              >{n}</button>
            ))}
          </div>
        </div>

        {/* ─── Table ─── */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-card">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{ar ? "جاري التحميل..." : "Loading..."}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" dir="rtl">
                  <thead className="bg-slate-50/80 dark:bg-slate-700/60 border-b border-slate-200 dark:border-slate-600">
                    <tr>
                      {isAdmin && (
                        <th className="px-3 py-3 text-right w-10">
                          <button onClick={toggleAll} className="hover:text-primary transition-colors">
                            {selected.length > 0 && selected.length === (data?.data.length || 0)
                              ? <CheckSquare className="h-4 w-4 text-primary" />
                              : <Square className="h-4 w-4 text-slate-400" />}
                          </button>
                        </th>
                      )}
                      {ALL_COLS.filter(c => visibleCols.includes(c.key)).map(col => (
                        <th key={col.key} className="px-3 py-3 text-right text-xs font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {ar ? col.label : (col.labelEn || col.label)}
                        </th>
                      ))}
                      <th className="px-3 py-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wide">{ar ? "إجراءات" : "Actions"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {data?.data.length === 0 && (
                      <tr>
                        <td colSpan={20} className="text-center py-16">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <Users className="h-10 w-10 opacity-20" />
                            <p className="text-sm font-medium">{ar ? "لا توجد نتائج مطابقة" : "No matching results"}</p>
                            {activeFilterCount > 0 && (
                              <Button variant="link" size="sm" onClick={clearAllFilters} className="text-primary">{ar ? "مسح الفلاتر" : "Clear Filters"}</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {data?.data.map(emp => (
                      <tr
                        key={emp.id}
                        className={cn(
                          "hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors",
                          emp.status && STATUS_ROW[emp.status],
                          selected.includes(emp.id) && "bg-primary/5 dark:bg-primary/10"
                        )}
                      >
                        {isAdmin && (
                          <td className="px-3 py-2.5">
                            <button onClick={() => toggleSelect(emp.id)} className="hover:text-primary transition-colors">
                              {selected.includes(emp.id)
                                ? <CheckSquare className="h-4 w-4 text-primary" />
                                : <Square className="h-4 w-4 text-slate-400" />}
                            </button>
                          </td>
                        )}
                        {ALL_COLS.filter(c => visibleCols.includes(c.key)).map(col => {
                          const val = colValue(emp, col.key);
                          return (
                            <td key={col.key} className="px-3 py-2.5">
                              {col.key === "status" ? (
                                val
                                  ? <Badge variant={(STATUS_BADGE[val] || "outline") as any} className="text-xs">
                                      {ar ? val : (
                                        val === "نشط" ? "Active" :
                                        val === "إجازة" ? "Leave" :
                                        val === "منتدب" ? "Seconded" :
                                        val === "متوفى" ? "Deceased" :
                                        val === "مفصول" ? "Dismissed" : val
                                      )}
                                    </Badge>
                                  : <span className="text-slate-300 dark:text-slate-600">—</span>
                              ) : col.key === "nationalId" ? (
                                <span className="font-mono text-xs tracking-wider text-slate-700 dark:text-slate-300">
                                  {val ? highlight(val, debouncedSearch) : <span className="text-slate-300">—</span>}
                                </span>
                              ) : col.key === "seq" ? (
                                <span className="text-xs font-mono text-muted-foreground">{val}</span>
                              ) : col.key === "fullName" ? (
                                <span className="font-bold text-slate-800 dark:text-slate-200">
                                  {val ? highlight(val, debouncedSearch) : "—"}
                                </span>
                              ) : (
                                <span className="text-slate-600 dark:text-slate-400 text-xs">
                                  {val ? highlight(val, debouncedSearch) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        {/* Actions */}
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button
                              variant="ghost" size="icon-sm"
                              onClick={() => setViewEmp(emp)}
                              title={ar ? "عرض التفاصيل" : "View Details"}
                              className="text-primary hover:bg-primary/10 h-7 w-7"
                              data-testid={`button-view-${emp.id}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              variant="ghost" size="icon-sm"
                              onClick={() => handleCopy(emp.nationalId, emp.id)}
                              title={ar ? "نسخ الرقم الوطني" : "Copy National ID"}
                              className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 h-7 w-7"
                              data-testid={`button-copy-${emp.id}`}
                            >
                              {copiedId === emp.id
                                ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                                : <Copy className="h-3.5 w-3.5" />}
                            </Button>

                            {isAdmin && (
                              <>
                                <Button
                                  variant="ghost" size="icon-sm"
                                  onClick={() => nav(`/admin/employees/${emp.id}/edit`)}
                                  title={ar ? "تعديل" : "Edit"}
                                  className="text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 h-7 w-7"
                                  data-testid={`button-edit-${emp.id}`}
                                >
                                  <Edit className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon-sm"
                                  onClick={() => setDeleteId(emp.id)}
                                  title={ar ? "حذف" : "Delete"}
                                  className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 h-7 w-7"
                                  data-testid={`button-delete-${emp.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ─── Pagination ─── */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/20">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Button variant="outline" size="icon-sm" onClick={() => goPage(1)} disabled={page === 1} className="h-8 w-8" title={ar ? "الأولى" : "First"}>
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon-sm" onClick={() => goPage(page - 1)} disabled={page === 1} className="h-8 w-8" title={ar ? "السابق" : "Previous"}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>

                    {getPaginationPages(page, totalPages).map((p, i) =>
                      p === "…" ? (
                        <span key={`e${i}`} className="px-1 text-muted-foreground text-sm">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => goPage(p as number)}
                          className={cn(
                            "h-8 min-w-8 px-2 rounded-lg text-xs font-semibold transition-all border",
                            p === page
                              ? "bg-primary text-white border-primary shadow-sm"
                              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary/40 hover:text-primary"
                          )}
                        >{p}</button>
                      )
                    )}

                    <Button variant="outline" size="icon-sm" onClick={() => goPage(page + 1)} disabled={page >= totalPages} className="h-8 w-8" title={ar ? "التالي" : "Next"}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon-sm" onClick={() => goPage(totalPages)} disabled={page >= totalPages} className="h-8 w-8" title={ar ? "الأخيرة" : "Last"}>
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{ar ? "انتقال إلى:" : "Jump to:"}</span>
                    <Input
                      type="number" min={1} max={totalPages}
                      value={jumpPage}
                      onChange={e => setJumpPage(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && jumpPage) { goPage(parseInt(jumpPage)); setJumpPage(""); } }}
                      placeholder={String(page)}
                      className="w-16 h-8 text-center text-xs"
                    />
                    <span className="text-xs text-muted-foreground">{ar ? `من ${totalPages}` : `of ${totalPages}`}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── Employee Detail Dialog ─── */}
      <EmployeeDetailDialog
        emp={viewEmp}
        open={!!viewEmp}
        onClose={() => setViewEmp(null)}
        onEdit={() => { if (viewEmp) nav(`/admin/employees/${viewEmp.id}/edit`); setViewEmp(null); }}
        isAdmin={isAdmin}
        ar={ar}
      />

      {/* ─── Delete Confirm Dialog ─── */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ar ? "تأكيد الحذف" : "Confirm Delete"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{ar ? "هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء." : "Are you sure you want to delete this record? This action cannot be undone."}</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>{ar ? "إلغاء" : "Cancel"}</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin ml-2" />} {ar ? "حذف" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Import Results Dialog ─── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {importStatus === "success"
                ? <><CheckCircle2 className="h-5 w-5 text-emerald-500" /> نتيجة الاستيراد</>
                : <><XCircle className="h-5 w-5 text-red-500" /> فشل الاستيراد</>
              }
            </DialogTitle>
          </DialogHeader>

          {importStatus === "success" && importResult ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {/* إجمالي */}
                <div className="col-span-2 flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2.5">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Download className="h-4 w-4" /> {ar ? "إجمالي الصفوف" : "Total Rows"}
                  </span>
                  <span className="font-bold text-slate-800 dark:text-slate-100">{importResult.total}</span>
                </div>
                {/* مُضاف */}
                <div className="flex items-center justify-between rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <Plus className="h-3.5 w-3.5" /> {ar ? "مُضاف جديد" : "Added New"}
                  </span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{importResult.inserted}</span>
                </div>
                {/* مُحدَّث */}
                <div className="flex items-center justify-between rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2">
                  <span className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1">
                    <RefreshCw className="h-3.5 w-3.5" /> {ar ? "مُحدَّث" : "Updated"}
                  </span>
                  <span className="font-bold text-blue-700 dark:text-blue-400">{importResult.updated}</span>
                </div>
                {/* مُتجاوَز */}
                <div className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                  <span className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <SkipForward className="h-3.5 w-3.5" /> {ar ? "مُتجاوَز" : "Skipped"}
                  </span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">{importResult.skipped}</span>
                </div>
                {/* محذوف */}
                <div className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2 border",
                  importResult.deleted > 0
                    ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                    : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                )}>
                  <span className={cn(
                    "text-xs flex items-center gap-1",
                    importResult.deleted > 0 ? "text-red-700 dark:text-red-400" : "text-slate-500 dark:text-slate-400"
                  )}>
                    <Minus className="h-3.5 w-3.5" /> {ar ? "محذوف" : "Deleted"}
                  </span>
                  <span className={cn(
                    "font-bold",
                    importResult.deleted > 0 ? "text-red-700 dark:text-red-400" : "text-slate-500 dark:text-slate-400"
                  )}>{importResult.deleted}</span>
                </div>
              </div>
              {importResult.deleted > 0 && (
                <p className="text-xs text-red-500 dark:text-red-400 text-center">
                  {ar ? `⚠️ تم حذف ${importResult.deleted} سجل غير موجود في الـ Sheet` : `⚠️ Deleted ${importResult.deleted} records not in the Sheet`}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {importError || (ar ? "حدث خطأ غير متوقع أثناء الاستيراد" : "An unexpected error occurred during import")}
            </div>
          )}

          <DialogFooter>
            <Button size="sm" onClick={() => setImportDialogOpen(false)} className="w-full">{ar ? "إغلاق" : "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
