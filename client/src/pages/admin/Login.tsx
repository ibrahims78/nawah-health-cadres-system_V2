import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { ShieldCheck, Loader2, Eye, EyeOff, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useAuth } from "@/context/AuthContext";

const schema = z.object({
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
  rememberMe: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export function Login() {
  const [, nav] = useLocation();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError("");
    try {
      await login(data.email, data.password, data.rememberMe);
      nav("/admin/projects");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative blobs */}
      <div className="auth-blob w-[32rem] h-[32rem] bg-primary top-[-12rem] right-[-12rem]" />
      <div className="auth-blob w-96 h-96 bg-secondary bottom-[-8rem] left-[-8rem]" />
      <div className="auth-blob w-64 h-64 bg-violet-500 top-1/2 left-1/4 opacity-[0.08]" />

      {/* Top controls */}
      <div className="absolute top-4 left-4 flex gap-2">
        <ThemeToggle />
        <LanguageToggle />
      </div>

      {/* Platform badge */}
      <div className="absolute top-4 right-4">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/70 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/60 backdrop-blur-sm shadow-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">مسار</span>
        </div>
      </div>

      <div className="w-full max-w-md relative z-10 animate-fade-in">
        {/* Brand header above card */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-card-lg mb-4">
            <ShieldCheck className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight">
            لوحة الإدارة
          </h1>
          <p className="text-muted-foreground text-sm mt-1.5">
            منصة إدارة نماذج التسجيل والبيانات
          </p>
        </div>

        <div className="glass-card rounded-3xl p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <Label htmlFor="email" required className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                البريد الإلكتروني
              </Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                error={!!errors.email}
                className="mt-1.5"
                autoFocus
                placeholder="admin@health.gov.sy"
                data-testid="input-email"
              />
              {errors.email && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <span>⚠</span> {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="password" required className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                كلمة المرور
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="password"
                  type={showPass ? "text" : "password"}
                  {...register("password")}
                  error={!!errors.password}
                  placeholder="••••••••"
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <span>⚠</span> {errors.password.message}
                </p>
              )}
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer group">
              <input
                type="checkbox"
                {...register("rememberMe")}
                className="w-4 h-4 rounded accent-primary cursor-pointer"
                data-testid="checkbox-rememberMe"
              />
              <span className="text-sm text-slate-600 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200 transition-colors">
                تذكرني لمدة 30 يوم
              </span>
            </label>

            {error && (
              <div className="error-box">
                <span className="text-lg shrink-0">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-bold shadow-md hover:shadow-lg"
              disabled={loading}
              data-testid="button-login"
            >
              {loading ? (
                <><Loader2 className="h-5 w-5 animate-spin ml-2" />جاري الدخول...</>
              ) : (
                <><LogIn className="h-5 w-5 ml-2" />تسجيل الدخول</>
              )}
            </Button>
          </form>
        </div>

        <div className="text-center mt-5 space-y-2">
          <p className="text-xs text-muted-foreground">
            منصة مسار &copy; {new Date().getFullYear()}
          </p>
          <div className="flex flex-col items-center gap-1">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              تصميم وبرمجة{" "}
              <span className="font-semibold text-primary/80">إبراهيم الصيداوي</span>
            </p>
            <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
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
          </div>
        </div>
      </div>
    </div>
  );
}
