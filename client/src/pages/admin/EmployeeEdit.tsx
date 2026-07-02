import { useEffect, useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, useLocation } from "wouter";
import { Loader2, ArrowRight, Save } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Step2OrgJob } from "@/components/steps/Step2OrgJob";
import { Step3Personal } from "@/components/steps/Step3Personal";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLang } from "@/context/LanguageContext";

const schema = (ar: boolean) => z.object({
  firstName: z.string().min(1, ar ? "الاسم مطلوب" : "First Name is required"),
  familyName: z.string().min(1, ar ? "النسبة مطلوبة" : "Family Name is required"),
  nationalId: z.string().regex(/^\d{11}$/, ar ? "الرقم الوطني يجب أن يكون 11 رقماً بالضبط" : "National ID must be exactly 11 digits"),
}).passthrough();

export function EmployeeEdit() {
  const { id } = useParams<{ id: string }>();
  const [, nav] = useLocation();
  const { lang } = useLang();
  const ar = lang === "ar";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const methods = useForm({ resolver: zodResolver(schema(ar)), mode: "onBlur" });

  useEffect(() => {
    apiRequest("GET", `/api/admin/employees/${id}`)
      .then((data: any) => { methods.reset(data.employee); })
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    const valid = await methods.trigger(["firstName", "familyName", "nationalId"]);
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      await apiRequest("PATCH", `/api/admin/employees/${id}`, methods.getValues());
      queryClient.invalidateQueries({ queryKey: ["employee", id] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      nav(`/admin/employees/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Layout><div className="flex items-center justify-center h-64"><Loader2 className="h-10 w-10 animate-spin text-[#1d4ed8]" /></div></Layout>;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => nav(`/admin/employees/${id}`)}><ArrowRight className="h-5 w-5" /></Button>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{ar ? "تعديل بيانات الموظف" : "Edit Employee Data"}</h1>
        </div>
        {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg text-sm text-red-700 dark:text-red-400">{error}</div>}
        <FormProvider {...methods}>
          <Step2OrgJob />
          <Step3Personal />
        </FormProvider>
        <div className="flex justify-end pb-8 gap-3">
          <Button variant="outline" onClick={() => nav(`/admin/employees/${id}`)}>{ar ? "إلغاء" : "Cancel"}</Button>
          <Button onClick={handleSave} disabled={saving} size="lg">
            {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
            {ar ? "حفظ التعديلات" : "Save Changes"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
