/** Mirrors the C# DTOs in E-RaportoBackend/Dtos. Kept hand-written and small — the API contract is
 *  rendered live at /swagger. */

export type ReportStatus =
  | 'Submitted' | 'InReview' | 'Assigned' | 'InProgress' | 'Resolved' | 'Rejected' | 'Merged';

export type ReportPriority = 'Low' | 'Normal' | 'High' | 'Urgent';

/** Which engine produced the effective categorisation — surfaced in the UI, never hidden. */
export type ClassificationSource = 'RuleBased' | 'Llm' | 'Manual';

export interface CategoryDto {
  id: string;
  code: string;
  nameSq: string;
  nameEn: string;
  description: string;
  colorHex: string;
  icon: string;
  defaultDepartmentId?: string;
  defaultDepartmentName?: string;
}

export interface DepartmentDto {
  id: string;
  name: string;
  shortName: string;
  email?: string;
  phone?: string;
  slaHours: number;
}

export interface MunicipalityDto {
  id: string;
  name: string;
  slug: string;
  centerLat: number;
  centerLng: number;
  defaultMapRadiusM: number;
}

export interface StaffUserDto {
  id: string;
  fullName: string;
  email: string;
  jobTitle?: string;
  role: 'Admin' | 'Supervisor' | 'FieldAgent';
  departmentId?: string;
  departmentName?: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: StaffUserDto;
}

export interface CategoryRef { id: string; code: string; nameSq: string; colorHex: string; icon: string }
export interface DepartmentRef { id: string; shortName: string; name: string; slaHours: number }
export interface StaffRef { id: string; fullName: string }

/** What the classifier said, kept separate from the effective values so an override stays visible. */
export interface AiBlock {
  suggestedCategoryCode?: string;
  suggestedCategoryNameSq?: string;
  suggestedPriority?: ReportPriority;
  confidence?: number;
  reasoning?: string;
  reasoningEn?: string;
  summarySq?: string;
  source: ClassificationSource;
  model?: string;
  isOverridden: boolean;
  overrideReason?: string;
  isLowConfidence: boolean;
}

export type VerificationOutcome = 'Confirmed' | 'Disputed';

/**
 * The reporter's answer to "is it actually fixed?" — the only record in this system written about the
 * municipality's work by someone outside it.
 */
export interface ResolutionVerificationDto {
  id: string;
  outcome: VerificationOutcome;
  comment?: string | null;
  photoUrl?: string | null;
  /** Metres between the "after" photo and the report's original pin; null when the device gave no fix. */
  distanceMeters?: number | null;
  isNearOriginalPin: boolean;
  createdAt: string;
}

export interface ReportDto {
  id: string;
  publicRef: string;
  title: string;
  /** English counterpart of `title`, from the same classification call. Null on the rule-based
   *  fallback path — no model, no translation. The dashboard has no locale toggle, so this is carried
   *  for contract accuracy rather than displayed anywhere today. */
  titleEn?: string | null;
  description: string;
  /** Bilingual pair for `description` — same null-on-fallback rule as `titleEn`. */
  descriptionSq?: string | null;
  descriptionEn?: string | null;
  status: ReportStatus;
  priority: ReportPriority;
  category?: CategoryRef;
  department?: DepartmentRef;
  assignedTo?: StaffRef;
  latitude: number;
  longitude: number;
  addressText?: string;
  photos: { url: string }[];
  /** Who filed it. Always present now that reports require a citizen account. */
  /** Pseudonymous handle, never a name. */
  reporterLabel: string;
  /** Only meaningful for citizen callers; always false/null on the staff dashboard. */
  isMine: boolean;
  hasConfirmed?: boolean | null;
  confirmationCount: number;
  mergedIntoReportId?: string;
  mergedIntoPublicRef?: string;
  ai: AiBlock;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  slaDueAt?: string;
  isSlaBreached: boolean;
  /** Latest verdict, kept after a reopen — it is usually the reason the case was reopened. */
  verification?: ResolutionVerificationDto | null;
  /** Citizen-facing only; always false for a staff caller. */
  awaitingMyVerification: boolean;
  /** A soft, citizen-safe sentence when this report has been grouped into a systemic pattern — never
   *  the AI's connection-type verdict or sibling references. The full pattern travels separately as
   *  ReportDetailDto.pattern. Null whenever there is no pattern, or it was dismissed. */
  patternNote?: string | null;
  patternNoteEn?: string | null;
}

