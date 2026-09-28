import type {
  AnalyticsSummaryDto, CategoryDto, DepartmentDto, DuplicateReviewItemDto, FraudFlagDto, LoginResponse,
  MunicipalityDto, PagedResult, ReportDetailDto, ReportDto, ReportFilters,
  ReportListItemDto, ReportPriority, ReportStatus, StaffUserDto, SystemicPatternDto, TrendPoint,
} from './types';

/** Localhost by default so a fresh clone runs with no configuration; override with VITE_API_URL. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5216';

/**
 * The staff session itself lives in an httpOnly cookie the backend sets on login — deliberately
 * unreadable from here, so a browser-side XSS bug has nothing to steal. This module only tracks
 * whether *this page load* has established one, which is enough to tell "the login form just rejected
 * a bad password" (no session yet) apart from "a previously-good session just went stale" (session
 * existed, now doesn't) — see the 401 handling in `request` below.
 */
export const session = {
  active: false,
  mark: () => { session.active = true; },
  clear: () => { session.active = false; },
};

export class ApiError extends Error {
  // Explicit fields rather than constructor parameter properties: the app's tsconfig enables
  // `erasableSyntaxOnly`, and parameter properties emit runtime code, so they are rejected there.
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** Uploaded photos are served as site-relative paths by the API; make them absolute for <img>. */
export const mediaUrl = (path?: string) =>
  !path ? undefined : path.startsWith('http') ? path : `${API_URL}${path}`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  // credentials: 'include' — the session cookie rides every request automatically; there is no token
  // for this code to attach by hand any more.
  const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });

  if (response.status === 401 && session.active) {
    // Gated on `session.active`: this is only ever a *previously authenticated* request going bad
    // (the cookie's token expired, was revoked, or — after a database reset — still parses fine but
    // names a staff id that no longer exists). A 401 with no session established is the login call
    // itself rejecting bad credentials, which is a completely different situation and must not bounce
    // someone off the login page they're already on.
    session.clear();
    if (!location.pathname.startsWith('/login')) location.assign('/login');
    throw new ApiError(401, 'Sesioni ka skaduar.');
  }

  if (!response.ok) {
    // The API speaks RFC-7807, so prefer its message over a generic status line.
    let title = `Kërkesa dështoi (${response.status})`;
    let detail: string | undefined;
    try {
      const problem = await response.json();
      title = problem.title ?? title;
      detail = problem.detail;
    } catch { /* non-JSON error body — keep the status line */ }
    throw new ApiError(response.status, title, detail);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryString(filters: ReportFilters): string {
  const params = new URLSearchParams();
  filters.status?.forEach(s => params.append('status', s));
  filters.categoryCode?.forEach(c => params.append('categoryCode', c));
  filters.priority?.forEach(p => params.append('priority', p));
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  if (filters.assignedToMe) params.set('assignedToMe', 'true');
  if (filters.hasPendingDuplicates) params.set('hasPendingDuplicates', 'true');
  if (filters.needsReview) params.set('needsReview', 'true');
  if (filters.disputed) params.set('disputed', 'true');
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.sort) params.set('sort', filters.sort);
  params.set('page', String(filters.page ?? 1));
  params.set('pageSize', String(filters.pageSize ?? 25));
  return params.toString();
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<StaffUserDto>('/api/v1/auth/me'),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),

  categories: () => request<CategoryDto[]>('/api/v1/categories'),
  departments: () => request<DepartmentDto[]>('/api/v1/departments'),
  municipality: () => request<MunicipalityDto>('/api/v1/municipality'),
  staffUsers: () => request<StaffUserDto[]>('/api/v1/staff/users'),

  reports: (filters: ReportFilters) =>
    request<PagedResult<ReportListItemDto>>(`/api/v1/staff/reports?${queryString(filters)}`),

  report: (id: string) => request<ReportDetailDto>(`/api/v1/staff/reports/${id}`),

  changeStatus: (id: string, status: ReportStatus, note?: string) =>
    request<ReportDto>(`/api/v1/staff/reports/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note }),
    }),

  assign: (id: string, body: { departmentId?: string; staffUserId?: string; note?: string }) =>
    request<ReportDto>(`/api/v1/staff/reports/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Overrides the AI's category. The original suggestion is preserved server-side. */
  overrideCategory: (id: string, body: { categoryId: string; priority?: ReportPriority; reason?: string }) =>
    request<ReportDto>(`/api/v1/staff/reports/${id}/category`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /**
   * The case dossier as a .docx. Not routed through `request()`: the response is a binary Word
   * document, not JSON — it still needs the session cookie, via `credentials: 'include'`, since a
   * plain <a href> download link wouldn't get the 401-handling `request()` gives every other call.
   */
  async downloadDossier(id: string, publicRef: string): Promise<void> {
    const response = await fetch(`${API_URL}/api/v1/staff/reports/${id}/dossier`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new ApiError(response.status, `Shkarkimi i dosjes dështoi (${response.status}).`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Dosje-${publicRef}.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download in some browsers; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  duplicates: () => request<DuplicateReviewItemDto[]>('/api/v1/staff/duplicates'),
  confirmDuplicate: (candidateId: string) =>
    request<ReportDto>(`/api/v1/staff/duplicates/${candidateId}/confirm`, { method: 'POST' }),
  rejectDuplicate: (candidateId: string) =>
    request<void>(`/api/v1/staff/duplicates/${candidateId}/reject`, { method: 'POST' }),

  analytics: () => request<AnalyticsSummaryDto>('/api/v1/staff/analytics/summary'),
  trend: (days = 30) => request<TrendPoint[]>(`/api/v1/staff/analytics/trend?days=${days}`),

  /** Open (Pending or Acknowledged) systemic patterns, most recently active first. */
  patterns: () => request<SystemicPatternDto[]>('/api/v1/staff/patterns'),
  pattern: (id: string) => request<SystemicPatternDto>(`/api/v1/staff/patterns/${id}`),
  acknowledgePattern: (id: string) =>
    request<void>(`/api/v1/staff/patterns/${id}/acknowledge`, { method: 'POST' }),
  /** Marks the pattern a false positive. Its member reports are untouched — each is still a real case
   *  someone still has to close; only the grouping itself is what gets rejected. */
  dismissPattern: (id: string) =>
    request<void>(`/api/v1/staff/patterns/${id}/dismiss`, { method: 'POST' }),
  /** Re-runs the AI synthesis against the pattern's current membership — manual, never automatic. */
  refreshPattern: (id: string) =>
    request<SystemicPatternDto>(`/api/v1/staff/patterns/${id}/refresh`, { method: 'POST' }),

  /** Pending fraud flags, most recent first — every kind, automated and staff-raised. */
  fraudFlags: () => request<FraudFlagDto[]>('/api/v1/staff/fraud'),
  acknowledgeFraudFlag: (id: string) =>
    request<void>(`/api/v1/staff/fraud/${id}/acknowledge`, { method: 'POST' }),
  dismissFraudFlag: (id: string) =>
    request<void>(`/api/v1/staff/fraud/${id}/dismiss`, { method: 'POST' }),
  /** A clerk's own fraud call on a specific report — the one kind with no automated check behind it. */
  raiseFraudFlag: (reportId: string, reason: string) =>
    request<FraudFlagDto>(`/api/v1/staff/reports/${reportId}/fraud-flags`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
};
