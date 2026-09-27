namespace E_RaportoBackend.Domain;

/// <summary>
/// Tenant root. Every operational row carries a MunicipalityId even though the hackathon demo seeds
/// only Elbasan — onboarding another municipality is a seed script, not a fork.
/// </summary>
public class Municipality
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    /// <summary>Prefix for human-quotable report references, e.g. "ELB" -> ELB-2026-0042.</summary>
    public string RefPrefix { get; set; } = string.Empty;
    public double CenterLat { get; set; }
    public double CenterLng { get; set; }
    public int DefaultMapRadiusM { get; set; } = 6000;
    public string Timezone { get; set; } = "Europe/Tirane";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<Department> Departments { get; set; } = new List<Department>();
    public ICollection<Category> Categories { get; set; } = new List<Category>();
}

/// <summary>The municipal directorate that actually does the work — the routing target.</summary>
public class Department
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MunicipalityId { get; set; }
    public Municipality? Municipality { get; set; }

    public string Name { get; set; } = string.Empty;
    public string ShortName { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    /// <summary>Target resolution time. Drives the SLA-breach analytic on the dashboard.</summary>
    public int SlaHours { get; set; } = 96;
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Who a report lands on the moment it is routed here — by AI classification on submission, or by
    /// a clerk changing the category later. Explicit and admin-configured rather than inferred (e.g.
    /// "this department's only staff member"): a department can have several staff or none yet, and
    /// guessing from headcount would silently break the moment either changes.
    /// </summary>
    public Guid? DefaultAssigneeStaffId { get; set; }
    public StaffUser? DefaultAssignee { get; set; }

    public ICollection<Category> Categories { get; set; } = new List<Category>();
    public ICollection<StaffUser> Staff { get; set; } = new List<StaffUser>();
}

/// <summary>
/// Per-municipality issue taxonomy carrying its own default routing target. Changing where "waste"
/// reports go is editing a row, not deploying code — this is the scalability claim, made concrete.
/// </summary>
public class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MunicipalityId { get; set; }
    public Municipality? Municipality { get; set; }

    /// <summary>Stable machine key shared with the LLM prompt and all three frontends.</summary>
    public string Code { get; set; } = string.Empty;
    public string NameSq { get; set; } = string.Empty;
    public string NameEn { get; set; } = string.Empty;
    /// <summary>Fed verbatim to the classifier as the taxonomy definition — one source of truth.</summary>
    public string Description { get; set; } = string.Empty;

    public Guid? DefaultDepartmentId { get; set; }
    public Department? DefaultDepartment { get; set; }

    public string ColorHex { get; set; } = "#666666";
    public string Icon { get; set; } = "alert";
    public int SortOrder { get; set; }
}

public class StaffUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MunicipalityId { get; set; }
    public Municipality? Municipality { get; set; }

    /// <summary>Null for Admins, who see every department.</summary>
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }

    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? JobTitle { get; set; }
    public StaffRole Role { get; set; } = StaffRole.Supervisor;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }
}

