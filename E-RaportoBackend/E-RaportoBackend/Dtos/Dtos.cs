using System.ComponentModel.DataAnnotations;
using E_RaportoBackend.Domain;

namespace E_RaportoBackend.Dtos;

// ─────────────────────────── Reference data ───────────────────────────

public record CategoryDto(
    Guid Id, string Code, string NameSq, string NameEn, string Description,
    string ColorHex, string Icon, Guid? DefaultDepartmentId, string? DefaultDepartmentName);

public record DepartmentDto(Guid Id, string Name, string ShortName, string? Email, string? Phone, int SlaHours);

public record MunicipalityDto(
    Guid Id, string Name, string Slug, double CenterLat, double CenterLng, int DefaultMapRadiusM);

// ─────────────────────────── Auth ───────────────────────────

public class LoginRequest
{
    [Required, EmailAddress] public string Email { get; set; } = string.Empty;
    [Required, MinLength(4)] public string Password { get; set; } = string.Empty;
}

public class RegisterCitizenRequest
{
    [Required, MaxLength(160)] public string FullName { get; set; } = string.Empty;
    [Required, EmailAddress, MaxLength(160)] public string Email { get; set; } = string.Empty;
    [Required, MinLength(6), MaxLength(200)] public string Password { get; set; } = string.Empty;
    [MaxLength(40)] public string? Phone { get; set; }
}

public class UpdateCitizenProfileRequest
{
    [MaxLength(160)] public string? FullName { get; set; }
    [MaxLength(40)] public string? Phone { get; set; }
    /// <summary>"sq" or "en". Optional — the profile form saves name/phone without touching this; the
    /// language toggle on the same screen sends it on its own, so an unrelated profile edit can never
    /// accidentally revert a citizen's language choice.</summary>
    [RegularExpression("^(sq|en)$")] public string? PreferredLocale { get; set; }
}

public class ChangePasswordRequest
{
    [Required] public string CurrentPassword { get; set; } = string.Empty;
    [Required, MinLength(6), MaxLength(200)] public string NewPassword { get; set; } = string.Empty;
}

public record StaffUserDto(
    Guid Id, string FullName, string Email, string? JobTitle,
    string Role, Guid? DepartmentId, string? DepartmentName);

public record CitizenUserDto(
    Guid Id, string FullName, string Email, string? Phone, DateTime CreatedAt, string PreferredLocale);

public record LoginResponse(string Token, DateTime ExpiresAt, StaffUserDto User);
public record CitizenLoginResponse(string Token, DateTime ExpiresAt, CitizenUserDto User);

// ─────────────────────────── Reports ───────────────────────────

public record CategoryRefDto(Guid Id, string Code, string NameSq, string NameEn, string ColorHex, string Icon);
public record DepartmentRefDto(Guid Id, string ShortName, string Name, int SlaHours);
public record StaffRefDto(Guid Id, string FullName);
public record PhotoDto(string Url);

/// <summary>
/// What the classifier produced, kept separate from the effective values on the report so the UI can
/// show "the AI said X (72%), a clerk changed it to Y" — the honesty surface the jury is grading.
/// </summary>
public record AiBlockDto(
    string? SuggestedCategoryCode, string? SuggestedCategoryNameSq, string? SuggestedCategoryNameEn,
    string? SuggestedPriority, double? Confidence, string? Reasoning, string? ReasoningEn, string? SummarySq,
    string Source, string? Model, bool IsOverridden, string? OverrideReason, bool IsLowConfidence);

