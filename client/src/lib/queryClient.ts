import { QueryClient } from "@tanstack/react-query";

export async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("استجابة غير صالحة من الخادم");
  }
}

async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  const url = queryKey[0] as string;
  return fetchJson(url);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      retry: 1,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

export async function apiRequest<T = any>(
  method: string,
  url: string,
  body?: any,
  timeoutMs: number = 30_000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const e: any = new Error(body.error || "حدث خطأ غير متوقع");
      e.status = res.status;
      e.body = body;
      throw e;
    }
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("استجابة غير صالحة من الخادم");
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("انتهت مهلة الطلب — تحقق من اتصالك بالإنترنت وأعد المحاولة");
    }
    if (err.message === "Failed to fetch") {
      throw new Error("تعذّر الوصول إلى الخادم — تحقق من اتصالك بالإنترنت");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
