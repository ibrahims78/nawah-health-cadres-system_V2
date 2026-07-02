import { useFormContext } from "react-hook-form";
import { Building2, User, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";

interface Step4Props {
  onEditStep: (step: number) => void;
  onSubmit: () => void;
  submitting: boolean;
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-100 dark:border-slate-700 last:border-0">
      <dt className="text-xs text-muted-foreground min-w-36 shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-slate-800 dark:text-slate-200 break-words">{value || "—"}</dd>
    </div>
  );
}

function ReviewSection({ title, icon, onEdit, editStep, children }: any) {
  const { lang } = useLang();
  const ar = lang === "ar";
  return (
    <div className="section-card mb-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-[#1d4ed8]">{icon}</span>
          <h3 className="font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onEdit(editStep)} className="text-[#1d4ed8] h-7 text-xs">
          {ar ? "✏️ تعديل" : "✏️ Edit"}
        </Button>
      </div>
      <dl className="space-y-0">{children}</dl>
    </div>
  );
}

export function Step4ReviewPrint({ onEditStep, onSubmit, submitting }: Step4Props) {
  const { watch } = useFormContext();
  const { lang } = useLang();
  const d = watch();
  const ar = lang === "ar";

  return (
    <div>
      <div className="print-container">
        {/* Print header */}
        <div className="hidden print:block text-center mb-6 pb-4 border-b-2 border-slate-800">
          <h1 className="text-xl font-bold">{ar ? "نموذج التسجيل — منصة مسارات" : "Registration Form — Masarat Platform"}</h1>
          <p className="text-sm text-gray-600">{ar ? "تاريخ الطباعة" : "Print Date"}: {new Date().toLocaleDateString(ar ? "ar-SY" : "en-US")}</p>
        </div>

        {/* Org & Work */}
        <ReviewSection
          title={ar ? "البيانات التنظيمية والوظيفية" : "Organizational & Work Data"}
          icon={<Building2 className="h-4 w-4" />}
          onEdit={onEditStep}
          editStep={1}
        >
          <Row label={ar ? "م" : "#"}                                                      value={ar ? "يُعيَّن تلقائياً" : "Auto-assigned"} />
          <Row label={ar ? "المستوى التنظيمي الاول" : "Org Level 1"}                    value={d.orgLevel1} />
          <Row label={ar ? "التصنيف/ الجهة المرتبطة" : "Classification / Entity"}        value={d.orgClassification} />
          <Row label={ar ? "المستوى التنظيمي الثاني" : "Org Level 2"}                    value={d.orgLevel2} />
          <Row label={ar ? "المستوى التنظيمي الثالث" : "Org Level 3"}                    value={d.orgLevel3} />
          <Row label={ar ? "المستوى التنظيمي الرابع" : "Org Level 4"}                    value={d.orgLevel4} />
          <Row label={ar ? "المستوى التنظيمي الخامس" : "Org Level 5"}                    value={d.orgLevel5} />
          <Row label={ar ? "محافظة العمل" : "Work Governorate"}                           value={d.workGovernorate} />
          <Row label={ar ? "الرقم الذاتي" : "Employee Ref ID"}                            value={d.employeeRefId} />
          <Row label={ar ? "مسمى العمل" : "Job Title"}                                    value={d.jobTitle} />
          <Row label={ar ? "تاريخ بدء العمل بالدولة" : "Work Start Date (State)"}        value={d.workStartDate} />
          <Row label={ar ? "تاريخ التثبيت في الدولة" : "Permanent Date (State)"}         value={d.permanentDate} />
          <Row label={ar ? "تاريخ التعاقد في الدولة" : "Contract Date (State)"}          value={d.contractDate} />
          <Row label={ar ? "الفئة الوظيفية" : "Job Category"}                            value={d.jobCategory} />
          <Row label={ar ? "مثبت أو متعاقد" : "Employment Status"}                       value={d.employmentStatus} />
          <Row label={ar ? "نمط التعيين أو التعاقد" : "Appointment Pattern"}             value={d.appointmentPattern} />
          <Row label={ar ? "تفاصيل دمج" : "Merge Details"}                               value={d.mergeDetails} />
        </ReviewSection>

        {/* Personal & Residence */}
        <ReviewSection
          title={ar ? "البيانات الشخصية والإقامة" : "Personal & Residence Data"}
          icon={<User className="h-4 w-4" />}
          onEdit={onEditStep}
          editStep={2}
        >
          <Row label={ar ? "الاسم" : "Name"}                                              value={d.firstName} />
          <Row label={ar ? "اسم الأب" : "Father's Name"}                                  value={d.fatherName} />
          <Row label={ar ? "النسبة" : "Family Name"}                                      value={d.familyName} />
          <Row label={ar ? "اسم الأم الكامل" : "Mother's Full Name"}                     value={d.motherFullName} />
          <Row label={ar ? "الرقم الوطني" : "National ID"}                               value={d.nationalId} />
          <Row label={ar ? "الجنس" : "Gender"}                                            value={d.gender} />
          <Row label={ar ? "تاريخ التولد" : "Birth Date"}                                value={d.birthDate} />
          <Row label={ar ? "الوضع العائلي" : "Marital Status"}                           value={d.maritalStatus} />
          <Row label={ar ? "عدد الأبناء" : "Children Count"}                             value={d.childrenCount} />
          <Row label={ar ? "عدد الزوجات" : "Wives Count"}                                value={d.wivesCount} />
          <Row label={ar ? "رقم الجوال" : "Mobile"}                                      value={d.mobile} />
          <Row label={ar ? "منطقة السكن" : "Residence Area"}                             value={d.residenceArea} />
          <Row label={ar ? "تفصيل مكان السكن" : "Residence Detail"}                     value={d.residenceDetail} />
          <Row label={ar ? "رقم القيد" : "Registry Number"}                              value={d.registryNumber} />
          <Row label={ar ? "مكان القيد" : "Registry Place"}                              value={d.registryPlace} />
          <Row label={ar ? "دولة الولادة" : "Birth Country"}                             value={d.birthCountry} />
          <Row label={ar ? "المحافظة" : "Governorate"}                                   value={d.governorate} />
          <Row label={ar ? "المنطقة_المدينة" : "City / District"}                       value={d.cityDistrict} />
          <Row label={ar ? "الناحية" : "Sub-District"}                                   value={d.subDistrict} />
          <Row label={ar ? "آخر مؤهل علمي معين على أساسه" : "Last Qualification"}       value={d.lastQualification} />
          <Row label={ar ? "هل لديك إعاقة" : "Has Disability"}                          value={d.hasDisability} />
          <Row label={ar ? "نوع الإعاقة" : "Disability Type"}                            value={d.disabilityType} />
          <Row label={ar ? "بطاقة الإعاقة" : "Disability Card"}                         value={d.disabilityCard} />
          <Row label={ar ? "الحالة" : "Status"}                                           value={d.status} />
          <Row label={ar ? "تفصيل الحالة" : "Status Detail"}                             value={d.statusDetail} />
          <Row label={ar ? "حساب شام كاش" : "Sham Cash Account"}                        value={d.shamCashAccount} />
          <Row label={ar ? "ملاحظات مركزية" : "Central Notes"}                          value={d.centralNotes} />
        </ReviewSection>
      </div>

      <div className="no-print flex flex-col sm:flex-row gap-3 mt-6">
        <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none">
          <Printer className="h-4 w-4 ml-2" />
          {ar ? "طباعة / PDF" : "Print / PDF"}
        </Button>
        <Button onClick={onSubmit} disabled={submitting} className="flex-1" size="lg">
          {submitting
            ? (ar ? "جاري الإرسال..." : "Submitting...")
            : (ar ? "✅ إرسال البيانات" : "✅ Submit Data")}
        </Button>
      </div>
    </div>
  );
}