/// <summary>
/// A registered citizen.
///
/// Accounts exist so a report has a real, accountable origin, so a confirmation can be limited to one
/// per person, and so the reporter can be told what happened to their case. They deliberately do NOT
/// exist to put a name on a complaint: the account is known to the system, and known to everyone else
/// only as <see cref="Pseudonym"/>.
/// </summary>
public class CitizenUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MunicipalityId { get; set; }
    public Municipality? Municipality { get; set; }

    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string? Phone { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAt { get; set; }

    /// <summary>
    /// The handle this account is known by everywhere outside itself — six hex characters, e.g. 7F3A2B.
    ///
    /// Reports are attributed to this and never to <see cref="FullName"/>. The reason is the one the
    /// whole system is built around: a citizen reporting their neighbour's illegal building, or
    /// disputing the work of a clerk who is somebody's cousin, must not have their name travel with the
    /// complaint. In a city where everyone knows everyone, attribution is not accountability — it is
    /// exposure, and it is the thing that stops people reporting at all.
    ///
    /// Random, not derived from the account: an id-derived value would be reversible by anyone who
    /// learned the derivation, and a name-derived one (initials, a slug) would leak on sight.
    ///
    /// Stable per account rather than per report, and that trade-off is deliberate. It is what lets
    /// staff tell "one person filed this five times" from "five people filed it once" — and without
    /// that, the confirmation count that drives prioritisation becomes forgeable by a single account.
    /// The residual risk is linkage: somebody who files eight reports inside one street is guessable.
    /// That is why the handle is shown in exactly one place in the whole product — the duplicate-review
    /// comparison, where "same reporter?" is the actual question being asked — and why no screen
    /// anywhere offers "all reports by this handle".
    /// </summary>
    public string Pseudonym { get; set; } = string.Empty;

    /// <summary>
    /// The Expo push token for this citizen's device. One column, not a device table: this app expects
    /// one active phone per account, so the simplicity of "latest registration wins" is worth more than
    /// multi-device support nobody asked for. Null means the client never registered one — no build with
    /// push configured, permission denied, or Expo Go (which cannot receive remote pushes since SDK 53).
    /// </summary>
    public string? PushToken { get; set; }
    public DateTime? PushTokenUpdatedAt { get; set; }

    /// <summary>
    /// "sq" or "en" — the app's own language toggle, mirrored here so server-generated text this
    /// citizen never sees rendered live (an OS push notification, sent once and finalised before the
    /// client is even open) still lands in the language they actually picked. Everything the client
    /// renders itself keeps choosing between server-supplied *Sq/*En pairs at render time; this field
    /// exists only for the one case where the server has to pick for them.
    /// </summary>
    public string PreferredLocale { get; set; } = "sq";
}

/// <summary>The core aggregate: one citizen-reported municipal issue.</summary>
public class Report
{
    public Guid Id { get; set; } = Guid.NewGuid();
    /// <summary>Human-quotable reference, e.g. ELB-2026-0042.</summary>
    public string PublicRef { get; set; } = string.Empty;

    public Guid MunicipalityId { get; set; }
    public Municipality? Municipality { get; set; }

    /// <summary>Always Albanian — the classifier is instructed to produce it that way, matching the
    /// Sq-primary convention used everywhere else (<see cref="Category.NameSq"/>, <see cref="AiSummarySq"/>).</summary>
    public string Title { get; set; } = string.Empty;
    /// <summary>English counterpart of <see cref="Title"/>, produced by the same classification call.
    /// Null on the rule-based fallback path — no model, no translation, same honest gap as
    /// <see cref="CitizenNotification.TitleEn"/> when its translator call fails.</summary>
    public string? TitleEn { get; set; }

    /// <summary>The citizen's own words, exactly as submitted — never rewritten, in whichever language
    /// they actually typed. This is the one field on the report that is not "Albanian by convention";
    /// it is authored by a person, not the system.</summary>
    public string Description { get; set; } = string.Empty;
    /// <summary>Full Albanian version of <see cref="Description"/> — either the original (if the citizen
    /// wrote in Albanian) or a translation of it, from the same classification call. Null on the
    /// rule-based fallback path; a client falls back to showing <see cref="Description"/> as-is.</summary>
    public string? DescriptionSq { get; set; }
    /// <summary>Full English version of <see cref="Description"/>, same rule as <see cref="DescriptionSq"/>.</summary>
    public string? DescriptionEn { get; set; }

