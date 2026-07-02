import { createContext, useContext, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface AppSettings {
  appName: string;
  appLogoUrl?: string | null;
  defaultLanguage?: string;
}

const DEFAULT: AppSettings = { appName: "مسار" };
const PUBLIC_KEY = ["/api/projects/app-info"];

const AppSettingsContext = createContext<AppSettings>(DEFAULT);

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();

  // Public endpoint — no auth needed, works on login/public pages
  const { data } = useQuery<AppSettings>({
    queryKey: PUBLIC_KEY,
    queryFn: () =>
      fetch("/api/projects/app-info")
        .then(r => (r.ok ? r.json() : DEFAULT))
        .catch(() => DEFAULT),
    staleTime: 0,          // always revalidate so name changes show immediately
    gcTime: 1000 * 60 * 5,
    retry: false,
  });

  // When the admin saves global-settings, also invalidate our public cache
  useEffect(() => {
    const unsubscribe = qc.getQueryCache().subscribe(event => {
      if (
        event.type === "updated" &&
        JSON.stringify(event.query.queryKey) === JSON.stringify(["/api/projects/global-settings"]) &&
        event.action.type === "success"
      ) {
        qc.invalidateQueries({ queryKey: PUBLIC_KEY });
      }
    });
    return unsubscribe;
  }, [qc]);

  const settings: AppSettings = {
    appName: data?.appName || DEFAULT.appName,
    appLogoUrl: data?.appLogoUrl,
    defaultLanguage: data?.defaultLanguage,
  };

  // Keep browser tab title in sync
  useEffect(() => {
    document.title = `${settings.appName} — منصة إدارة نماذج التسجيل والبيانات`;
  }, [settings.appName]);

  return (
    <AppSettingsContext.Provider value={settings}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  return useContext(AppSettingsContext);
}