/// <param name="ReporterLabel">
/// The reporter's pseudonymous handle. Never their name — no caller of this API, at any privilege
/// level, is served the name of the person who filed a report. See <c>CitizenUser.Pseudonym</c>.
/// </param>
/// <param name="HasConfirmed">
/// Whether the *requesting* citizen has already confirmed this report. Drives the one-press-only
/// button state in the app; null when the caller is staff (the question doesn't apply to them).
/// </param>
/// <param name="Verification">
/// The reporter's most recent verdict on a resolution, if they have ever given one. Survives a reopen
/// deliberately — "the citizen said it wasn't fixed" is the reason the case is open again, and hiding
/// it the moment staff acted on it would erase the only record of why.
/// </param>
/// <param name="AwaitingMyVerification">
/// True only for the reporter, only while this report's *current* resolution is unanswered. Every
/// client's "ask them now" trigger reads this one flag, so the rule for who gets asked lives on the
/// server and cannot drift between the phone and the dashboard.
/// </param>
/// <param name="PatternNote">
/// A soft, citizen-safe sentence when this report has been grouped into a systemic pattern — deliberately
/// not the AI's internal verdict (no <c>ConnectionType</c>, no confidence number, no sibling report
/// references), just enough to tell the citizen the municipality is looking at this as part of something
/// bigger. Null whenever there is no pattern, or the pattern was dismissed as a false positive. The full
/// pattern — for staff — travels separately as <see cref="ReportDetailDto.Pattern"/>.
/// </param>
public record ReportDto(
    Guid Id, string PublicRef, string Title, string? TitleEn, string Description,
    string? DescriptionSq, string? DescriptionEn,
    string Status, string Priority,
    CategoryRefDto? Category, DepartmentRefDto? Department, StaffRefDto? AssignedTo,
    double Latitude, double Longitude, string? AddressText,
    IReadOnlyList<PhotoDto> Photos,
    string ReporterLabel, bool IsMine, bool? HasConfirmed,
    int ConfirmationCount, Guid? MergedIntoReportId, string? MergedIntoPublicRef,
    AiBlockDto Ai,
    DateTime CreatedAt, DateTime UpdatedAt, DateTime? AcknowledgedAt, DateTime? ResolvedAt,
    DateTime? SlaDueAt, bool IsSlaBreached,
    ResolutionVerificationDto? Verification = null, bool AwaitingMyVerification = false,
    string? PatternNote = null, string? PatternNoteEn = null);

/// <param name="IsNearOriginalPin">
/// Whether the "after" photo was taken close enough to the report's pin to be about the same place.
/// Computed from the stored distance against the current threshold, so tightening or loosening that
/// rule re-reads every past verification correctly instead of freezing each one's verdict forever.
/// </param>
public record ResolutionVerificationDto(
    Guid Id, string Outcome, string? Comment, string? PhotoUrl,
    double? DistanceMeters, bool IsNearOriginalPin, DateTime CreatedAt);

/// <summary>Compact row for list views. No history, no reporter contact details.</summary>
public record ReportListItemDto(
    Guid Id, string PublicRef, string Title, string? TitleEn, string? SummarySq,
    string Status, string Priority,
    CategoryRefDto? Category, DepartmentRefDto? Department, StaffRefDto? AssignedTo,
    double Latitude, double Longitude, string? AddressText, string? ThumbnailUrl,
    string ReporterLabel,
    int ConfirmationCount, int PendingDuplicateCount,
    double? AiConfidence, string ClassificationSource, bool IsCategoryOverridden,
    DateTime CreatedAt, DateTime? SlaDueAt, bool IsSlaBreached,
    string? VerificationOutcome = null);

/// <summary>Lightweight map pin. Deliberately excludes description and photos to keep the map fast.</summary>
/// <param name="VerifiedConfirmed">True only when the report is Resolved AND the reporter's verdict
/// on this exact resolution was Confirmed — mirrors the "I konfirmuar" override the status badge
/// shows elsewhere, so the map's own pin-tap preview says the same thing as every other screen.</param>
public record ReportPinDto(
    Guid Id, string PublicRef, double Lat, double Lng, string Status,
    string? CategoryCode, string ColorHex, int ConfirmationCount, DateTime CreatedAt,
    bool VerifiedConfirmed);

public record StatusHistoryDto(
    Guid Id, string? FromStatus, string ToStatus, string? Note, string? NoteEn, string ChangedByLabel, DateTime CreatedAt);