    /// <summary>Effective category — the AI's suggestion, or a clerk's override of it.</summary>
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }

    /// <summary>Effective routing target, derived from the category unless a clerk reassigned it.</summary>
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }

    public ReportStatus Status { get; set; } = ReportStatus.Submitted;
    public ReportPriority Priority { get; set; } = ReportPriority.Normal;

    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string? AddressText { get; set; }

    /// <summary>The registered citizen who filed this report. Every report has a real owner.</summary>
    public Guid ReporterUserId { get; set; }
    public CitizenUser? ReporterUser { get; set; }

    /// <summary>
    /// How this report is attributed everywhere it is displayed: the reporter's
    /// <see cref="CitizenUser.Pseudonym"/>, never their name.
    ///
    /// Named <c>ReporterLabel</c> rather than <c>ReporterName</c> on purpose — it used to hold the real
    /// name, and a field called "name" is an open invitation for the next person to put one back into
    /// it. Copied at submission time so no display path has to join to <c>citizen_user</c> at all, which
    /// is also what keeps that join out of the query plans staff-facing endpoints produce.
    /// </summary>
    public string ReporterLabel { get; set; } = string.Empty;

    /// <summary>"Me too" presses plus merged duplicates — the demand signal used for prioritisation.</summary>
    public int ConfirmationCount { get; set; }

    public Guid? AssignedToStaffId { get; set; }
    public StaffUser? AssignedToStaff { get; set; }

    /// <summary>Set when this report was confirmed as a duplicate of another. Nothing is ever deleted.</summary>
    public Guid? MergedIntoReportId { get; set; }
    public Report? MergedIntoReport { get; set; }

    /// <summary>
    /// The systemic pattern this report has been grouped into, if any — a direct FK exactly like
    /// <see cref="MergedIntoReportId"/>, not a join table, because a report belongs to at most one
    /// active pattern at a time. Unlike a merge, this never changes the report's own status or
    /// visibility: it stays a fully independent case that a crew still has to inspect and fix on its
    /// own. The pattern is a lens staff can look through, not a container the report disappears into.
    /// </summary>
    public Guid? SystemicPatternId { get; set; }
    public SystemicPattern? SystemicPattern { get; set; }

    // --- AI block: preserved independently of the effective values above, so "was the AI right?"
    //     stays answerable after a clerk overrides it.
    public Guid? AiSuggestedCategoryId { get; set; }
    public ReportPriority? AiSuggestedPriority { get; set; }
    public double? AiConfidence { get; set; }
    public string? AiReasoning { get; set; }
    /// <summary>English counterpart of <see cref="AiReasoning"/>, from the same classification call.
    /// Null on the rule-based fallback path — same rule as <see cref="TitleEn"/>.</summary>
    public string? AiReasoningEn { get; set; }
    public string? AiSummarySq { get; set; }
    public string? AiModel { get; set; }
    public ClassificationSource ClassificationSource { get; set; } = ClassificationSource.RuleBased;
    public bool IsCategoryOverridden { get; set; }
    public Guid? OverriddenByStaffId { get; set; }
    public string? OverrideReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? AcknowledgedAt { get; set; }
    public DateTime? AssignedAt { get; set; }
    public DateTime? ResolvedAt { get; set; }

    public ICollection<ReportPhoto> Photos { get; set; } = new List<ReportPhoto>();
    public ICollection<ReportStatusHistory> StatusHistory { get; set; } = new List<ReportStatusHistory>();
}

