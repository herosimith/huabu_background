const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");

export function appUrl(path: string): string {
  if (/^(?:blob:|data:|https?:)/i.test(path)) return path;
  return `${appBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(appUrl(path), { credentials: "same-origin", ...init });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `HTTP ${response.status}`;
    throw new ApiError(response.status, message);
  }
  return body as T;
}
