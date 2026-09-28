using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;

namespace E_RaportoBackend.Services;

/// <summary>Entity → DTO projections. Kept in one place so the mobile app and dashboard never drift.</summary>
public static class Mapping
{
    /// <summary>
    /// How far from the original pin an "after" photo can be taken and still be about the same place.
    ///
    /// 60 m is chosen against the failure that matters: a citizen standing on the opposite pavement, or
    /// having pinned the pothole from a few doors down when they first reported it, must not be told
    /// their evidence is from somewhere else. A wrong-street photo is far past this; ordinary GPS drift
    /// in a built-up street is well inside it. Being outside the radius is never a rejection anyway —
    /// it is shown to staff as context, and the verification still counts.
    /// </summary>
    public const double VerificationRadiusMeters = 60;


    public static CategoryDto ToDto(this Category c) => new(
        c.Id, c.Code, c.NameSq, c.NameEn, c.Description, c.ColorHex, c.Icon,
        c.DefaultDepartmentId, c.DefaultDepartment?.Name);

    public static CategoryRefDto ToRef(this Category c) => new(c.Id, c.Code, c.NameSq, c.NameEn, c.ColorHex, c.Icon);

    public static DepartmentDto ToDto(this Department d) => new(
        d.Id, d.Name, d.ShortName, d.Email, d.Phone, d.SlaHours);

    public static DepartmentRefDto ToRef(this Department d) => new(d.Id, d.ShortName, d.Name, d.SlaHours);

    public static MunicipalityDto ToDto(this Municipality m) => new(
        m.Id, m.Name, m.Slug, m.CenterLat, m.CenterLng, m.DefaultMapRadiusM);

    public static StaffUserDto ToDto(this StaffUser u) => new(
        u.Id, u.FullName, u.Email, u.JobTitle, u.Role.ToString(), u.DepartmentId, u.Department?.ShortName);

    public static CitizenUserDto ToDto(this CitizenUser u) => new(
        u.Id, u.FullName, u.Email, u.Phone, u.CreatedAt, u.PreferredLocale);

    public static NotificationDto ToDto(this CitizenNotification n) => new(
        n.Id, n.ReportId, n.Report?.PublicRef ?? string.Empty, n.Type.ToString(),
        n.Title, n.Body, n.TitleEn, n.BodyEn, n.IsRead, n.CreatedAt);

    public static StatusHistoryDto ToDto(this ReportStatusHistory h) => new(
        h.Id, h.FromStatus?.ToString(), h.ToStatus.ToString(), h.Note, h.NoteEn, h.ChangedByLabel, h.CreatedAt);

    /// <summary>
    /// The citizen-safe sentence for <see cref="ReportDto.PatternNote"/> — never the AI's raw verdict.
    /// Deliberately generic regardless of <see cref="ConnectionType"/>: telling a citizen "this may be a
    /// symptom of one shared failure" versus "this points at a structural condition" is a distinction
    /// staff need to act on differently, not one a citizen needs explained to them.
    /// </summary>
    public static string? ToPatternNote(this SystemicPattern? pattern) =>
        pattern is null || pattern.ReviewStatus == PatternReviewStatus.Dismissed
            ? null
            : "Probleme të ngjashme janë vërejtur edhe në pika të tjera afër — bashkia po e ndjek si pjesë e një modeli më të gjerë.";

    /// <summary>English counterpart of <see cref="ToPatternNote"/> — a fixed sentence, not AI-generated,
    /// so it is just written in both languages rather than translated per-call.</summary>
    public static string? ToPatternNoteEn(this SystemicPattern? pattern) =>
        pattern is null || pattern.ReviewStatus == PatternReviewStatus.Dismissed
            ? null
            : "Similar problems have also been noticed nearby — the municipality is tracking it as part of a wider pattern.";

    public static SystemicPatternMemberDto ToMemberDto(this Report r) => new(
        r.Id, r.PublicRef, r.Title, r.TitleEn, r.Status.ToString(), r.AddressText, r.CreatedAt);