public class ReportPhoto
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    public string Url { get; set; } = string.Empty;
    public string? StoragePath { get; set; }
    public string? ContentType { get; set; }
    public long SizeBytes { get; set; }
    /// <summary>A 64-bit perceptual hash (dHash) of the image's visual content, computed once at
    /// submission time from the already-re-encoded, metadata-stripped file — see
    /// <see cref="Services.PhotoReuseDetectionService"/>. Two photos with a small Hamming distance
    /// between their hashes are the same or a lightly-edited copy of the same picture, regardless of
    /// resize/recompression. Null when hashing failed (a corrupt file the encoder still accepted) —
    /// that report simply isn't compared, never a reason to block it.</summary>
    public long? PerceptualHash { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Append-only. The citizen's status timeline, the time-to-resolution analytics and the notification
/// triggers all derive from this table rather than from mutable columns on Report.
/// </summary>
public class ReportStatusHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    public ReportStatus? FromStatus { get; set; }
    public ReportStatus ToStatus { get; set; }
    /// <summary>Public note — shown to the citizen. This is the transparency promise.</summary>
    public string? Note { get; set; }
    /// <summary>English translation of <see cref="Note"/>, produced by <see cref="Services.Ai.INoteTranslator"/>
    /// at write time. Null when there was no note, translation failed, or the note was empty — every
    /// client already falls back to <see cref="Note"/> when this is null or empty.</summary>
    public string? NoteEn { get; set; }

    public Guid? ChangedByStaffId { get; set; }
    /// <summary>Denormalised so history stays readable if a staff account is later removed.</summary>
    public string ChangedByLabel { get; set; } = "Sistemi";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A scored suggestion that <see cref="ReportId"/> duplicates <see cref="CandidateReportId"/>.
/// Never applied automatically — a human confirms or rejects.
/// </summary>
public class DuplicateCandidate
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The newly submitted report.</summary>
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    /// <summary>The existing report it may duplicate.</summary>
    public Guid CandidateReportId { get; set; }
    public Report? CandidateReport { get; set; }

    public double DistanceMeters { get; set; }
    public double TextSimilarity { get; set; }
    public double Score { get; set; }
    /// <summary>Human-readable explanation of how the score was reached — no black boxes.</summary>
    public string Method { get; set; } = "geo+trigram+category";

    public DuplicateReviewStatus ReviewStatus { get; set; } = DuplicateReviewStatus.Pending;
    public Guid? ReviewedByStaffId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A photo on <see cref="ReportId"/> perceptually matches a photo already used on
/// <see cref="MatchedReportId"/> — the same picture, or a lightly-edited copy of it, reused across two
/// reports. Deliberately NOT a <see cref="DuplicateCandidate"/>: those two reports are not necessarily
/// describing the same physical incident (a recycled stock photo, or an old "before" photo reused to
/// claim a fixed problem is still broken, both point at two genuinely different situations), so
/// confirming this must never merge anything. It only ever asks a human to look.
/// </summary>
public class PhotoReuseFlag
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>The newer report — the one whose upload triggered the match.</summary>
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    /// <summary>The existing report whose photo it matches.</summary>
    public Guid MatchedReportId { get; set; }
    public Report? MatchedReport { get; set; }

    /// <summary>Bits differing between the two dHashes, out of 64 — 0 means visually identical after
    /// re-encoding. Shown to staff as-is; no black-box "confidence", just the actual number.</summary>
    public int HammingDistance { get; set; }

    public PhotoReuseReviewStatus ReviewStatus { get; set; } = PhotoReuseReviewStatus.Pending;
    public Guid? ReviewedByStaffId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Polling-delivered citizen notification. Real push (FCM/APNs) is an explicit, declared cut —
/// the mobile app raises an Expo local notification for unread rows on focus.
/// </summary>
public class CitizenNotification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    public Guid CitizenUserId { get; set; }
    public CitizenUser? CitizenUser { get; set; }
    public NotificationType Type { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    /// <summary>English counterparts, stored alongside rather than computed later — the same pattern as
    /// Category.NameSq/NameEn. Every client picks between Title/TitleEn at render time; nothing server-
    /// side ever needs these except the one-shot push send, which reads the citizen's PreferredLocale
    /// instead of guessing from the request.</summary>
    public string TitleEn { get; set; } = string.Empty;
    public string BodyEn { get; set; } = string.Empty;
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// The reporter's answer to "is it actually fixed?", asked once per resolution.
///
/// This is the only row in the schema written by a citizen about the municipality's own work, and it
/// exists because "Resolved" is a claim by the party being measured. Everything else here — the status
/// history, the SLA clock, the resolution timestamp — records what the municipality did. This records
/// whether it worked, according to the one person who has to live with the answer.
///
/// Deliberately append-only and never edited: a verification is evidence about a moment, and a citizen
/// changing their mind next month is a new fact, not a correction of the old one.
/// </summary>
public class ResolutionVerification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    /// <summary>Always the report's own reporter. Nobody else is asked, and nobody else may answer.</summary>
    public Guid CitizenUserId { get; set; }
    public CitizenUser? CitizenUser { get; set; }

    public VerificationOutcome Outcome { get; set; }
    public string? Comment { get; set; }

    /// <summary>The "after" photo, paired with the report's own photo as the before.</summary>
    public string? PhotoUrl { get; set; }

    /// <summary>Where the citizen stood when they answered, when the device gave us a fix.</summary>
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    /// <summary>
    /// Metres from the report's original pin. Stored raw rather than as a "was it close enough" flag:
    /// the threshold is a policy that will be tuned, and a boolean would make every past verification
    /// unreadable the first time it changed.
    /// </summary>
    public double? DistanceMeters { get; set; }

    /// <summary>
    /// Which resolution this answers — a copy of <see cref="Report.ResolvedAt"/> as it stood when the
    /// question was asked. This is what makes a reopened-and-re-resolved case ask again rather than
    /// counting a months-old "yes" as an answer about work that has since been redone, and it is the
    /// unique key that stops the same resolution being answered twice.
    /// </summary>
    public DateTime ResolvedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A cluster of reports the system suspects share a root cause or a common structural condition —
/// zoomed out from any single incident. Where <see cref="DuplicateCandidate"/> answers "is this the
/// same physical problem as that one?", this answers a different question entirely: "do these several
/// <em>different</em> problems point at one thing worth investigating together?" A pattern never merges
/// its members — each stays its own report, inspected and closed on its own — it only groups them for a
/// supervisor's attention, the way a detective's board links separate cases with a piece of string.
/// </summary>
public class SystemicPattern
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MunicipalityId { get; set; }
    public Municipality? Municipality { get; set; }

    public Guid CategoryId { get; set; }
    public Category? Category { get; set; }
    /// <summary>Denormalised from <see cref="Category"/> at creation, same reasoning as
    /// <see cref="Report.DepartmentId"/> — the department that would act on this pattern.</summary>
    public Guid? DepartmentId { get; set; }
    public Department? Department { get; set; }

    public double CentroidLat { get; set; }
    public double CentroidLng { get; set; }

    /// <summary>Denormalised count, same reasoning as <see cref="Report.ConfirmationCount"/> — a list
    /// view should never need a COUNT() over the members just to render a badge.</summary>
    public int MemberCount { get; set; }

    // --- AI verdict block, mirroring Report's Ai* shape: preserved so "was the AI plausible here?"
    //     remains answerable, and null-able throughout because a pattern can exist as a raw, unexplained
    //     cluster when the synthesis call was never made or failed — the count alone is still real
    //     information, and losing the pattern over a model timeout would be exactly the failure this
    //     app refuses to allow anywhere else.
    public string? AiSummarySq { get; set; }
    public ConnectionType? AiConnectionType { get; set; }
    public double? AiConfidence { get; set; }
    public string? AiModel { get; set; }

    public PatternReviewStatus ReviewStatus { get; set; } = PatternReviewStatus.Pending;
    public Guid? ReviewedByStaffId { get; set; }
    public DateTime? ReviewedAt { get; set; }

    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Timestamp of the most recently joined member — what "is this pattern still active?"
    /// is judged against, distinct from <see cref="DetectedAt"/> which never moves.</summary>
    public DateTime LastReportAt { get; set; }

    public ICollection<Report> Members { get; set; } = new List<Report>();
}

/// <summary>
/// Records that a citizen pressed "me too" on a report. The unique (ReportId, CitizenUserId) index is
/// the actual enforcement of "one confirmation per user, ever" — the API layer checks it, but the
/// database is what makes that rule unbreakable under concurrent requests.
/// </summary>
public class ReportConfirmation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ReportId { get; set; }
    public Report? Report { get; set; }

    public Guid CitizenUserId { get; set; }
    public CitizenUser? CitizenUser { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