export interface ReportListItemDto {
  id: string;
  publicRef: string;
  title: string;
  titleEn?: string | null;
  summarySq?: string;
  status: ReportStatus;
  priority: ReportPriority;
  category?: CategoryRef;
  department?: DepartmentRef;
  assignedTo?: StaffRef;
  latitude: number;
  longitude: number;
  addressText?: string;
  thumbnailUrl?: string;
  /** Pseudonymous handle, never a name. */
  reporterLabel: string;
  confirmationCount: number;
  pendingDuplicateCount: number;
  aiConfidence?: number;
  classificationSource: ClassificationSource;
  isCategoryOverridden: boolean;
  createdAt: string;
  slaDueAt?: string;
  isSlaBreached: boolean;
  /** Present only when a verdict stands against this report's current resolution. */
  verificationOutcome?: VerificationOutcome | null;
}

export interface StatusHistoryDto {
  id: string;
  fromStatus?: ReportStatus;
  toStatus: ReportStatus;
  note?: string;
  changedByLabel: string;
  createdAt: string;
}

export interface DuplicateCandidateDto {
  candidateId: string;
  reportId: string;
  publicRef: string;
  title: string;
  titleEn?: string | null;
  status: ReportStatus;
  categoryNameSq?: string;
  colorHex?: string;
  distanceMeters: number;
  textSimilarity: number;
  score: number;
  method: string;
  thumbnailUrl?: string;
  latitude: number;
  longitude: number;
  confirmationCount: number;
  createdAt: string;
}

export interface ReportDetailDto {
  report: ReportDto;
  statusHistory: StatusHistoryDto[];
  duplicateCandidates: DuplicateCandidateDto[];
  /** Contact details are staff-only; the public citizen endpoint returns null for both. */
  allowedNextStatuses: ReportStatus[];
  /** The full systemic pattern this report belongs to, staff-only. Null when it belongs to none. */
  pattern?: SystemicPatternDto | null;
  /** Every fraud flag naming this report, either side of a pairing, dismissed ones included — the full
   *  history, not just what's still pending in the queue. */
  fraudFlags?: FraudFlagDto[] | null;
}

/** SharedCause = one identifiable thing likely produces all the symptoms — a single inspection could
 *  close every member. SystemicCondition = distinct local causes, but the cluster points at a broader
 *  structural condition — no single site visit fixes it, this belongs in planning, not a work order.
 *  Uncertain = the count crossed the threshold but the AI honestly can't tell which of the two this is. */
export type ConnectionType = 'SharedCause' | 'SystemicCondition' | 'Uncertain';
export type PatternReviewStatus = 'Pending' | 'Acknowledged' | 'Dismissed';

export interface SystemicPatternMemberDto {
  id: string;
  publicRef: string;
  title: string;
  titleEn?: string | null;
  status: ReportStatus;
  addressText?: string | null;
  createdAt: string;
}

/**
 * A cluster of DIFFERENT reports the system suspects share a root cause or a wider structural
 * condition — the counterpart to duplicate detection, which links the SAME physical incident. A
 * pattern never merges its members; each stays its own report, inspected and closed on its own.
 */
export interface SystemicPatternDto {
  id: string;
  category: CategoryRef;
  department?: DepartmentRef | null;
  centroidLat: number;
  centroidLng: number;
  memberCount: number;
  /** Null only when the AI synthesis never ran (key not configured, or the call failed) — the pattern
   *  is still real and shown either way, just as a raw member count without a narrative. */
  summarySq?: string | null;
  connectionType?: ConnectionType | null;
  confidence?: number | null;
  reviewStatus: PatternReviewStatus;
  detectedAt: string;
  lastReportAt: string;
  members: SystemicPatternMemberDto[];
}