    public static SystemicPatternDto ToDto(this SystemicPattern p) => new(
        p.Id,
        p.Category!.ToRef(),
        p.Department?.ToRef(),
        p.CentroidLat, p.CentroidLng,
        p.MemberCount,
        p.AiSummarySq,
        p.AiConnectionType?.ToString(),
        p.AiConfidence,
        p.ReviewStatus.ToString(),
        p.DetectedAt, p.LastReportAt,
        p.Members.Select(r => r.ToMemberDto()).ToList());

    public static ResolutionVerificationDto ToDto(this ResolutionVerification v) => new(
        v.Id,
        v.Outcome.ToString(),
        v.Comment,
        v.PhotoUrl,
        v.DistanceMeters,
        v.DistanceMeters is { } d && d <= VerificationRadiusMeters,
        v.CreatedAt);

    /// <summary>
    /// Whether <paramref name="verification"/> answers the report's <em>current</em> resolution.
    ///
    /// The comparison is against a stored copy of <c>ResolvedAt</c>, not merely "a verification exists",
    /// so a case that was disputed, reopened, worked again and re-resolved is asked about a second time.
    /// Without this the first "no" would silently satisfy every future closure of the same report.
    /// </summary>
    public static bool AnswersCurrentResolution(this ResolutionVerification? verification, Report report) =>
        verification is not null
        && report.ResolvedAt is not null
        && verification.ResolvedAt == report.ResolvedAt;

    /// <summary>
    /// SLA deadline derived from the routed department's target. Null when nothing is routed yet —
    /// we don't invent a deadline for a report the AI wasn't confident enough to route.
    /// </summary>
    public static DateTime? SlaDueAt(this Report r) =>
        r.Department is null ? null : r.CreatedAt.AddHours(r.Department.SlaHours);

    public static bool IsSlaBreached(this Report r)
    {
        var due = r.SlaDueAt();
        if (due is null) return false;
        if (r.Status is ReportStatus.Merged or ReportStatus.Rejected) return false;
        // A resolved report is judged against when it was actually resolved, not against "now".
        return (r.ResolvedAt ?? DateTime.UtcNow) > due;
    }

    public static AiBlockDto ToAiBlock(
        this Report r, string? suggestedCategoryCode, string? suggestedCategoryNameSq, string? suggestedCategoryNameEn) => new(
        suggestedCategoryCode,
        suggestedCategoryNameSq,
        suggestedCategoryNameEn,
        r.AiSuggestedPriority?.ToString(),
        r.AiConfidence,
        r.AiReasoning,
        r.AiReasoningEn,
        r.AiSummarySq,
        r.ClassificationSource.ToString(),
        r.AiModel,
        r.IsCategoryOverridden,
        r.OverrideReason,
        r.AiConfidence is { } c && c < 0.65);

