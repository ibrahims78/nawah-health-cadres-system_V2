import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { FormStepper } from "@/components/FormStepper";
import { Step1InviteCode } from "@/components/steps/Step1InviteCode";
import { Step2OrgJob } from "@/components/steps/Step2OrgJob";
import { Step3Personal } from "@/components/steps/Step3Personal";
import { Step4ReviewPrint } from "@/components/steps/Step4ReviewPrint";
import { useLang } from "@/context/LanguageContext";
import { apiRequest } from "@/lib/queryClient";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const schema = z.object({
  // Step 2
  orgLevel1: z.string().optional(),
  orgClassification: z.string().optional(),
  orgLevel2: z.string().optional(),
  orgLevel3: z.string().optional(),
  orgLevel4: z.string().optional(),
  orgLevel5: z.string().optional(),
  workGovernorate: z.string().optional(),
  employeeRefId: z.string().optional(),
  jobTitle: z.string().optional(),
  workStartDate: z.string().optional(),
  permanentDate: z.string().optional(),
  contractDate: z.string().optional(),
  jobCategory: z.string().optional(),
  employmentStatus: z.string().optional(),
  appointmentPattern: z.string().optional(),
  mergeDetails: z.string().optional(),
  // Step 3
  firstName: z.string().min(1, "الاسم مطلوب"),
  fatherName: z.string().optional(),
  familyName: z.string().min(1, "النسبة مطلوبة"),
  motherFullName: z.string().optional(),
  nationalId: z.string().regex(/^\d{11}$/, "الرقم الوطني يجب أن يكون 11 رقماً بالضبط"),
  gender: z.string().optional(),
  birthDate: z.string().optional(),
  maritalStatus: z.string().optional(),
  childrenCount: z.string().optional(),
  wivesCount: z.string().optional(),
  mobile: z.string().optional(),
  residenceArea: z.string().optional(),
  residenceDetail: z.string().optional(),
  registryNumber: z.string().optional(),
  registryPlace: z.string().optional(),
  birthCountry: z.string().optional(),
  governorate: z.string().optional(),
  cityDistrict: z.string().optional(),
  subDistrict: z.string().optional(),
  // Step 4
  lastQualification: z.string().optional(),
  hasDisability: z.string().optional(),
  disabilityType: z.string().optional(),
  disabilityCard: z.string().optional(),
  status: z.string().optional(),
  statusDetail: z.string().optional(),
  centralNotes: z.string().optional(),
  shamCashAccount: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface SuccessData {
  editToken: string;
  employeeId: string;
  tokenHours: number;
}

export function Register() {
  const { lang } = useLang();
  const [step, setStep] = useState(0);
  const [success, setSuccess] = useState<SuccessData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const methods = useForm<FormData>({ resolver: zodResolver(schema), mode: "onBlur" });

  const handleVerified = () => setStep(1);

  const handleNext = async () => {
    if (step === 2) {
      const ok = await methods.trigger(["firstName", "familyName", "nationalId"]);
      if (!ok) return;
    }
    setStep(s => Math.min(s + 1, 3));
  };

  const handleBack = () => setStep(s => Math.max(s - 1, 0));

  const handleEditStep = (targetStep: number) => setStep(targetStep);

  const handleSubmit = async () => {
    const valid = await methods.trigger();
    if (!valid) return;
    setSubmitting(true);
    try {
      const data = await apiRequest<SuccessData>("POST", "/api/form/submit", methods.getValues());
      setSuccess(data);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const editUrl = success ? `${window.location.origin}/edit/${success.editToken}` : "";

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center p-4">
        <div className="glass-card rounded-2xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4 animate-fade-in">
            <div className="text-4xl">✅</div>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {lang === "ar" ? "تم استلام بياناتك بنجاح!" : "Data submitted successfully!"}
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            {lang === "ar"
              ? `شكراً ${methods.getValues("firstName")} ${methods.getValues("familyName")}`
              : `Thank you ${methods.getValues("firstName")} ${methods.getValues("familyName")}`}
          </p>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
              {lang === "ar" ? "رابط التعديل الشخصي" : "Personal Edit Link"}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={editUrl}
                className="flex-1 text-xs bg-white dark:bg-slate-800 border rounded px-2 py-1.5 font-mono text-slate-600 dark:text-slate-400 select-all"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => { navigator.clipboard.writeText(editUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              >
                {copied ? "✓" : "📋"}
              </Button>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              ⏱️ {lang === "ar"
                ? `صالح لـ ${success.tokenHours} ساعة فقط — يظهر مرة واحدة فقط، احتفظ به الآن`
                : `Valid for ${success.tokenHours} hour(s) only — save it now`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-700/80 shadow-sm no-print">
        <div className="max-w-3xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-white text-base">🏥</span>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">
                {lang === "ar" ? "نموذج منصة نواة لمديريات الصحة والهيئات" : "Nawah Platform — Health Directorates Form"}
              </p>
              <p className="text-[10px] text-muted-foreground">منصة نواة — وزارة الصحة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <span className="text-xs font-semibold text-muted-foreground hidden sm:flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                {lang === "ar" ? `الخطوة ${step + 1} من 4` : `Step ${step + 1} of 4`}
              </span>
            )}
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
        {step > 0 && (
          <div className="max-w-3xl mx-auto px-4 pb-3 pt-1">
            <FormStepper currentStep={step} />
          </div>
        )}
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        <FormProvider {...methods}>
          {step === 0 && <Step1InviteCode onVerified={handleVerified} />}
          {step === 1 && <div className="animate-fade-in"><Step2OrgJob /></div>}
          {step === 2 && <div className="animate-fade-in"><Step3Personal /></div>}
          {step === 3 && (
            <div className="animate-fade-in">
              <Step4ReviewPrint onEditStep={handleEditStep} onSubmit={handleSubmit} submitting={submitting} />
            </div>
          )}
        </FormProvider>
      </main>

      {/* Sticky Footer Navigation */}
      {step > 0 && step < 3 && (
        <div className="fixed bottom-0 left-0 right-0 no-print bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-700 shadow-lg z-40">
          <div className="max-w-3xl mx-auto px-4 py-3 flex justify-between items-center">
            <Button variant="outline" onClick={handleBack}>
              {lang === "ar" ? <><ChevronRight className="h-4 w-4" /> رجوع</> : <>Back <ChevronLeft className="h-4 w-4" /></>}
            </Button>
            <Button onClick={handleNext}>
              {lang === "ar" ? <>متابعة <ChevronLeft className="h-4 w-4" /></> : <>Next <ChevronRight className="h-4 w-4" /></>}
            </Button>
          </div>
        </div>
      )}
      {step > 0 && step < 3 && <div className="h-20" />}

      {/* Footer credit */}
      <footer className="no-print text-center py-5 border-t border-slate-100 dark:border-slate-800 mt-4 space-y-1.5">
        <p className="text-xs text-slate-400 dark:text-slate-600">
          منصة مسار &copy; {new Date().getFullYear()}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          تصميم وبرمجة{" "}
          <span className="font-semibold text-primary/70">إبراهيم الصيداوي</span>
        </p>
        <div className="flex items-center justify-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
          <a
            href="https://wa.me/963933706403"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-emerald-500 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            963933706403+
          </a>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <a
            href="https://wa.me/963948500505"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-emerald-500 transition-colors"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            963948500505+
          </a>
        </div>
      </footer>
    </div>
  );
}