public record DuplicateCandidateDto(
    Guid CandidateId, Guid ReportId, string PublicRef, string Title, string? TitleEn, string Status,
    string? CategoryNameSq, string? CategoryNameEn, string? ColorHex,
    double DistanceMeters, double TextSimilarity, double Score, string Method,
    string? ThumbnailUrl, double Latitude, double Longitude, int ConfirmationCount, DateTime CreatedAt);

/// <summary>
/// Detail view: everything in <see cref="ReportDto"/> plus the working context.
/// </summary>
/// <remarks>
/// This record used to carry <c>ReporterEmail</c> and <c>ReporterPhone</c>, populated for staff callers.
/// They are gone — removed from the shape rather than left nullable and set to null, so that no future
/// endpoint can quietly start filling them in again. There is no longer any field on any DTO in this
/// API through which the identity of a reporter can travel.
///
/// The cost is real and worth naming: a clerk who genuinely needs to ask "which side of the street?"
/// no longer has a way to. That is the trade this system makes deliberately — a channel to the reporter
/// is also a channel to the reporter, and in a city this size the second use is the likelier one.
/// </remarks>
public record ReportDetailDto(
    ReportDto Report,
    IReadOnlyList<StatusHistoryDto> StatusHistory,
    IReadOnlyList<DuplicateCandidateDto> DuplicateCandidates,
    IReadOnlyList<string> AllowedNextStatuses,
    SystemicPatternDto? Pattern = null);

// ─────────────────────────── Systemic patterns ───────────────────────────

/// <summary>A pattern's sibling report, compact — the staff pattern review screen links out to each
/// member's own full detail rather than duplicating it here.</summary>
public record SystemicPatternMemberDto(
    Guid Id, string PublicRef, string Title, string? TitleEn, string Status, string? AddressText, DateTime CreatedAt);

/// <param name="ConnectionType">
/// <c>SharedCause</c> | <c>SystemicCondition</c> | <c>Uncertain</c> — null only when the AI synthesis
/// never ran (key not configured, or the call failed). The pattern is still real and shown either way;
/// see <c>SystemicPattern.AiConnectionType</c>.
/// </param>
public record SystemicPatternDto(
    Guid Id,
    CategoryRefDto Category,
    DepartmentRefDto? Department,
    double CentroidLat, double CentroidLng,
    int MemberCount,
    string? SummarySq,
    string? ConnectionType,
    double? Confidence,
    string ReviewStatus,
    DateTime DetectedAt, DateTime LastReportAt,
    IReadOnlyList<SystemicPatternMemberDto> Members);

// ─────────────────────────── Citizen submission ───────────────────────────

public class CreateReportRequest
{
    [Required, MinLength(10), MaxLength(4000)]
    public string Description { get; set; } = string.Empty;

    [Range(-90, 90)] public double Latitude { get; set; }
    [Range(-180, 180)] public double Longitude { get; set; }

    [MaxLength(300)] public string? AddressText { get; set; }
    public List<string> PhotoUrls { get; set; } = [];

    // Reporter identity is no longer accepted from the client — it is taken from the authenticated
    // account, so a caller cannot file a report under someone else's name.

    /// <summary>The citizen's own guess. Advisory only — the classifier may disagree, and says so.</summary>
    [MaxLength(40)] public string? CategoryCodeHint { get; set; }
}

/// <summary>
/// The report is always created. Duplicate candidates are shown to the citizen as an offer, never as
/// a block — we do not lose a report because a heuristic guessed wrong.
/// </summary>
public record CreateReportResponse(
    ReportDto Report,
    ClassificationResultDto Classification,
    IReadOnlyList<DuplicateCandidateDto> DuplicateCandidates);

public record ClassificationResultDto(
    string CategoryCode, string CategoryNameSq, string CategoryNameEn, double Confidence, string Priority,
    string Reasoning, string? ReasoningEn, string? SummarySq, string Source, string? Model, bool IsLowConfidence);

public class ConfirmDuplicateRequest
{
    [Required] public Guid CandidateReportId { get; set; }
}

