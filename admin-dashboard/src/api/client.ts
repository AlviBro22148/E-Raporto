import type {
  AnalyticsSummaryDto, CategoryDto, DepartmentDto, DuplicateReviewItemDto, LoginResponse,
  MunicipalityDto, PagedResult, PhotoReuseFlagDto, ReportDetailDto, ReportDto, ReportFilters,
  ReportListItemDto, ReportPriority, ReportStatus, StaffUserDto, SystemicPatternDto, TrendPoint,
} from './types';

/** Localhost by default so a fresh clone runs with no configuration; override with VITE_API_URL. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5216';

const TOKEN_KEY = 'e-raporto.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
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
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (response.status === 401 && token) {
    // Gated on `token`: this is only ever a *previously authenticated* request going bad (the
    // token expired, was revoked, or — after a database reset — still parses fine but names a
    // staff id that no longer exists). A 401 with no token attached is the login call itself
    // rejecting bad credentials, which is a completely different situation and must not clear a
    // session that was never established or bounce someone off the login page they're already on.
    tokenStore.clear();
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
   * document, not JSON, and the endpoint needs the bearer token, so it cannot simply be a link.
   */
  async downloadDossier(id: string, publicRef: string): Promise<void> {
    const token = tokenStore.get();
    const response = await fetch(`${API_URL}/api/v1/staff/reports/${id}/dossier`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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

  /** Pending reused-photo flags, most recent first. */
  photoReuseFlags: () => request<PhotoReuseFlagDto[]>('/api/v1/staff/photo-reuse'),
  acknowledgePhotoReuseFlag: (id: string) =>
    request<void>(`/api/v1/staff/photo-reuse/${id}/acknowledge`, { method: 'POST' }),
  dismissPhotoReuseFlag: (id: string) =>
    request<void>(`/api/v1/staff/photo-reuse/${id}/dismiss`, { method: 'POST' }),
};
