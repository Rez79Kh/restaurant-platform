// Browser-side fetch wrapper. Every failure becomes an ApiError with a Persian
// message, so no request can fail silently.

export class ApiError extends Error {
  constructor(
    readonly status: number, // 0 = network failure (offline, timeout, DNS)
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره امتحان کنید.");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    window.location.replace("/login");
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.message ?? "خطای غیرمنتظره‌ای رخ داد.",
      data?.error?.details,
    );
  }
  return data as T;
}

export const newIdempotencyKey = () => crypto.randomUUID();