/// <summary>
/// The reporter's answer to "is it actually fixed?". Everything but the verdict is optional: a citizen
/// standing in front of an unfixed pothole with no signal for the camera upload must still be able to
/// say no. Requiring proof to disagree would make the metric flattering and useless.
/// </summary>
public class VerifyResolutionRequest
{
    [Required] public VerificationOutcome Outcome { get; set; }
    [MaxLength(1000)] public string? Comment { get; set; }
    [MaxLength(500)] public string? PhotoUrl { get; set; }
    [Range(-90, 90)] public double? Latitude { get; set; }
    [Range(-180, 180)] public double? Longitude { get; set; }
}

/// <summary>
/// A resolution this citizen has been asked about and has not answered. Carries just enough to render
/// the ask — the reference, what they reported, and the original photo to compare against.
/// </summary>
public record PendingVerificationDto(
    Guid ReportId, string PublicRef, string Title, string? TitleEn,
    string? CategoryNameSq, string? CategoryNameEn, string? CategoryColorHex,
    string? PhotoUrl, double Latitude, double Longitude, string? AddressText,
    string? DepartmentShortName, string? ResolutionNote,
    DateTime CreatedAt, DateTime ResolvedAt);

public record PhotoUploadResponse(string Url, string StoragePath, long SizeBytes);

// ─────────────────────────── Staff actions ───────────────────────────

public class ChangeStatusRequest
{
    [Required] public ReportStatus Status { get; set; }
    [MaxLength(1000)] public string? Note { get; set; }
}

public class AssignRequest
{
    public Guid? DepartmentId { get; set; }
    public Guid? StaffUserId { get; set; }
    [MaxLength(1000)] public string? Note { get; set; }
}

public class OverrideCategoryRequest
{
    [Required] public Guid CategoryId { get; set; }
    public ReportPriority? Priority { get; set; }
    [MaxLength(500)] public string? Reason { get; set; }
}

// ─────────────────────────── Notifications ───────────────────────────

public record NotificationDto(
    Guid Id, Guid ReportId, string ReportPublicRef, string Type,
    string Title, string Body, string TitleEn, string BodyEn, bool IsRead, DateTime CreatedAt);

public class RegisterPushTokenRequest
{
    [Required, MaxLength(200)] public string Token { get; set; } = string.Empty;
}

// ─────────────────────────── Analytics ───────────────────────────

public record CategoryStatDto(string Code, string NameSq, string NameEn, string ColorHex, int Count, double? AvgHoursToResolution);
public record StatusStatDto(string Status, int Count);
public record DepartmentStatDto(Guid Id, string ShortName, int Open, int Resolved, int SlaBreaches, double? AvgHoursToResolution);
public record TrendPointDto(DateOnly Date, int Submitted, int Resolved);

/// <remarks>
/// <c>AiAgreementRate</c> is the share of AI classifications a clerk did NOT override — our honest
/// accuracy proxy, and the number we quote in the pitch instead of claiming an unmeasured accuracy.
///
/// <c>CitizenVerifiedRate</c> is the second number of that kind, and the more uncomfortable one: of
/// the cases the municipality currently calls resolved, the share the person who reported them has
/// confirmed is genuinely fixed. It is measured against <c>ResolvedReports</c>, not against the people
/// who bothered to reply, so silence counts as unverified. That is the point — a rate that only
/// counted answers would climb by asking fewer people.
/// </remarks>
public record AnalyticsSummaryDto(
    int TotalReports, int OpenReports, int ResolvedReports,
    double? AvgHoursToAcknowledge, double? AvgHoursToResolution,
    int SlaBreachCount, int DuplicatesMerged, int PendingDuplicateReviews,
    double? AiAgreementRate, int AiClassifiedCount, int AiOverriddenCount,
    IReadOnlyList<CategoryStatDto> ByCategory,
    IReadOnlyList<StatusStatDto> ByStatus,
    IReadOnlyList<DepartmentStatDto> ByDepartment,
    int VerificationsConfirmed = 0, int VerificationsDisputed = 0,
    int VerificationsAwaiting = 0, double? CitizenVerifiedRate = null,
    int OpenSystemicPatterns = 0, int PendingPhotoReuseReviews = 0);

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total)
{
    public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling(Total / (double)PageSize);
}
