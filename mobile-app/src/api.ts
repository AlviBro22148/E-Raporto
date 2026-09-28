import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { t } from './i18n';

/* ── Types (mirror of the C# DTOs) ────────────────────────────────────────── */

export type ReportStatus =
  | 'Submitted' | 'InReview' | 'Assigned' | 'InProgress' | 'Resolved' | 'Rejected' | 'Merged';
export type ReportPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type ClassificationSource = 'RuleBased' | 'Llm' | 'Manual';

export interface Category {
  id: string; code: string; nameSq: string; nameEn: string; description: string;
  colorHex: string; icon: string; defaultDepartmentName?: string;
}

export interface Municipality {
  id: string; name: string; slug: string;
  centerLat: number; centerLng: number; defaultMapRadiusM: number;
}

export interface ReportPin {
  id: string; publicRef: string; lat: number; lng: number; status: ReportStatus;
  categoryCode?: string; colorHex: string; confirmationCount: number; createdAt: string;
  verifiedConfirmed: boolean;
}

export interface CategoryRef { id: string; code: string; nameSq: string; nameEn: string; colorHex: string; icon: string }
export interface DepartmentRef { id: string; shortName: string; name: string; slaHours: number }

export interface AiBlock {
  suggestedCategoryCode?: string; suggestedCategoryNameSq?: string; suggestedCategoryNameEn?: string;
  suggestedPriority?: ReportPriority;
  confidence?: number; reasoning?: string; reasoningEn?: string; summarySq?: string;
  source: ClassificationSource; model?: string;
  isOverridden: boolean; overrideReason?: string; isLowConfidence: boolean;
}

export type VerificationOutcome = 'Confirmed' | 'Disputed';

export interface ResolutionVerification {
  id: string;
  outcome: VerificationOutcome;
  comment?: string | null;
  photoUrl?: string | null;
  distanceMeters?: number | null;
  isNearOriginalPin: boolean;
  createdAt: string;
}

/** A resolution this citizen has been asked to check and has not answered yet. */
export interface PendingVerification {
  reportId: string; publicRef: string; title: string; titleEn?: string | null;
  categoryNameSq?: string | null; categoryNameEn?: string | null; categoryColorHex?: string | null;
  photoUrl?: string | null;
  latitude: number; longitude: number; addressText?: string | null;
  departmentShortName?: string | null;
  /** The note the clerk left when closing it — the claim being checked. */
  resolutionNote?: string | null;
  createdAt: string; resolvedAt: string;
}

/** SharedCause: one identifiable thing likely explains every member — a single inspection could close
 *  them all. SystemicCondition: distinct local causes, but the cluster points at a broader structural
 *  problem — belongs in planning, not a work order. Uncertain: the AI honestly can't tell which. */
export type ConnectionType = 'SharedCause' | 'SystemicCondition' | 'Uncertain';
export type PatternReviewStatus = 'Pending' | 'Acknowledged' | 'Dismissed';

export interface SystemicPatternMember {
  id: string; publicRef: string; title: string; titleEn?: string | null; status: ReportStatus;
  addressText?: string | null; createdAt: string;
}

/** A cluster of DIFFERENT reports the system suspects share a root cause or a wider structural
 *  condition — the counterpart to duplicate detection, which links the SAME physical incident. Never
 *  merges its members; each stays its own case, inspected and closed on its own. */
export interface SystemicPattern {
  id: string; category: CategoryRef; department?: DepartmentRef | null;
  centroidLat: number; centroidLng: number; memberCount: number;
  /** Null only when the AI synthesis never ran — the pattern is still real either way. */
  summarySq?: string | null; connectionType?: ConnectionType | null; confidence?: number | null;
  reviewStatus: PatternReviewStatus; detectedAt: string; lastReportAt: string;
  members: SystemicPatternMember[];
}

