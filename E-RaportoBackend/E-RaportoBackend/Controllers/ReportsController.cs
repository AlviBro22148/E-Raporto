using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// The citizen surface. Every write requires a registered account; the map and a single report's
/// detail stay public so the transparency promise survives without forcing a signup just to look.
/// </summary>
[ApiController]
[Route("api/v1/reports")]
[Tags("Citizen — reports")]
[Authorize]
public class ReportsController(
    AppDbContext db,
    ReportTriageService triage,
    ReportWorkflow workflow,
    IRealtimeBroadcaster realtime,
    ILogger<ReportsController> logger) : ControllerBase
{
    /// <summary>
    /// Submits a new report and runs the full triage pipeline: AI categorisation, department routing,
    /// and a duplicate scan against nearby open reports.
    /// </summary>
    /// <remarks>
    /// The report is <b>always</b> created, even when duplicates are found — the candidates are an offer
    /// to the citizen, never a block. Losing a genuine report to a heuristic's false positive would be
    /// far worse than carrying an occasional duplicate.
    /// </remarks>
    [HttpPost]
    [EnableRateLimiting("submit-report")]
    [ProducesResponseType<CreateReportResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<CreateReportResponse>> Create(
        CreateReportRequest request, CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        // Presence check, before anything else runs (including the AI classification call, which costs
        // real money): the reporter's live GPS fix has to be inside Bashkia Elbasan right now. This is
        // deliberately separate from the pin below — a citizen who found a problem and had to rush off
        // can submit later from anywhere else inside the municipality and drag the pin back to the spot.
        if (!MunicipalityBoundaryService.IsInsideElbasan(request.DeviceLatitude, request.DeviceLongitude))
            return Problem(title: "Jashtë Bashkisë Elbasan",
                detail: "Raportimi lejohet vetëm kur ndodheni brenda kufijve të Bashkisë Elbasan.",
                statusCode: StatusCodes.Status400BadRequest);

        // Jurisdiction check: the problem itself has to be somewhere Bashkia Elbasan can actually act on.
        if (!MunicipalityBoundaryService.IsInsideElbasan(request.Latitude, request.Longitude))
            return Problem(title: "Vendndodhja jashtë bashkisë",
                detail: "Pika e shënuar në hartë duhet të jetë brenda kufijve të Bashkisë Elbasan.",
                statusCode: StatusCodes.Status400BadRequest);

        var outcome = await triage.SubmitAsync(request, citizen, ct);
        var report = outcome.Report;

        var category = report.Category!;
        var candidateDtos = await LoadCandidateDtosAsync(outcome.DuplicateCandidates, ct);

        // No identity in the line. This used to log the reporter's email next to the report reference,
        // which quietly rebuilt the exact mapping the rest of this design removes — in a file that is
        // rotated to disk, shipped to whatever log aggregator a pilot uses, and guarded by nobody.
        logger.LogInformation("Report {Ref} submitted — {Source} said {Code} ({Conf:P0})",
            report.PublicRef, outcome.Classification.Source,
            outcome.Classification.CategoryCode, outcome.Classification.Confidence);

        var response = new CreateReportResponse(
            report.ToDto(category, citizen.Id, hasConfirmed: false, pattern: outcome.Pattern),
            new ClassificationResultDto(
                outcome.Classification.CategoryCode,
                category.NameSq,
                category.NameEn,
                outcome.Classification.Confidence,
                outcome.Classification.Priority.ToString(),
                outcome.Classification.Reasoning,
                outcome.Classification.ReasoningEn,
                outcome.Classification.SummarySq,
                outcome.Classification.Source.ToString(),
                outcome.Classification.Model,
                outcome.Classification.IsLowConfidence),
            candidateDtos);

        return CreatedAtAction(nameof(GetById), new { id = report.Id }, response);
    }

    /// <summary>
    /// Confirms that this report duplicates an existing one, merging it into the parent. The citizen
    /// then follows the parent ticket, and the parent's confirmation count grows.
    /// </summary>
    [HttpPost("{id:guid}/confirm-duplicate")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReportDto>> ConfirmDuplicate(
        Guid id, ConfirmDuplicateRequest request, CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        var child = await db.Reports.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (child is null) return NotFound();

        // Only the citizen who filed the report may merge it away.
        if (child.ReporterUserId != citizen.Id) return Forbid();

        var parent = await ReportsWithDetail().FirstOrDefaultAsync(r => r.Id == request.CandidateReportId, ct);
        if (parent is null) return NotFound();

        await workflow.Merge(child, parent, actor: null, ct: ct);

        var candidate = await db.DuplicateCandidates.FirstOrDefaultAsync(
            c => c.ReportId == child.Id && c.CandidateReportId == parent.Id, ct);
        if (candidate is not null)
        {
            candidate.ReviewStatus = DuplicateReviewStatus.Confirmed;
            candidate.ReviewedAt = DateTime.UtcNow;
        }

        if (candidate is not null) realtime.DuplicateReviewed(candidate.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        return Ok(parent.ToDto(
            viewerId: citizen.Id,
            hasConfirmed: await HasConfirmedAsync(parent.Id, citizen.Id, ct)));
    }

    /// <summary>"Me too" — adds weight to an existing report instead of filing a new one.</summary>
    /// <remarks>
    /// Exactly one confirmation per citizen per report, enforced by a unique index on
    /// (report_id, citizen_user_id) rather than by the pre-check alone — so two rapid taps racing each
    /// other still cannot double-count. You also cannot confirm your own report: that would let a
    /// single account manufacture the very demand signal staff prioritise by.
    /// </remarks>
    [HttpPost("{id:guid}/confirm")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReportDto>> Confirm(Guid id, CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        var report = await ReportsWithDetail().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        if (report.ReporterUserId == citizen.Id)
        {
            return Problem(
                title: "Nuk mund të konfirmoni raportin tuaj",
                detail: "Raporti juaj numërohet tashmë. Konfirmimi është për raportet e të tjerëve.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (await HasConfirmedAsync(report.Id, citizen.Id, ct))
        {
            return Problem(
                title: "E keni konfirmuar tashmë",
                detail: "Çdo qytetar mund ta konfirmojë një raport vetëm një herë.",
                statusCode: StatusCodes.Status409Conflict);
        }

        db.ReportConfirmations.Add(new ReportConfirmation
        {
            ReportId = report.Id,
            CitizenUserId = citizen.Id
        });
        report.ConfirmationCount++;
        report.UpdatedAt = DateTime.UtcNow;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The unique index caught a race this request lost. The winning request already counted
            // it, so report the same outcome the user would have seen rather than a server error.
            return Problem(
                title: "E keni konfirmuar tashmë",
                detail: "Çdo qytetar mund ta konfirmojë një raport vetëm një herë.",
                statusCode: StatusCodes.Status409Conflict);
        }

        // Enqueued only past the catch: a confirmation that lost the race was never counted, and
        // telling every client to refetch over it would be announcing a change that did not happen.
        realtime.ReportChanged(report, RealtimeActions.Confirmed);
        await realtime.FlushAsync(ct);

        return Ok(report.ToDto(viewerId: citizen.Id, hasConfirmed: true));
    }

    /// <summary>
    /// The reporter's answer to "is it actually fixed?" — the one write in this API that records a
    /// judgement about the municipality's own work rather than by it.
    /// </summary>
    /// <remarks>
    /// A dispute deliberately does <b>not</b> reopen the case by itself. Letting one citizen flip a
    /// closed report back to open on their own word would hand any single account an unlimited veto over
    /// a directorate's queue, and the first bad-faith user would make the whole mechanism unusable for
    /// everyone else. What a dispute does instead is louder and harder to ignore: it is written into the
    /// permanent case history under the citizen's own name, it flags the report in the dashboard's queue
    /// and its own filter, and it subtracts from the verified-resolution rate on the analytics page —
    /// which is the number a municipality actually has to answer for. A human then decides whether to
    /// reopen, and that decision is recorded too.
    /// </remarks>
    [HttpPost("{id:guid}/verify-resolution")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReportDto>> VerifyResolution(
        Guid id, VerifyResolutionRequest request, CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        var report = await ReportsWithDetail().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        // Only the person who raised it. Not "any citizen", not "anyone who confirmed it": the whole
        // claim this feature makes is that the individual who was affected checked the outcome, and it
        // survives exactly as long as that stays true.
        if (report.ReporterUserId != citizen.Id)
        {
            return Problem(
                title: "Vetëm raportuesi mund të verifikojë",
                detail: "Këtë pyetje ia bëjmë personit që e ka hapur raportin.",
                statusCode: StatusCodes.Status403Forbidden);
        }

        if (report.Status != ReportStatus.Resolved || report.ResolvedAt is null)
        {
            return Problem(
                title: "Ky raport nuk është i zgjidhur",
                detail: "Verifikimi kërkohet vetëm pasi bashkia e shënon rastin si të zgjidhur.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var existing = await LatestVerificationAsync(report.Id, ct);
        if (existing.AnswersCurrentResolution(report))
        {
            return Problem(
                title: "E keni përgjigjur tashmë",
                detail: "Kjo zgjidhje është verifikuar një herë. Nëse rasti rihapet dhe zgjidhet sërish, do t'ju pyesim përsëri.",
                statusCode: StatusCodes.Status409Conflict);
        }

        // Distance is recorded, never enforced. A citizen whose phone gives no fix — indoors, battery
        // saver, permission denied — must still be able to answer, and a rule that quietly dropped those
        // answers would bias the rate towards whoever happens to have good GPS.
        double? distance = request.Latitude is { } lat && request.Longitude is { } lng
            ? Math.Round(DuplicateDetectionService.HaversineMeters(lat, lng, report.Latitude, report.Longitude), 1)
            : null;

        var verification = new ResolutionVerification
        {
            ReportId = report.Id,
            CitizenUserId = citizen.Id,
            Outcome = request.Outcome,
            Comment = string.IsNullOrWhiteSpace(request.Comment) ? null : request.Comment.Trim(),
            PhotoUrl = string.IsNullOrWhiteSpace(request.PhotoUrl) ? null : request.PhotoUrl,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            DistanceMeters = distance,
            ResolvedAt = report.ResolvedAt.Value
        };
        db.ResolutionVerifications.Add(verification);

        var confirmed = request.Outcome == VerificationOutcome.Confirmed;
        var note = confirmed
            ? "Qytetari konfirmoi se problemi është rregulluar."
            : "Qytetari kontestoi zgjidhjen: sipas tij problemi vazhdon.";
        if (verification.Comment is not null) note = $"{note} — {verification.Comment}";
        if (verification.PhotoUrl is not null) note = $"{note} (me foto)";

        // Credited to the citizen's handle, not to "Sistemi" and not to their name. This is the only
        // entry in a report's timeline written by someone outside the municipality, which is what makes
        // it worth reading — and also what made it dangerous: this row is shown on the public detail
        // screen and printed into the signed .docx case file. A clerk whose work was just disputed would
        // have been handed the name of the person who disputed it, in a municipal document.
        await workflow.AppendHistoryAsync(report, report.Status, report.Status, note,
            actor: null, label: $"Qytetari {citizen.Pseudonym}", ct: ct);
        report.UpdatedAt = DateTime.UtcNow;

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // The unique (report, resolved_at) index caught a double submit that raced the check above.
            return Problem(
                title: "E keni përgjigjur tashmë",
                detail: "Kjo zgjidhje është verifikuar një herë.",
                statusCode: StatusCodes.Status409Conflict);
        }

        logger.LogInformation("Report {Ref} resolution {Outcome} at {Distance}m",
            report.PublicRef, request.Outcome, distance?.ToString() ?? "unknown ");

        realtime.ReportChanged(report, confirmed ? RealtimeActions.Verified : RealtimeActions.Disputed);
        await realtime.FlushAsync(ct);

        return Ok(report.ToDto(
            viewerId: citizen.Id,
            hasConfirmed: await HasConfirmedAsync(report.Id, citizen.Id, ct),
            verification: verification));
    }

    /// <summary>
    /// Resolutions this citizen has been asked about and has not answered yet — what the app opens on.
    /// </summary>
    /// <remarks>
    /// Its own endpoint rather than a flag on <c>/reports/mine</c>: the app asks this on every launch and
    /// every return to the foreground, and it must stay a small query that is almost always empty. Making
    /// the launch path depend on fetching the citizen's entire report history would be paying for the
    /// list to answer a question about, usually, nothing.
    /// </remarks>
    [HttpGet("pending-verification")]
    [ProducesResponseType<List<PendingVerificationDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PendingVerificationDto>>> PendingVerification(CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        // NOT EXISTS against the matching resolved_at, so a report that was disputed, reopened and
        // resolved again reappears here rather than being considered permanently answered.
        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category)
            .Include(r => r.Department)
            .Include(r => r.Photos)
            .Where(r => r.ReporterUserId == citizen.Id
                        && r.Status == ReportStatus.Resolved
                        && r.ResolvedAt != null
                        && !db.ResolutionVerifications.Any(v =>
                            v.ReportId == r.Id && v.ResolvedAt == r.ResolvedAt))
            .OrderBy(r => r.ResolvedAt)
            .ToListAsync(ct);

        if (reports.Count == 0) return Ok(new List<PendingVerificationDto>());

        // The note the clerk left when they closed it — the claim the citizen is being asked to check.
        // Shown alongside the question because "is this fixed?" is unanswerable without knowing what the
        // municipality says it did.
        var ids = reports.Select(r => r.Id).ToList();
        var notes = await db.ReportStatusHistory.AsNoTracking()
            .Where(h => ids.Contains(h.ReportId) && h.ToStatus == ReportStatus.Resolved && h.Note != null)
            .GroupBy(h => h.ReportId)
            .Select(g => new { ReportId = g.Key, Note = g.OrderByDescending(h => h.CreatedAt).First().Note })
            .ToDictionaryAsync(x => x.ReportId, x => x.Note, ct);

        return Ok(reports.Select(r => new PendingVerificationDto(
            r.Id, r.PublicRef, r.Title, r.TitleEn,
            r.Category?.NameSq, r.Category?.NameEn, r.Category?.ColorHex,
            r.Photos.FirstOrDefault()?.Url,
            r.Latitude, r.Longitude, r.AddressText,
            r.Department?.ShortName,
            notes.GetValueOrDefault(r.Id),
            r.CreatedAt, r.ResolvedAt!.Value)).ToList());
    }

    /// <summary>
    /// Map pins for the citizen's map view. Lightweight by design — no descriptions, no photos — so the
    /// map stays responsive on a mid-range phone over mobile data.
    /// </summary>
    [HttpGet("map")]
    [AllowAnonymous]
    [ProducesResponseType<List<ReportPinDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ReportPinDto>>> Map(
        [FromQuery] double? lat, [FromQuery] double? lng, [FromQuery] double? radiusM,
        [FromQuery] string[]? status, [FromQuery] string[]? categoryCode,
        [FromQuery] int limit = 200, CancellationToken ct = default)
    {
        var query = db.Reports.AsNoTracking()
            .Include(r => r.Category)
            .Where(r => r.Status != ReportStatus.Merged && r.Status != ReportStatus.Rejected);

        if (status is { Length: > 0 })
        {
            var wanted = status.Select(ParseStatus).OfType<ReportStatus>().ToArray();
            if (wanted.Length > 0) query = query.Where(r => wanted.Contains(r.Status));
        }

        if (categoryCode is { Length: > 0 })
            query = query.Where(r => r.Category != null && categoryCode.Contains(r.Category.Code));

        // Bounding box in SQL (index-friendly), exact circle in memory.
        if (lat is { } centreLat && lng is { } centreLng)
        {
            var radius = radiusM ?? 6000;
            var latDelta = radius / 111_320.0;
            var lngDelta = radius / (111_320.0 * Math.Max(Math.Cos(centreLat * Math.PI / 180.0), 0.01));

            query = query.Where(r =>
                r.Latitude >= centreLat - latDelta && r.Latitude <= centreLat + latDelta &&
                r.Longitude >= centreLng - lngDelta && r.Longitude <= centreLng + lngDelta);

            var boxed = await query
                .OrderByDescending(r => r.CreatedAt)
                .Take(Math.Clamp(limit, 1, 1000))
                .ToListAsync(ct);

            var inRadius = boxed
                .Where(r => DuplicateDetectionService.HaversineMeters(centreLat, centreLng, r.Latitude, r.Longitude) <= radius)
                .ToList();
            return Ok(await BuildPinsAsync(inRadius, ct));
        }

        var all = await query
            .OrderByDescending(r => r.CreatedAt)
            .Take(Math.Clamp(limit, 1, 1000))
            .ToListAsync(ct);

        return Ok(await BuildPinsAsync(all, ct));
    }

    /// <summary>
    /// Batches the one extra lookup a map pin needs beyond what's already on the Report row: whether a
    /// Resolved report's reporter has confirmed THIS resolution. A single query for every candidate
    /// report rather than N+1 per pin, matched the same way <see cref="Mapping.AnswersCurrentResolution"/>
    /// does elsewhere — by ResolvedAt equality, so an old verdict from before a reopen doesn't count.
    /// </summary>
    private async Task<List<ReportPinDto>> BuildPinsAsync(List<Report> reports, CancellationToken ct)
    {
        var resolvedIds = reports
            .Where(r => r.Status == ReportStatus.Resolved && r.ResolvedAt is not null)
            .Select(r => r.Id)
            .ToList();

        var verifications = resolvedIds.Count == 0
            ? []
            : await db.ResolutionVerifications.AsNoTracking()
                .Where(v => resolvedIds.Contains(v.ReportId) && v.Outcome == VerificationOutcome.Confirmed)
                .ToListAsync(ct);

        return reports
            .Select(r => r.ToPin(verifications.Any(v => v.ReportId == r.Id && v.ResolvedAt == r.ResolvedAt)))
            .ToList();
    }

    /// <summary>
    /// Public detail view. The reporter's name is shown (accountability), their contact details are not.
    /// </summary>
    [HttpGet("{id:guid}")]
    [AllowAnonymous]
    [ProducesResponseType<ReportDetailDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReportDetailDto>> GetById(Guid id, CancellationToken ct)
    {
        var report = await ReportsWithDetail().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        var suggested = await SuggestedCategoryAsync(report, ct);
        var history = await db.ReportStatusHistory.AsNoTracking()
            .Where(h => h.ReportId == id)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync(ct);

        // Anonymous callers are allowed here, so there may be no citizen to personalise for.
        var citizen = await this.CurrentCitizenAsync(db, ct);
        bool? hasConfirmed = citizen is null ? null : await HasConfirmedAsync(id, citizen.Id, ct);
        var verification = await LatestVerificationAsync(id, ct);
        var pattern = await LoadPatternAsync(report.SystemicPatternId, ct);

        return Ok(new ReportDetailDto(
            report.ToDto(suggested, citizen?.Id, hasConfirmed, verification, pattern),
            history.Select(h => h.ToDto()).ToList(),
            [],                                     // duplicate candidates are a staff concern
            AllowedNextStatuses: []));               // the full pattern object is a staff concern too —
                                                      // this DTO's PatternNote on Report is the citizen's
                                                      // whole view of it
    }

    /// <summary>Everything this citizen has reported, newest first — the "My Reports" screen.</summary>
    [HttpGet("mine")]
    [ProducesResponseType<List<ReportListItemDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ReportListItemDto>>> Mine(CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category)
            .Include(r => r.Department)
            .Include(r => r.Photos)
            .Where(r => r.ReporterUserId == citizen.Id)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        var outcomes = await db.CurrentVerificationOutcomesAsync(reports, ct);

        return Ok(reports
            .Select(r => r.ToListItem(verificationOutcome: outcomes.GetValueOrDefault(r.Id)))
            .ToList());
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private IQueryable<Report> ReportsWithDetail() => db.Reports
        .Include(r => r.Category)
        .Include(r => r.Department)
        .Include(r => r.Photos)
        .Include(r => r.AssignedToStaff)
        .Include(r => r.MergedIntoReport);

    /// <summary>
    /// The most recent verification of any resolution of this report, current or superseded.
    /// </summary>
    /// <remarks>
    /// Deliberately not filtered to the live resolution. A report that was disputed and reopened should
    /// keep showing "the citizen said this wasn't fixed" — that verdict is the reason the case is open
    /// again, and dropping it the moment staff acted would delete the only trace of why.
    /// <see cref="Mapping.AnswersCurrentResolution"/> is what separates "still stands" from "was about a
    /// previous closure".
    /// </remarks>
    private Task<ResolutionVerification?> LatestVerificationAsync(Guid reportId, CancellationToken ct) =>
        db.ResolutionVerifications.AsNoTracking()
            .Where(v => v.ReportId == reportId)
            .OrderByDescending(v => v.CreatedAt)
            .FirstOrDefaultAsync(ct);

    /// <summary>Loaded only far enough to build <see cref="Mapping.ToPatternNote"/> — the citizen never
    /// receives the AI's connection-type verdict or the sibling member list, so this endpoint has no
    /// reason to fetch them.</summary>
    private Task<SystemicPattern?> LoadPatternAsync(Guid? patternId, CancellationToken ct) =>
        patternId is null
            ? Task.FromResult<SystemicPattern?>(null)
            : db.SystemicPatterns.AsNoTracking().FirstOrDefaultAsync(p => p.Id == patternId, ct);

    private Task<bool> HasConfirmedAsync(Guid reportId, Guid citizenId, CancellationToken ct) =>
        db.ReportConfirmations.AsNoTracking()
            .AnyAsync(c => c.ReportId == reportId && c.CitizenUserId == citizenId, ct);

    private async Task<Category?> SuggestedCategoryAsync(Report report, CancellationToken ct) =>
        report.AiSuggestedCategoryId is null
            ? null
            : await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == report.AiSuggestedCategoryId, ct);

    private async Task<List<DuplicateCandidateDto>> LoadCandidateDtosAsync(
        IReadOnlyList<DuplicateCandidate> candidates, CancellationToken ct)
    {
        if (candidates.Count == 0) return [];

        var ids = candidates.Select(c => c.CandidateReportId).ToList();
        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category)
            .Include(r => r.Photos)
            .Where(r => ids.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, ct);

        return candidates
            .Where(c => reports.ContainsKey(c.CandidateReportId))
            .Select(c => c.ToDto(reports[c.CandidateReportId]))
            .ToList();
    }

    internal static ReportStatus? ParseStatus(string value) =>
        Enum.TryParse<ReportStatus>(value, ignoreCase: true, out var parsed) ? parsed : null;
}