export interface DuplicateReviewItemDto {
  candidateId: string;
  newReport: ReportListItemDto;
  existingReport: ReportListItemDto;
  distanceMeters: number;
  textSimilarity: number;
  score: number;
  method: string;
  createdAt: string;
}

/**
 * Two reports whose photos matched a deterministic perceptual hash — the same picture, or a lightly
 * edited copy of it, used on two different reports. Never proof of fraud on its own (a citizen can
 * legitimately resubmit their own photo), so nothing merges or changes on either report — this only
 * ever opens a staff review, same "system proposes, human decides" shape as duplicates and patterns.
 */
/** Every reason a report might be worth a fraud review, unified into one shape — see the backend's
 *  FraudFlagKind for what each kind actually checks. RelatedReport is only set for PhotoReuse and
 *  TemplatedText, the two kinds that point at a pairing rather than a single report. */
export type FraudFlagKind =
  | 'PhotoReuse' | 'DescriptionMismatch' | 'SeverityExaggeration' | 'StockPhoto'
  | 'PhotoOfPhoto' | 'GpsMismatch' | 'TemplatedText' | 'StaffFlagged';
export type FraudReviewStatus = 'Pending' | 'Acknowledged' | 'Dismissed';

export interface FraudFlagDto {
  flagId: string;
  kind: FraudFlagKind;
  status: FraudReviewStatus;
  reasoning: string;
  /** Meaning depends on kind: Hamming distance (PhotoReuse), metres (GpsMismatch), 0-1 word-overlap
   *  (TemplatedText), Claude's own calibrated confidence 0-1 (the four vision checks). Null for
   *  StaffFlagged — a clerk's judgement doesn't get a fake number attached. */
  score?: number | null;
  report: ReportListItemDto;
  relatedReport?: ReportListItemDto | null;
  raisedByStaffName?: string | null;
  reviewedByStaffName?: string | null;
  createdAt: string;
}

export interface FraudKindStat { kind: FraudFlagKind; count: number }

export interface CategoryStat {
  code: string; nameSq: string; colorHex: string; count: number; avgHoursToResolution?: number;
}
export interface StatusStat { status: ReportStatus; count: number }
export interface DepartmentStat {
  id: string; shortName: string; open: number; resolved: number;
  slaBreaches: number; avgHoursToResolution?: number;
}
export interface TrendPoint { date: string; submitted: number; resolved: number }

export interface AnalyticsSummaryDto {
  totalReports: number;
  openReports: number;
  resolvedReports: number;
  avgHoursToAcknowledge?: number;
  avgHoursToResolution?: number;
  slaBreachCount: number;
  duplicatesMerged: number;
  pendingDuplicateReviews: number;
  /** Share of AI classifications a clerk did NOT override. An honest proxy, not "accuracy". */
  aiAgreementRate?: number;
  aiClassifiedCount: number;
  aiOverriddenCount: number;
  byCategory: CategoryStat[];
  byStatus: StatusStat[];
  byDepartment: DepartmentStat[];
  /** Resolved cases the reporter has confirmed are genuinely fixed. */
  verificationsConfirmed: number;
  /** Resolved cases the reporter says are not fixed. */
  verificationsDisputed: number;
  /** Resolved cases nobody has answered about. Counted as unverified, deliberately. */
  verificationsAwaiting: number;
  /** verificationsConfirmed ÷ resolvedReports — the gap against "resolved" is the honest bit. */
  citizenVerifiedRate?: number;
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

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReportFilters {
  status?: ReportStatus[];
  categoryCode?: string[];
  departmentId?: string;
  priority?: ReportPriority[];
  assignedToMe?: boolean;
  hasPendingDuplicates?: boolean;
  needsReview?: boolean;
  /** Cases the municipality closed and the reporter says are not fixed. */
  disputed?: boolean;
  search?: string;
  sort?: 'newest' | 'oldest' | 'priority' | 'confirmations';
  page?: number;
  pageSize?: number;
}