export interface Report {
  id: string; publicRef: string; title: string; titleEn?: string | null; description: string;
  /** Bilingual pair for `description` — see `src/i18n/index.tsx`'s `reportDescription()`. Null on the
   *  rule-based classification fallback (no AI, no translation available). */
  descriptionSq?: string | null; descriptionEn?: string | null;
  status: ReportStatus; priority: ReportPriority;
  category?: CategoryRef; department?: DepartmentRef;
  assignedTo?: { id: string; fullName: string };
  latitude: number; longitude: number; addressText?: string;
  photos: { url: string }[];
  /** The reporter's pseudonymous handle, e.g. "DF2BA3". Never a name — see CitizenUser.Pseudonym. */
  reporterLabel: string;
  /** True when the signed-in citizen is the author. */
  isMine: boolean;
  /** Whether the signed-in citizen already confirmed it; null for staff/anonymous callers. */
  hasConfirmed?: boolean | null;
  confirmationCount: number; mergedIntoReportId?: string; mergedIntoPublicRef?: string;
  ai: AiBlock;
  createdAt: string; updatedAt: string; acknowledgedAt?: string; resolvedAt?: string;
  slaDueAt?: string; isSlaBreached: boolean;
  /** The reporter's latest verdict on a resolution. Kept after a reopen, on purpose. */
  verification?: ResolutionVerification | null;
  /** True only for the reporter, only while the current resolution is unanswered. */
  awaitingMyVerification: boolean;
  /** A soft, citizen-safe sentence when this report has been grouped into a systemic pattern — never
   *  the AI's connection-type verdict or sibling references. The full pattern is staff-only, on
   *  ReportDetail.pattern. Null whenever there is no pattern, or it was dismissed. */
  patternNote?: string | null;
  /** English counterpart of `patternNote` — a fixed sentence, not per-report AI text, so it's just
   *  written in both languages rather than translated. */
  patternNoteEn?: string | null;
}

export interface ReportListItem {
  id: string; publicRef: string; title: string; titleEn?: string | null; summarySq?: string;
  status: ReportStatus; priority: ReportPriority;
  category?: CategoryRef; department?: DepartmentRef;
  latitude: number; longitude: number; addressText?: string; thumbnailUrl?: string;
  reporterLabel: string;
  confirmationCount: number; pendingDuplicateCount: number;
  aiConfidence?: number; classificationSource: ClassificationSource;
  createdAt: string; slaDueAt?: string; isSlaBreached: boolean;
  /** Set only when a verdict stands against this report's current resolution. */
  verificationOutcome?: VerificationOutcome | null;
}

export interface StatusHistoryEntry {
  id: string; fromStatus?: ReportStatus; toStatus: ReportStatus;
  note?: string; noteEn?: string; changedByLabel: string; createdAt: string;
}

export interface ReportDetail {
  report: Report;
  statusHistory: StatusHistoryEntry[];
  duplicateCandidates: DuplicateCandidate[];
  allowedNextStatuses: ReportStatus[];
  /** The full systemic pattern this report belongs to, staff-only. Null when it belongs to none. */
  pattern?: SystemicPattern | null;
  /** Every fraud flag naming this report, either side of a pairing, dismissed ones included — the full
   *  history, not just what's still pending in the queue. */
  fraudFlags?: FraudFlag[] | null;
}

/* ── Accounts ────────────────────────────────────────────────────────────── */

export interface CitizenUser {
  id: string; fullName: string; email: string; phone?: string | null; createdAt: string;
  preferredLocale: string;
}

export interface StaffUser {
  id: string; fullName: string; email: string; jobTitle?: string | null;
  role: 'Admin' | 'Supervisor' | 'FieldAgent';
  departmentId?: string | null; departmentName?: string | null;
}

export interface CitizenSession { token: string; expiresAt: string; user: CitizenUser }
export interface StaffSession { token: string; expiresAt: string; user: StaffUser }

/* ── Staff views ─────────────────────────────────────────────────────────── */

export interface PagedResult<T> {
  items: T[]; page: number; pageSize: number; total: number; totalPages: number;
}

export interface DuplicateReviewItem {
  candidateId: string;
  newReport: ReportListItem;
  existingReport: ReportListItem;
  distanceMeters: number; textSimilarity: number; score: number; method: string;
  createdAt: string;
}