    /// <param name="suggestedCategory">
    /// The AI's original suggestion, which may differ from <c>report.Category</c> after a staff override.
    /// Passed in rather than lazily loaded so callers control their query shape.
    /// </param>
    /// <param name="viewerId">
    /// The requesting citizen, when there is one. Used only to compute <c>IsMine</c>; pass null for
    /// staff callers, for whom the notion of "my report" doesn't apply.
    /// </param>
    /// <param name="hasConfirmed">
    /// Whether <paramref name="viewerId"/> already confirmed this report. Computed by the caller,
    /// which knows whether it can afford the extra query for the view it is rendering.
    /// </param>
    /// <param name="verification">
    /// The reporter's latest verdict on a resolution of this report, or null if they have never given
    /// one. Loaded by the caller for the same reason <paramref name="hasConfirmed"/> is.
    /// </param>
    public static ReportDto ToDto(
        this Report r, Category? suggestedCategory = null,
        Guid? viewerId = null, bool? hasConfirmed = null,
        ResolutionVerification? verification = null,
        SystemicPattern? pattern = null) => new(
        r.Id,
        r.PublicRef,
        r.Title,
        r.TitleEn,
        r.Description,
        r.DescriptionSq,
        r.DescriptionEn,
        r.Status.ToString(),
        r.Priority.ToString(),
        r.Category?.ToRef(),
        r.Department?.ToRef(),
        r.AssignedToStaff is null ? null : new StaffRefDto(r.AssignedToStaff.Id, r.AssignedToStaff.FullName),
        r.Latitude,
        r.Longitude,
        r.AddressText,
        r.Photos.Select(p => new PhotoDto(p.Url)).ToList(),
        r.ReporterLabel,
        viewerId is { } id && r.ReporterUserId == id,
        hasConfirmed,
        r.ConfirmationCount,
        r.MergedIntoReportId,
        r.MergedIntoReport?.PublicRef,
        r.ToAiBlock(suggestedCategory?.Code, suggestedCategory?.NameSq, suggestedCategory?.NameEn),
        r.CreatedAt,
        r.UpdatedAt,
        r.AcknowledgedAt,
        r.ResolvedAt,
        r.SlaDueAt(),
        r.IsSlaBreached(),
        verification?.ToDto(),
        // Only ever true for the reporter looking at their own report: nobody else is asked, so nobody
        // else's client should be told there is a question outstanding.
        viewerId is { } viewer
            && r.ReporterUserId == viewer
            && r.Status == ReportStatus.Resolved
            && r.ResolvedAt is not null
            && !verification.AnswersCurrentResolution(r),
        pattern.ToPatternNote(),
        pattern.ToPatternNoteEn());

    public static ReportListItemDto ToListItem(
        this Report r, int pendingDuplicateCount = 0, string? verificationOutcome = null) => new(
        r.Id,
        r.PublicRef,
        r.Title,
        r.TitleEn,
        r.AiSummarySq,
        r.Status.ToString(),
        r.Priority.ToString(),
        r.Category?.ToRef(),
        r.Department?.ToRef(),
        r.AssignedToStaff is null ? null : new StaffRefDto(r.AssignedToStaff.Id, r.AssignedToStaff.FullName),
        r.Latitude,
        r.Longitude,
        r.AddressText,
        r.Photos.FirstOrDefault()?.Url,
        r.ReporterLabel,
        r.ConfirmationCount,
        pendingDuplicateCount,
        r.AiConfidence,
        r.ClassificationSource.ToString(),
        r.IsCategoryOverridden,
        r.CreatedAt,
        r.SlaDueAt(),
        r.IsSlaBreached(),
        verificationOutcome);

    public static ReportPinDto ToPin(this Report r, bool verifiedConfirmed = false) => new(
        r.Id, r.PublicRef, r.Latitude, r.Longitude, r.Status.ToString(),
        r.Category?.Code, r.Category?.ColorHex ?? "#666666", r.ConfirmationCount, r.CreatedAt,
        verifiedConfirmed);

    /// <summary><paramref name="report"/> and <paramref name="relatedReport"/> must already be the
    /// resolved entities — this never queries, same reason every other mapper here doesn't.</summary>
    public static FraudFlagDto ToDto(this FraudFlag f, Report report, Report? relatedReport) => new(
        f.Id, f.Kind.ToString(), f.ReviewStatus.ToString(), f.Reasoning, f.Score,
        report.ToListItem(), relatedReport?.ToListItem(),
        f.RaisedByStaff?.FullName, f.ReviewedByStaff?.FullName, f.CreatedAt);

    public static DuplicateCandidateDto ToDto(this DuplicateCandidate c, Report candidateReport) => new(
        c.Id,
        candidateReport.Id,
        candidateReport.PublicRef,
        candidateReport.Title,
        candidateReport.TitleEn,
        candidateReport.Status.ToString(),
        candidateReport.Category?.NameSq,
        candidateReport.Category?.NameEn,
        candidateReport.Category?.ColorHex,
        c.DistanceMeters,
        c.TextSimilarity,
        c.Score,
        c.Method,
        candidateReport.Photos.FirstOrDefault()?.Url,
        candidateReport.Latitude,
        candidateReport.Longitude,
        candidateReport.ConfirmationCount,
        candidateReport.CreatedAt);
}
