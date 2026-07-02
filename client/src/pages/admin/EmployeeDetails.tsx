import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Loader2, ArrowRight, Edit, Printer, Clock } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import { apiRequest } from "@/lib/queryClient";

interface Employee {
  id: string; sequentialNumber: number;
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
  [key: string]: any;
}

interface AuditEntry { id: string; changedBy?: string; action: string; changedAt?: string; }

const STATUS_BADGE: Record<string, string> = {
  "نشط": "success", "إجازة": "warning", "منتدب": "secondary",
  "متوفى": "outline", "مفصول": "destructive",
};

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <dt className="text-xs text-muted-foreground min-w-40 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {value != null && value !== "" ? value : <span className="text-slate-300 dark:text-slate-600">—</span>}
      </dd>
    </div>
  );
}

export function EmployeeDetails() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const { user } = useAuth();
  const { lang } = useLang();
  const ar = lang === "ar";

  const { data, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => apiRequest<{ employee: Employee; auditLog: AuditEntry[] }>("GET", `/api/admin/employees/${id}`),
  });

  if (isLoading) return (
    <Layout>
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    </Layout>
  );

  const emp = data?.employee;
  if (!emp) return (
    <Layout><div className="text-center p-12 text-muted-foreground">{ar ? "الموظف غير موجود" : "Employee not found"}</div></Layout>
  );

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => nav("/admin/employees")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                {emp.firstName} {emp.fatherName} {emp.familyName}
              </h1>
              <p className="text-muted-foreground text-sm">
                {ar ? "م" : "#"}: {emp.sequentialNumber} | {ar ? "الرقم الوطني" : "National ID"}: {emp.nationalId}
                {emp.employeeRefId && ` | ${ar ? "الرقم الذاتي" : "Ref. ID"}: ${emp.employeeRefId}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 no-print">
            {emp.status && <Badge variant={(STATUS_BADGE[emp.status] || "outline") as any}>{emp.status}</Badge>}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 ml-2" /> {ar ? "طباعة" : "Print"}
            </Button>
            {(user?.role === "admin" || user?.role === "editor") && (
              <Button size="sm" onClick={() => nav(`/admin/employees/${id}/edit`)}>
                <Edit className="h-4 w-4 ml-2" /> {ar ? "تعديل" : "Edit"}
              </Button>
            )}
          </div>
        </div>

        {/* Print Header */}
        <div className="hidden print:block text-center mb-6 pb-4 border-b-2">
          <h1 className="text-xl font-bold">{ar ? "نموذج التسجيل — منصة مسارات" : "Registration Form — Masarat Platform"}</h1>
          <p className="text-sm text-gray-500">
            {emp.firstName} {emp.fatherName} {emp.familyName} — {ar ? "رقم وطني" : "National ID"}: {emp.nationalId}
          </p>
          <p className="text-xs text-gray-400">{ar ? "طُبع" : "Printed"}: {new Date().toLocaleDateString(ar ? "ar-SY" : "en-GB")}</p>
        </div>

        {/* Tabs — matching master file groupings */}
        <Tabs defaultValue="org" dir={ar ? "rtl" : "ltr"} className="no-print">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="org">{ar ? "التنظيمية والوظيفية" : "Org & Job"}</TabsTrigger>
            <TabsTrigger value="personal">{ar ? "الشخصية" : "Personal"}</TabsTrigger>
            <TabsTrigger value="residence">{ar ? "الإقامة والقيد" : "Residence"}</TabsTrigger>
            <TabsTrigger value="qual">{ar ? "المؤهلات والحالة" : "Qualifications"}</TabsTrigger>
          </TabsList>

          <TabsContent value="org">
            <div className="section-card">
              <dl>
                <Row label={ar ? "المستوى التنظيمي الاول"       : "Org Level 1"}         value={emp.orgLevel1} />
                <Row label={ar ? "التصنيف/ الجهة المرتبطة"      : "Classification"}       value={emp.orgClassification} />
                <Row label={ar ? "المستوى التنظيمي الثاني"      : "Org Level 2"}         value={emp.orgLevel2} />
                <Row label={ar ? "المستوى التنظيمي الثالث"      : "Org Level 3"}         value={emp.orgLevel3} />
                <Row label={ar ? "المستوى التنظيمي الرابع"      : "Org Level 4"}         value={emp.orgLevel4} />
                <Row label={ar ? "المستوى التنظيمي الخامس"      : "Org Level 5"}         value={emp.orgLevel5} />
                <Row label={ar ? "محافظة العمل"                  : "Work Governorate"}    value={emp.workGovernorate} />
                <Row label={ar ? "الرقم الذاتي"                  : "Ref. ID"}             value={emp.employeeRefId} />
                <Row label={ar ? "مسمى العمل"                    : "Job Title"}           value={emp.jobTitle} />
                <Row label={ar ? "تاريخ التولد"                  : "Birth Date"}          value={emp.birthDate} />
                <Row label={ar ? "تاريخ بدء العمل بالدولة"       : "Work Start Date"}     value={emp.workStartDate} />
                <Row label={ar ? "تاريخ التثبيت في الدولة"       : "Permanent Date"}      value={emp.permanentDate} />
                <Row label={ar ? "تاريخ التعاقد في الدولة"       : "Contract Date"}       value={emp.contractDate} />
                <Row label={ar ? "الفئة الوظيفية"                : "Job Category"}        value={emp.jobCategory} />
                <Row label={ar ? "مثبت أو متعاقد"                : "Employment Status"}   value={emp.employmentStatus} />
                <Row label={ar ? "نمط التعيين أو التعاقد"        : "Appointment Pattern"} value={emp.appointmentPattern} />
                <Row label={ar ? "تفاصيل دمج"                    : "Merge Details"}       value={emp.mergeDetails} />
              </dl>
            </div>
          </TabsContent>

          <TabsContent value="personal">
            <div className="section-card">
              <dl>
                <Row label={ar ? "الاسم"           : "First Name"}      value={emp.firstName} />
                <Row label={ar ? "اسم الأب"        : "Father's Name"}   value={emp.fatherName} />
                <Row label={ar ? "النسبة"          : "Family Name"}     value={emp.familyName} />
                <Row label={ar ? "اسم الأم الكامل" : "Mother's Name"}   value={emp.motherFullName} />
                <Row label={ar ? "الرقم الوطني"    : "National ID"}     value={emp.nationalId} />
                <Row label={ar ? "الجنس"           : "Gender"}          value={emp.gender} />
                <Row label={ar ? "رقم الجوال"      : "Mobile"}          value={emp.mobile} />
                <Row label={ar ? "الوضع العائلي"   : "Marital Status"}  value={emp.maritalStatus} />
                <Row label={ar ? "عدد الأبناء"     : "Children Count"}  value={emp.childrenCount} />
                <Row label={ar ? "عدد الزوجات"     : "Wives Count"}     value={emp.wivesCount} />
              </dl>
            </div>
          </TabsContent>

          <TabsContent value="residence">
            <div className="section-card">
              <dl>
                <Row label={ar ? "منطقة السكن"      : "Residence Area"}    value={emp.residenceArea} />
                <Row label={ar ? "تفصيل مكان السكن" : "Residence Detail"}  value={emp.residenceDetail} />
                <Row label={ar ? "رقم القيد"         : "Registry Number"}   value={emp.registryNumber} />
                <Row label={ar ? "مكان القيد"        : "Registry Place"}    value={emp.registryPlace} />
                <Row label={ar ? "دولة الولادة"      : "Birth Country"}     value={emp.birthCountry} />
                <Row label={ar ? "المحافظة"          : "Governorate"}       value={emp.governorate} />
                <Row label={ar ? "المنطقة_المدينة"   : "City/District"}     value={emp.cityDistrict} />
                <Row label={ar ? "الناحية"           : "Sub-District"}      value={emp.subDistrict} />
              </dl>
            </div>
          </TabsContent>

          <TabsContent value="qual">
            <div className="section-card">
              <dl>
                <Row label={ar ? "آخر مؤهل علمي معين على أساسه" : "Last Qualification"}  value={emp.lastQualification} />
                <Row label={ar ? "هل لديك إعاقة"               : "Has Disability"}        value={emp.hasDisability} />
                <Row label={ar ? "نوع الإعاقة"                 : "Disability Type"}        value={emp.disabilityType} />
                <Row label={ar ? "بطاقة الإعاقة"               : "Disability Card"}        value={emp.disabilityCard} />
                <Row label={ar ? "الحالة"                       : "Status"}                value={emp.status} />
                <Row label={ar ? "تفصيل الحالة"                 : "Status Detail"}         value={emp.statusDetail} />
                <Row label={ar ? "حساب شام كاش"                 : "Sham Cash Account"}     value={emp.shamCashAccount} />
                <Row label={ar ? "ملاحظات مركزية"               : "Central Notes"}         value={emp.centralNotes} />
                <Row label={ar ? "تاريخ التسجيل"                : "Registered At"}
                  value={emp.submittedAt ? new Date(emp.submittedAt).toLocaleDateString(ar ? "ar-SY" : "en-GB") : undefined} />
              </dl>
            </div>
          </TabsContent>
        </Tabs>

        {/* Print View — all sections shown */}
        <div className="hidden print:block space-y-6">
          {[
            { title: ar ? "البيانات التنظيمية والوظيفية" : "Organizational & Job Data", rows: [
              [ar ? "المستوى التنظيمي الاول" : "Org Level 1", emp.orgLevel1],
              [ar ? "التصنيف/ الجهة المرتبطة" : "Classification", emp.orgClassification],
              [ar ? "المستوى التنظيمي الثاني" : "Org Level 2", emp.orgLevel2],
              [ar ? "المستوى التنظيمي الثالث" : "Org Level 3", emp.orgLevel3],
              [ar ? "المستوى التنظيمي الرابع" : "Org Level 4", emp.orgLevel4],
              [ar ? "المستوى التنظيمي الخامس" : "Org Level 5", emp.orgLevel5],
              [ar ? "محافظة العمل" : "Work Governorate", emp.workGovernorate],
              [ar ? "الرقم الذاتي" : "Ref. ID", emp.employeeRefId],
              [ar ? "مسمى العمل" : "Job Title", emp.jobTitle],
              [ar ? "تاريخ التولد" : "Birth Date", emp.birthDate],
              [ar ? "تاريخ بدء العمل بالدولة" : "Work Start Date", emp.workStartDate],
              [ar ? "تاريخ التثبيت في الدولة" : "Permanent Date", emp.permanentDate],
              [ar ? "تاريخ التعاقد في الدولة" : "Contract Date", emp.contractDate],
              [ar ? "الفئة الوظيفية" : "Job Category", emp.jobCategory],
              [ar ? "مثبت أو متعاقد" : "Employment Status", emp.employmentStatus],
              [ar ? "نمط التعيين أو التعاقد" : "Appointment Pattern", emp.appointmentPattern],
              [ar ? "تفاصيل دمج" : "Merge Details", emp.mergeDetails],
            ]},
            { title: ar ? "البيانات الشخصية" : "Personal Data", rows: [
              [ar ? "الاسم" : "First Name", emp.firstName],
              [ar ? "اسم الأب" : "Father's Name", emp.fatherName],
              [ar ? "النسبة" : "Family Name", emp.familyName],
              [ar ? "اسم الأم الكامل" : "Mother's Name", emp.motherFullName],
              [ar ? "الرقم الوطني" : "National ID", emp.nationalId],
              [ar ? "الجنس" : "Gender", emp.gender],
              [ar ? "رقم الجوال" : "Mobile", emp.mobile],
              [ar ? "الوضع العائلي" : "Marital Status", emp.maritalStatus],
              [ar ? "عدد الأبناء" : "Children Count", emp.childrenCount],
              [ar ? "عدد الزوجات" : "Wives Count", emp.wivesCount],
            ]},
            { title: ar ? "الإقامة والقيد" : "Residence & Registry", rows: [
              [ar ? "منطقة السكن" : "Residence Area", emp.residenceArea],
              [ar ? "تفصيل مكان السكن" : "Residence Detail", emp.residenceDetail],
              [ar ? "رقم القيد" : "Registry Number", emp.registryNumber],
              [ar ? "مكان القيد" : "Registry Place", emp.registryPlace],
              [ar ? "دولة الولادة" : "Birth Country", emp.birthCountry],
              [ar ? "المحافظة" : "Governorate", emp.governorate],
              [ar ? "المنطقة_المدينة" : "City/District", emp.cityDistrict],
              [ar ? "الناحية" : "Sub-District", emp.subDistrict],
            ]},
            { title: ar ? "المؤهلات والحالة" : "Qualifications & Status", rows: [
              [ar ? "آخر مؤهل علمي معين على أساسه" : "Last Qualification", emp.lastQualification],
              [ar ? "هل لديك إعاقة" : "Has Disability", emp.hasDisability],
              [ar ? "نوع الإعاقة" : "Disability Type", emp.disabilityType],
              [ar ? "بطاقة الإعاقة" : "Disability Card", emp.disabilityCard],
              [ar ? "الحالة" : "Status", emp.status],
              [ar ? "تفصيل الحالة" : "Status Detail", emp.statusDetail],
              [ar ? "حساب شام كاش" : "Sham Cash Account", emp.shamCashAccount],
              [ar ? "ملاحظات مركزية" : "Central Notes", emp.centralNotes],
            ]},
          ].map(sec => (
            <div key={sec.title}>
              <h3 className="font-bold text-sm border-b-2 border-slate-800 pb-1 mb-2">{sec.title}</h3>
              <div className="grid grid-cols-2 gap-x-8">
                {sec.rows.map(([label, val]) => (
                  <div key={label as string} className="flex gap-2 py-1 border-b border-gray-200">
                    <span className="text-xs text-gray-500 min-w-36">{label as string}</span>
                    <span className="text-xs font-medium">{val as string || (ar ? "—" : "—")}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Audit Log */}
        {data?.auditLog && data.auditLog.length > 0 && (
          <div className="section-card no-print">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-100 dark:border-slate-700">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">{ar ? "سجل التعديلات" : "Change Log"}</h3>
            </div>
            <div className="space-y-1">
              {data.auditLog.map(log => (
                <div key={log.id} className="flex items-center gap-3 text-xs text-muted-foreground py-1.5 border-b border-slate-50 dark:border-slate-700 last:border-0">
                  <Badge variant={log.action === "create" ? "success" : log.action === "delete" ? "destructive" : "secondary"} className="text-[10px]">
                    {log.action === "create" ? (ar ? "إنشاء" : "Created") : log.action === "update" ? (ar ? "تعديل" : "Updated") : (ar ? "حذف" : "Deleted")}
                  </Badge>
                  <span>{log.changedBy === "employee" ? (ar ? "الموظف" : "Employee") : log.changedBy || "—"}</span>
                  <span className="mr-auto">
                    {log.changedAt ? new Date(log.changedAt).toLocaleString(ar ? "ar-SY" : "en-GB") : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
