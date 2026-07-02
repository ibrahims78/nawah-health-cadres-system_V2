import { useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams } from "wouter";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Step2OrgJob } from "@/components/steps/Step2OrgJob";
import { Step3Personal } from "@/components/steps/Step3Personal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { useLang } from "@/context/LanguageContext";
import { apiRequest } from "@/lib/queryClient";

const schema = z.object({
  firstName: z.string().min(1, "firstName_required"),
  familyName: z.string().min(1, "familyName_required"),
  nationalId: z.string().regex(/^\d{11}$/, "nationalId_invalid"),
}).passthrough();

export function EditForm() {
  const { token } = useParams<{ token: string }>();
  const { lang } = useLang();
  const isAr = lang === "ar";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Update schema messages based on language
  const translatedSchema = z.object({
    firstName: z.string().min(1, isAr ? "الاسم مطلوب" : "First name is required"),
    familyName: z.string().min(1, isAr ? "النسبة مطلوبة" : "Family name is required"),
    nationalId: z.string().regex(/^\d{11}$/, isAr ? "الرقم الوطني يجب أن يكون 11 رقماً بالضبط" : "National ID must be exactly 11 digits"),
  }).passthrough();

  const methods = useForm({ resolver: zodResolver(translatedSchema), mode: "onBlur" });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiRequest("GET", `/api/form/edit/${token}`);
        methods.reset(data);
      } catch (err: any) {
        if (err.message?.includes("انتهت")) setExpired(true);
        else setError(err.message || (isAr ? "رابط غير صالح" : "Invalid link"));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [token, isAr]);

  const handleSave = async () => {
    const valid = await methods.trigger(["firstName", "familyName", "nationalId"]);
    if (!valid) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/form/edit/${token}`, methods.getValues());
      setSaved(true);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-[#1d4ed8]" />
    </div>
  );

  if (expired) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 max-w-md text-center">
        <AlertCircle className="h-16 w-16 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
          {isAr ? "انتهت صلاحية الرابط" : "Link Expired"}
        </h2>
        <p className="text-slate-600 dark:text-slate-400">
          {isAr ? "رابط التعديل صالح لـ 48 ساعة فقط. تواصل مع إدارتك للحصول على رابط جديد." : "The edit link is valid for 48 hours only. Contact your department for a new link."}
        </p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 max-w-md text-center">
        <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">{isAr ? "رابط غير صالح" : "Invalid Link"}</h2>
        <p className="text-slate-600 dark:text-slate-400">{error}</p>
      </div>
    </div>
  );

  if (saved) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card rounded-2xl p-8 max-w-md text-center">
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
          {isAr ? "تم حفظ التعديلات!" : "Changes Saved!"}
        </h2>
        <p className="text-slate-600 dark:text-slate-400">
          {isAr ? "تم تحديث بياناتك بنجاح." : "Your data has been updated successfully."}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-900 dark:to-slate-800">
      <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {isAr ? "✏️ تعديل بيانات النموذج — منصة مسارات" : "✏️ Edit Form Data — Masarat Platform"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <FormProvider {...methods}>
          <Step2OrgJob />
          <Step3Personal />
        </FormProvider>
        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} disabled={saving} size="lg">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin ml-2" /> {isAr ? "جاري الحفظ..." : "Saving..."}</> : (isAr ? "💾 حفظ التعديلات" : "💾 Save Changes")}
          </Button>
        </div>
      </main>
    </div>
  );
}