/** Every reason a report might be worth a fraud review, unified — see the backend's FraudFlagKind for
 *  what each kind actually checks. relatedReport is only set for PhotoReuse and TemplatedText, the two
 *  kinds that point at a pairing rather than a single report. */
export type FraudFlagKind =
  | 'PhotoReuse' | 'DescriptionMismatch' | 'SeverityExaggeration' | 'StockPhoto'
  | 'PhotoOfPhoto' | 'GpsMismatch' | 'TemplatedText' | 'StaffFlagged';
export type FraudReviewStatus = 'Pending' | 'Acknowledged' | 'Dismissed';

/**
 * None of these are proof on their own — reusing a photo, text that reads templated, a photo whose GPS
 * doesn't match the pin, all have an honest explanation as often as a dishonest one. Nothing here ever
 * changes either report; same "system proposes, human decides" shape as duplicates and patterns.
 */
export interface FraudFlag {
  flagId: string;
  kind: FraudFlagKind;
  status: FraudReviewStatus;
  reasoning: string;
  /** Meaning depends on kind: Hamming distance out of 64 (PhotoReuse), metres (GpsMismatch), 0-1
   *  word-overlap (TemplatedText), Claude's own calibrated confidence 0-1 (the four vision checks).
   *  Null for StaffFlagged — a clerk's judgement doesn't get a fake number attached. */
  score?: number | null;
  report: ReportListItem;
  relatedReport?: ReportListItem | null;
  raisedByStaffName?: string | null;
  reviewedByStaffName?: string | null;
  createdAt: string;
}

export interface FraudKindStat { kind: FraudFlagKind; count: number }

export interface CategoryStat {
  code: string; nameSq: string; nameEn: string; colorHex: string; count: number; avgHoursToResolution?: number;
}
export interface StatusStat { status: ReportStatus; count: number }
export interface DepartmentStat {
  id: string; shortName: string; open: number; resolved: number;
  slaBreaches: number; avgHoursToResolution?: number;
}

export interface AnalyticsSummary {
  totalReports: number; openReports: number; resolvedReports: number;
  avgHoursToAcknowledge?: number; avgHoursToResolution?: number;
  slaBreachCount: number; duplicatesMerged: number; pendingDuplicateReviews: number;
  /** Share of AI classifications staff did NOT override — an honest proxy, not measured accuracy. */
  aiAgreementRate?: number; aiClassifiedCount: number; aiOverriddenCount: number;
  byCategory: CategoryStat[]; byStatus: StatusStat[]; byDepartment: DepartmentStat[];
  /** Systemic patterns not yet dismissed — Pending or Acknowledged. */
  openSystemicPatterns: number;
  /** Fraud flags awaiting a staff decision — every kind, automated and staff-raised. */
  pendingFraudFlags: number;
  /** Flags a clerk agreed were worth following up on. Stats only — no automatic effect on the
   *  reporter's account, a deliberate scope decision for the pilot. */
  confirmedFraudFlags: number;
  /** Flags a clerk marked a false positive. */
  dismissedFraudFlags: number;
  /** Breakdown of the currently-pending flags by kind. */
  fraudFlagsByKind: FraudKindStat[];
}

export interface DuplicateCandidate {
  candidateId: string; reportId: string; publicRef: string; title: string; titleEn?: string | null; status: ReportStatus;
  categoryNameSq?: string; categoryNameEn?: string; colorHex?: string;
  distanceMeters: number; textSimilarity: number; score: number; method: string;
  thumbnailUrl?: string; latitude: number; longitude: number;
  confirmationCount: number; createdAt: string;
}

export interface Classification {
  categoryCode: string; categoryNameSq: string; categoryNameEn: string; confidence: number; priority: ReportPriority;
  reasoning: string; reasoningEn?: string; summarySq?: string; source: ClassificationSource; model?: string;
  isLowConfidence: boolean;
}

export interface CreateReportResponse {
  report: Report;
  classification: Classification;
  duplicateCandidates: DuplicateCandidate[];
}

export interface Notification {
  id: string; reportId: string; reportPublicRef: string; type: string;
  title: string; body: string; titleEn: string; bodyEn: string; isRead: boolean; createdAt: string;
}

/* ── Configuration ───────────────────────────────────────────────────────── */

/**
 * Expo Go runs on a physical phone, so 'localhost' points at the phone, not the dev machine.
 * We fall back to the LAN IP Metro is already serving from — which means the app usually works
 * on a teammate's phone with zero configuration. EXPO_PUBLIC_API_URL overrides everything.
 */
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:5216`;

  // Android emulators reach the host machine through 10.0.2.2, not localhost.
  return Platform.OS === 'android' ? 'http://10.0.2.2:5216' : 'http://localhost:5216';
}

export const API_URL = resolveApiUrl();

export const mediaUrl = (path?: string) =>
  !path ? undefined : path.startsWith('http') ? path : `${API_URL}${path}`;

/* ── Session token ───────────────────────────────────────────────────────── */

const TOKEN_KEY = 'e-raporto.token';
const KIND_KEY = 'e-raporto.tokenKind';

export type SessionKind = 'citizen' | 'staff';

let cachedToken: string | null = null;
let cachedKind: SessionKind | null = null;

/**
 * The signed-in identity, replacing the old anonymous device id. Kept in AsyncStorage: it is a
 * short-lived bearer token for a civic reporting app, not a banking credential, and Expo Go on a
 * shared demo phone makes SecureStore's per-device keychain more friction than protection here.
 */
export async function loadSession(): Promise<{ token: string; kind: SessionKind } | null> {
  if (cachedToken && cachedKind) return { token: cachedToken, kind: cachedKind };

  const [token, kind] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(KIND_KEY),
  ]);
  if (!token || !kind) return null;

  cachedToken = token;
  cachedKind = kind as SessionKind;
  return { token, kind: cachedKind };
}

export async function saveSession(token: string, kind: SessionKind): Promise<void> {
  cachedToken = token;
  cachedKind = kind;
  await AsyncStorage.multiSet([[TOKEN_KEY, token], [KIND_KEY, kind]]);
}

export async function clearSession(): Promise<void> {
  cachedToken = null;
  cachedKind = null;
  await AsyncStorage.multiRemove([TOKEN_KEY, KIND_KEY]);
}

/**
 * Memoizes a reference-data fetch for the lifetime of the app session. Categories, departments and the
 * municipality record are seeded once and effectively never change during a pilot, but every screen that
 * needs one calls the plain `api.x()` function independently — the new-report form, the map tab, and the
 * staff report screen were each hitting the network for the same handful of rows on every single mount.
 * Wrapping the fetcher here means the first caller pays for the request and everyone after it — on that
 * screen or any other — gets the already-resolved value, with no new caching library and no call-site
 * changes. Resets naturally on app restart, which is exactly when it's safe to refresh anyway.
 */
function cachedOnce<T>(fetcher: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = fetcher().catch(err => { inFlight = null; throw err; });
    }
    return inFlight;
  };
}

/* ── HTTP ────────────────────────────────────────────────────────────────── */

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Called when the API rejects our token, so the UI can bounce to the login screen. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await loadSession();
  const headers = new Headers(init.headers);
  if (session) headers.set('Authorization', `Bearer ${session.token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  // A phone on flaky mobile data should fail fast and let the UI offer a retry, not hang forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });

    if (!response.ok) {
      // An expired or revoked token should drop us to the login screen rather than leaving every
      // subsequent screen to fail on its own.
      if (response.status === 401) {
        await clearSession();
        onUnauthorized?.();
      }

      let message = t('api.requestFailed', { status: response.status });
      try {
        const problem = await response.json();
        message = problem.detail ?? problem.title ?? message;
      } catch { /* non-JSON body */ }
      throw new ApiError(response.status, message);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(0, t('api.timeout'));
    }
    throw new ApiError(0, t('api.networkError'));
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  /* ── Citizen auth ─────────────────────────────────────────────────────── */
  registerCitizen: (body: { fullName: string; email: string; password: string; phone?: string }) =>
    request<CitizenSession>('/api/v1/auth/citizen/register', {
      method: 'POST', body: JSON.stringify(body),
    }),
  loginCitizen: (email: string, password: string) =>
    request<CitizenSession>('/api/v1/auth/citizen/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  meCitizen: () => request<CitizenUser>('/api/v1/auth/citizen/me'),
  updateProfile: (body: { fullName?: string; phone?: string }) =>
    request<CitizenUser>('/api/v1/auth/citizen/me', { method: 'PATCH', body: JSON.stringify(body) }),
  /** Mirrors the app's own language toggle server-side — see src/i18n/index.tsx for why this needs to
   *  exist at all: a push notification is finalised and sent while the app may not be running, so there
   *  is no client-side render step left to pick the right language for it. Best-effort by the caller. */
  updatePreferredLocale: (preferredLocale: 'sq' | 'en') =>
    request<CitizenUser>('/api/v1/auth/citizen/me', { method: 'PATCH', body: JSON.stringify({ preferredLocale }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/api/v1/auth/citizen/me/change-password', {
      method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /* ── Staff auth ───────────────────────────────────────────────────────── */
  loginStaff: (email: string, password: string) =>
    request<StaffSession>('/api/v1/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password }),
    }),
  meStaff: () => request<StaffUser>('/api/v1/auth/me'),

  /* ── Reference data ───────────────────────────────────────────────────── */
  municipality: cachedOnce(() => request<Municipality>('/api/v1/municipality')),
  categories: cachedOnce(() => request<Category[]>('/api/v1/categories')),
  departments: cachedOnce(() => request<DepartmentRef[]>('/api/v1/departments')),

  mapPins: (params?: { lat?: number; lng?: number; radiusM?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.lat != null) query.set('lat', String(params.lat));
    if (params?.lng != null) query.set('lng', String(params.lng));
    if (params?.radiusM != null) query.set('radiusM', String(params.radiusM));
    query.set('limit', String(params?.limit ?? 300));
    return request<ReportPin[]>(`/api/v1/reports/map?${query}`);
  },

  report: (id: string) => request<ReportDetail>(`/api/v1/reports/${id}`),
  myReports: () => request<ReportListItem[]>('/api/v1/reports/mine'),

  createReport: (body: {
    description: string; latitude: number; longitude: number;
    deviceLatitude: number; deviceLongitude: number;
    addressText?: string; photoUrls?: string[]; categoryCodeHint?: string;
  }) => request<CreateReportResponse>('/api/v1/reports', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  /** Merges this report into an existing one and returns the parent the citizen now follows. */
  confirmDuplicate: (id: string, candidateReportId: string) =>
    request<Report>(`/api/v1/reports/${id}/confirm-duplicate`, {
      method: 'POST',
      body: JSON.stringify({ candidateReportId }),
    }),

  /** "Me too" on someone else's report, instead of filing a second ticket. */
  confirm: (id: string) => request<Report>(`/api/v1/reports/${id}/confirm`, { method: 'POST' }),

  /**
   * The reporter's answer to "is it actually fixed?".
   *
   * Everything but the verdict is optional by design — a citizen looking at an unfixed pothole with a
   * dead camera or no GPS must still be able to say no, or the resulting rate only measures the people
   * whose phones cooperated.
   */
  verifyResolution: (id: string, body: {
    outcome: VerificationOutcome; comment?: string; photoUrl?: string;
    latitude?: number; longitude?: number;
  }) => request<Report>(`/api/v1/reports/${id}/verify-resolution`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  /** Resolutions this citizen owes an answer on. Usually empty; called on every launch and foreground. */
  pendingVerifications: () => request<PendingVerification[]>('/api/v1/reports/pending-verification'),

  notifications: (unreadOnly = false) =>
    request<Notification[]>(`/api/v1/notifications?unreadOnly=${unreadOnly}`),
  markRead: (id: string) => request<void>(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<void>('/api/v1/notifications/read-all', { method: 'POST' }),

  registerPushToken: (token: string) =>
    request<void>('/api/v1/notifications/push-token', { method: 'PUT', body: JSON.stringify({ token }) }),
  unregisterPushToken: () =>
    request<void>('/api/v1/notifications/push-token', { method: 'DELETE' }),

  /* ── Staff (municipal) ────────────────────────────────────────────────── */
  staffReports: (filters: {
    status?: ReportStatus[]; categoryCode?: string[]; needsReview?: boolean;
    hasPendingDuplicates?: boolean; search?: string; sort?: string; page?: number; pageSize?: number;
  } = {}) => {
    const q = new URLSearchParams();
    filters.status?.forEach(v => q.append('status', v));
    filters.categoryCode?.forEach(v => q.append('categoryCode', v));
    if (filters.needsReview) q.set('needsReview', 'true');
    if (filters.hasPendingDuplicates) q.set('hasPendingDuplicates', 'true');
    if (filters.search?.trim()) q.set('search', filters.search.trim());
    if (filters.sort) q.set('sort', filters.sort);
    q.set('page', String(filters.page ?? 1));
    q.set('pageSize', String(filters.pageSize ?? 25));
    return request<PagedResult<ReportListItem>>(`/api/v1/staff/reports?${q}`);
  },
  staffReport: (id: string) => request<ReportDetail>(`/api/v1/staff/reports/${id}`),
  staffChangeStatus: (id: string, status: ReportStatus, note?: string) =>
    request<Report>(`/api/v1/staff/reports/${id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status, note }),
    }),
  staffOverrideCategory: (id: string, categoryId: string, reason?: string) =>
    request<Report>(`/api/v1/staff/reports/${id}/category`, {
      method: 'PATCH', body: JSON.stringify({ categoryId, reason }),
    }),
  staffAssign: (id: string, body: { departmentId?: string; staffUserId?: string; note?: string }) =>
    request<Report>(`/api/v1/staff/reports/${id}/assign`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
  staffDuplicates: () => request<DuplicateReviewItem[]>('/api/v1/staff/duplicates'),
  staffConfirmDuplicate: (candidateId: string) =>
    request<Report>(`/api/v1/staff/duplicates/${candidateId}/confirm`, { method: 'POST' }),
  staffRejectDuplicate: (candidateId: string) =>
    request<void>(`/api/v1/staff/duplicates/${candidateId}/reject`, { method: 'POST' }),
  staffAnalytics: () => request<AnalyticsSummary>('/api/v1/staff/analytics/summary'),

  /* ── Staff — systemic patterns ───────────────────────────────────────── */
  staffPatterns: () => request<SystemicPattern[]>('/api/v1/staff/patterns'),
  staffPattern: (id: string) => request<SystemicPattern>(`/api/v1/staff/patterns/${id}`),
  staffAcknowledgePattern: (id: string) =>
    request<void>(`/api/v1/staff/patterns/${id}/acknowledge`, { method: 'POST' }),
  /** Marks the pattern a false positive. Member reports are untouched — each is still a real case. */
  staffDismissPattern: (id: string) =>
    request<void>(`/api/v1/staff/patterns/${id}/dismiss`, { method: 'POST' }),
  /** Re-runs the AI synthesis against the pattern's current membership — manual, never automatic. */
  staffRefreshPattern: (id: string) =>
    request<SystemicPattern>(`/api/v1/staff/patterns/${id}/refresh`, { method: 'POST' }),

  /* ── Staff — fraud review ─────────────────────────────────────────────── */
  staffFraudFlags: () => request<FraudFlag[]>('/api/v1/staff/fraud'),
  staffAcknowledgeFraudFlag: (id: string) =>
    request<void>(`/api/v1/staff/fraud/${id}/acknowledge`, { method: 'POST' }),
  staffDismissFraudFlag: (id: string) =>
    request<void>(`/api/v1/staff/fraud/${id}/dismiss`, { method: 'POST' }),
  /** A clerk's own fraud call on a specific report — the one kind with no automated check behind it. */
  staffRaiseFraudFlag: (reportId: string, reason: string) =>
    request<FraudFlag>(`/api/v1/staff/reports/${reportId}/fraud-flags`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),

  /**
   * Uploads a photo taken or picked on the device.
   *
   * Uses `expo-file-system`'s uploadAsync rather than `fetch` + `FormData`. RN's FormData needs a
   * `{uri, name, type}` object cast to a Blob, and that path silently failed on a real Android
   * handset (the server accepted the identical multipart body from curl, so the endpoint was fine).
   * `uploadAsync` streams the file natively and is the supported way to do this on Expo.
   *
   * `fetch` + `FormData` is kept as a fallback, because iOS and Android have historically disagreed
   * about which of the two works — and a failed photo must never cost the citizen their report.
   */
  async uploadPhoto(uri: string): Promise<{ url: string }> {
    const session = await loadSession();
    const authHeaders: Record<string, string> = session
      ? { Authorization: `Bearer ${session.token}` }
      : {};
    const endpoint = `${API_URL}/api/v1/uploads/photo`;

    try {
      // SDK 54+ API: a File instance uploads itself. The old FileSystem.uploadAsync() helper is
      // legacy-only now, so this is the supported path.
      const result = await new FileSystem.File(uri).upload(endpoint, {
        httpMethod: 'POST',
        uploadType: FileSystem.UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: mimeTypeFor(uri),
        headers: authHeaders,
      });

      if (result.status >= 200 && result.status < 300) {
        return JSON.parse(result.body) as { url: string };
      }
      throw new ApiError(result.status, t('api.photoUploadFailed', { status: result.status }));
    } catch (primaryError) {
      const form = new FormData();
      form.append('file', {
        uri,
        name: uri.split('/').pop() || 'photo.jpg',
        type: mimeTypeFor(uri),
      } as unknown as Blob);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: authHeaders,
        body: form,
      });

      if (!response.ok) {
        // Surface the original failure — the fallback's error is usually the less informative one.
        throw primaryError instanceof ApiError
          ? primaryError
          : new ApiError(response.status, t('api.photoUploadFailed', { status: response.status }));
      }
      return (await response.json()) as { url: string };
    }
  },

  /**
   * Downloads the staff case dossier (.docx) and returns the local file URI. The endpoint is bearer
   * authenticated, so this cannot be a plain link — the token has to travel as a header, which is what
   * `createDownloadTask` supports. Handing the file to another app is the caller's job.
   */
  async downloadDossier(reportId: string, publicRef: string): Promise<string> {
    const session = await loadSession();
    if (!session) throw new ApiError(401, 'Sesioni ka skaduar.');

    // A fresh folder per download keeps the filename stable ("Dosje-ELB-2026-0042.docx" is what the
    // clerk sees when sharing) without a second download colliding with the first.
    const folder = new FileSystem.Directory(FileSystem.Paths.cache, `dossier-${Date.now()}`);
    folder.create({ intermediates: true, idempotent: true });

    const task = FileSystem.File.createDownloadTask(
      `${API_URL}/api/v1/staff/reports/${reportId}/dossier`,
      folder,
      { headers: { Authorization: `Bearer ${session.token}` } },
    );

    const file = await task.downloadAsync();
    if (!file?.uri) throw new ApiError(500, 'Dosja nuk u shkarkua.');

    // The server names the file via Content-Disposition, but the download task does not always honour
    // it — rename locally so the shared file carries the report's reference either way.
    const target = `Dosje-${publicRef}.docx`;
    if (!file.uri.endsWith(target)) {
      try {
        file.move(new FileSystem.File(folder, target));
      } catch {
        return file.uri;   // a rename failure is not worth losing the download over
      }
      return new FileSystem.File(folder, target).uri;
    }

    return file.uri;
  },
};

function mimeTypeFor(uri: string): string {
  const extension = /\.(\w+)(?:\?.*)?$/.exec(uri)?.[1]?.toLowerCase();
  switch (extension) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    default: return 'image/jpeg';
  }
}
