using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>The municipal clerk's working surface: the queue, the detail view, and every case action.</summary>
[ApiController]
[Route("api/v1/staff/reports")]
[Authorize]
[Tags("Staff — case management")]
public class StaffReportsController(
    AppDbContext db, ReportWorkflow workflow, ReportDossierService dossiers,
    IRealtimeBroadcaster realtime, ILogger<StaffReportsController> logger) : ControllerBase
{
    /// <summary>The filterable, paged report queue that backs the dashboard table and map.</summary>
    [HttpGet]
    [ProducesResponseType<PagedResult<ReportListItemDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<PagedResult<ReportListItemDto>>> List(
        [FromQuery] string[]? status,
        [FromQuery] string[]? categoryCode,
        [FromQuery] Guid? departmentId,
        [FromQuery] string[]? priority,
        [FromQuery] bool assignedToMe = false,
        [FromQuery] bool hasPendingDuplicates = false,
        [FromQuery] bool needsReview = false,
        [FromQuery] bool disputed = false,
        [FromQuery] DateTime? from = null,
        [FromQuery] DateTime? to = null,
        [FromQuery] string? search = null,
        [FromQuery] string sort = "newest",
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 25,
        CancellationToken ct = default)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var query = db.Reports.AsNoTracking()
            .Include(r => r.Category)
            .Include(r => r.Department)
            .Include(r => r.Photos)
            .Include(r => r.AssignedToStaff)
            .AsQueryable();

        if (status is { Length: > 0 })
        {
            var wanted = status.Select(ReportsController.ParseStatus).OfType<ReportStatus>().ToArray();
            if (wanted.Length > 0) query = query.Where(r => wanted.Contains(r.Status));
        }
        else
        {
            // Default view is the working queue: merged and rejected cases are archive, not inbox.
            query = query.Where(r => r.Status != ReportStatus.Merged);
        }

        if (categoryCode is { Length: > 0 })
            query = query.Where(r => r.Category != null && categoryCode.Contains(r.Category.Code));

        if (departmentId is { } deptId)
            query = query.Where(r => r.DepartmentId == deptId);

        if (priority is { Length: > 0 })
        {
            var wanted = priority
                .Select(p => Enum.TryParse<ReportPriority>(p, true, out var parsed) ? parsed : (ReportPriority?)null)
                .OfType<ReportPriority>().ToArray();
            if (wanted.Length > 0) query = query.Where(r => wanted.Contains(r.Priority));
        }

        if (assignedToMe) query = query.Where(r => r.AssignedToStaffId == me.Id);
        if (from is { } f) query = query.Where(r => r.CreatedAt >= f);
        if (to is { } t) query = query.Where(r => r.CreatedAt <= t);

        // The "the AI wasn't sure — look at this yourself" filter. This is the honesty feature made
        // operational: low-confidence classifications surface as work, not as silent bad routing.
        if (needsReview)
            query = query.Where(r => r.AiConfidence != null && r.AiConfidence < 0.65 && !r.IsCategoryOverridden);

        // "We closed it and the person who reported it says we didn't." The counterpart of needsReview:
        // both filters exist to turn a quiet failure into visible work, one for the AI's mistakes and
        // one for the municipality's. Matched on resolved_at so a case that was disputed, reopened and
        // genuinely fixed afterwards drops out of this list on its own.
        if (disputed)
        {
            query = query.Where(r => db.ResolutionVerifications.Any(v =>
                v.ReportId == r.Id
                && v.ResolvedAt == r.ResolvedAt
                && v.Outcome == VerificationOutcome.Disputed));
        }

        if (hasPendingDuplicates)
        {
            var flagged = db.DuplicateCandidates
                .Where(c => c.ReviewStatus == DuplicateReviewStatus.Pending)
                .Select(c => c.CandidateReportId);
            query = query.Where(r => flagged.Contains(r.Id));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(r =>
                EF.Functions.ILike(r.Title, $"%{term}%") ||
                EF.Functions.ILike(r.Description, $"%{term}%") ||
                EF.Functions.ILike(r.PublicRef, $"%{term}%") ||
                (r.AddressText != null && EF.Functions.ILike(r.AddressText, $"%{term}%")));
        }

        query = sort switch
        {
            "oldest" => query.OrderBy(r => r.CreatedAt),
            "priority" => query.OrderByDescending(r => r.Priority).ThenByDescending(r => r.CreatedAt),
            "confirmations" => query.OrderByDescending(r => r.ConfirmationCount).ThenByDescending(r => r.CreatedAt),
            _ => query.OrderByDescending(r => r.CreatedAt)
        };

        var total = await query.CountAsync(ct);
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);

        // One grouped query for duplicate badges rather than N per-row lookups.
        var ids = items.Select(r => r.Id).ToList();
        var duplicateCounts = await db.DuplicateCandidates.AsNoTracking()
            .Where(c => c.ReviewStatus == DuplicateReviewStatus.Pending && ids.Contains(c.CandidateReportId))
            .GroupBy(c => c.CandidateReportId)
            .Select(g => new { ReportId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.ReportId, x => x.Count, ct);

        var verificationOutcomes = await db.CurrentVerificationOutcomesAsync(items, ct);

        return Ok(new PagedResult<ReportListItemDto>(
            items.Select(r => r.ToListItem(
                duplicateCounts.GetValueOrDefault(r.Id),
                verificationOutcomes.GetValueOrDefault(r.Id))).ToList(),
            page, pageSize, total));
    }

    /// <summary>Full case file: history, duplicate candidates, and the legal next moves.</summary>
    [HttpGet("{id:guid}")]
    [ProducesResponseType<ReportDetailDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReportDetailDto>> GetById(Guid id, CancellationToken ct)
    {
        var report = await FullReports().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        var suggested = report.AiSuggestedCategoryId is null
            ? null
            : await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == report.AiSuggestedCategoryId, ct);

        var history = await db.ReportStatusHistory.AsNoTracking()
            .Where(h => h.ReportId == id)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync(ct);

        // Candidates in both directions: this report may duplicate another, or others may duplicate it.
        var candidates = await db.DuplicateCandidates.AsNoTracking()
            .Where(c => c.ReportId == id || c.CandidateReportId == id)
            .Where(c => c.ReviewStatus == DuplicateReviewStatus.Pending)
            .ToListAsync(ct);

        var otherIds = candidates
            .Select(c => c.ReportId == id ? c.CandidateReportId : c.ReportId)
            .Distinct().ToList();

        var others = await db.Reports.AsNoTracking()
            .Include(r => r.Category).Include(r => r.Photos)
            .Where(r => otherIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, ct);

        var candidateDtos = candidates
            .Select(c => new { Candidate = c, OtherId = c.ReportId == id ? c.CandidateReportId : c.ReportId })
            .Where(x => others.ContainsKey(x.OtherId))
            .Select(x => x.Candidate.ToDto(others[x.OtherId]))
            .ToList();

        // The reporter's account is deliberately not loaded here any more. Staff used to receive their
        // name, email and phone on this endpoint; they now receive nothing about them, and the query
        // that would have fetched it is gone rather than merely unused — an unused join is an
        // invitation, and the next person adding a field to this response should have to write the
        // lookup themselves and notice what they are doing.

        // Latest, not "the one for the current resolution": staff need to see a dispute that is the
        // reason a case was reopened, long after the resolution it answered stopped being current.
        var verification = await db.ResolutionVerifications.AsNoTracking()
            .Where(v => v.ReportId == id)
            .OrderByDescending(v => v.CreatedAt)
            .FirstOrDefaultAsync(ct);

        SystemicPattern? pattern = report.SystemicPatternId is { } patternId
            ? await db.SystemicPatterns.AsNoTracking()
                .Include(p => p.Category).Include(p => p.Department).Include(p => p.Members)
                .FirstOrDefaultAsync(p => p.Id == patternId, ct)
            : null;

        return Ok(new ReportDetailDto(
            report.ToDto(suggested, verification: verification, pattern: pattern),
            history.Select(h => h.ToDto()).ToList(),
            candidateDtos,
            ReportWorkflow.AllowedNext(report.Status).Select(s => s.ToString()).ToList(),
            pattern?.ToDto()));
    }

    /// <summary>Moves the case forward. Illegal transitions are refused with 409, not silently applied.</summary>
    [HttpPatch("{id:guid}/status")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ReportDto>> ChangeStatus(
        Guid id, ChangeStatusRequest request, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var report = await FullReports().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        try
        {
            await workflow.ChangeStatus(report, request.Status, request.Note, me, ct: ct);
        }
        catch (InvalidStatusTransitionException ex)
        {
            return Problem(
                title: "Kalim i palejuar statusi",
                detail: $"Një raport në statusin '{ex.From}' nuk mund të kalojë në '{ex.To}'.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await db.SaveChangesAsync(ct);
        // ChangeStatus queued the report + notification events; this is what actually sends them, and it
        // is deliberately after the commit so a listener that refetches cannot read the pre-change row.
        await realtime.FlushAsync(ct);

        return Ok(report.ToDto());
    }

    /// <summary>
    /// The printable case file: everything about the report in one Word document — description, photos,
    /// timings against the department's SLA, the AI's contribution, the reporter's contact details and
    /// the full audit trail, with a signature block at the end.
    /// </summary>
    /// <remarks>
    /// Deliberately not restricted to resolved reports. The clients surface the option on resolution,
    /// which is when it is normally wanted, but a clerk taking an open case to a site visit or a meeting
    /// has the same need, and refusing that would be an artificial limit on a read-only export.
    /// </remarks>
    [HttpGet("{id:guid}/dossier")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Dossier(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var dossier = await dossiers.BuildAsync(id, me, ct);
        if (dossier is null) return NotFound();

        return File(
            dossier.Content,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            dossier.FileName);
    }

    /// <summary>Routes the case to a department and/or a named officer.</summary>
    [HttpPatch("{id:guid}/assign")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReportDto>> Assign(Guid id, AssignRequest request, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var report = await FullReports().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        if (request.DepartmentId is { } deptId)
        {
            var department = await db.Departments.FirstOrDefaultAsync(d => d.Id == deptId, ct);
            if (department is null) return BadRequest();
            report.DepartmentId = deptId;
            report.Department = department;
        }

        if (request.StaffUserId is { } staffId)
        {
            var assignee = await db.StaffUsers.FirstOrDefaultAsync(u => u.Id == staffId && u.IsActive, ct);
            if (assignee is null) return BadRequest();
            report.AssignedToStaffId = staffId;
            report.AssignedToStaff = assignee;
        }

        report.UpdatedAt = DateTime.UtcNow;

        // Assigning a case implicitly moves it out of the triage queue — the clerk shouldn't have to
        // perform two actions to express one decision.
        if (report.Status is ReportStatus.Submitted or ReportStatus.InReview)
        {
            if (report.Status == ReportStatus.Submitted)
                await workflow.ChangeStatus(report, ReportStatus.InReview, null, me, ct: ct);

            // Assigned is not in the generic transition table (see ReportWorkflow.Allowed) — this is the
            // one legitimate way to reach it, so it bypasses that table rather than being added to it.
            await workflow.ChangeStatus(report, ReportStatus.Assigned,
                request.Note ?? $"Caktuar {report.AssignedToStaff?.FullName ?? report.Department?.ShortName}.",
                me, bypassTransitionCheck: true, ct: ct);
        }
        else
        {
            await workflow.AppendHistoryAsync(report, report.Status, report.Status,
                request.Note ?? "Ricaktim i rastit.", me, ct: ct);
        }

        // Queued unconditionally: the branch above only calls ChangeStatus for a case still in triage, so
        // a re-assignment of an already-assigned report would otherwise produce no event at all.
        realtime.ReportChanged(report, RealtimeActions.Assigned);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        return Ok(report.ToDto());
    }

    /// <summary>
    /// Overrides the AI's category. The original suggestion is deliberately preserved — this is what
    /// makes the dashboard's AI-agreement metric an honest measurement rather than a marketing number.
    /// </summary>
    [HttpPatch("{id:guid}/category")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    public async Task<ActionResult<ReportDto>> OverrideCategory(
        Guid id, OverrideCategoryRequest request, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var report = await FullReports().FirstOrDefaultAsync(r => r.Id == id, ct);
        if (report is null) return NotFound();

        var category = await db.Categories
            .Include(c => c.DefaultDepartment!).ThenInclude(d => d.DefaultAssignee)
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId, ct);
        if (category is null) return BadRequest();

        var changed = report.CategoryId != category.Id;

        report.CategoryId = category.Id;
        report.Category = category;
        if (request.Priority is { } priority) report.Priority = priority;
        report.UpdatedAt = DateTime.UtcNow;

        if (changed)
        {
            report.IsCategoryOverridden = true;
            report.ClassificationSource = ClassificationSource.Manual;
            report.OverriddenByStaffId = me.Id;
            report.OverrideReason = request.Reason;

            await workflow.AppendHistoryAsync(report, report.Status, report.Status,
                $"Kategoria u ndryshua manualisht në '{category.NameSq}'." +
                (string.IsNullOrWhiteSpace(request.Reason) ? "" : $" Arsyeja: {request.Reason}"),
                me, ct: ct);

            // Re-route unconditionally to the new category's directorate and default person — a
            // deliberate reversal of "a human's earlier choice wins": the whole point of this rule is
            // that the category is what decides who owns a report, so a category change means the old
            // department/assignee pairing is now wrong, not that it should survive out of inertia.
            // A closed case is the one exception — re-routing a Resolved/Rejected/Merged report to a
            // new owner has no one left to act on it.
            var isClosed = report.Status is ReportStatus.Resolved or ReportStatus.Rejected or ReportStatus.Merged;
            if (!isClosed)
            {
                var previousAssignee = report.AssignedToStaff?.FullName;

                report.DepartmentId = category.DefaultDepartmentId;
                report.Department = category.DefaultDepartment;
                report.AssignedToStaffId = category.DefaultDepartment?.DefaultAssigneeStaffId;
                report.AssignedToStaff = category.DefaultDepartment?.DefaultAssignee;

                var newAssignee = category.DefaultDepartment?.DefaultAssignee?.FullName;
                var routingNote = newAssignee is null
                    ? $"Drejtuar te {category.DefaultDepartment?.ShortName ?? "asnjë drejtori"} — " +
                      "ende pa një përgjegjës të caktuar për këtë drejtori."
                    : previousAssignee == newAssignee
                        ? $"Mbetet i caktuar te {newAssignee}."
                        : $"Rikaktuar automatikisht te {newAssignee}, sipas kategorisë së re.";
                // A fully deterministic string, built the same way as routingNote above — handed to
                // AppendHistoryAsync directly rather than through the translator, since there is nothing
                // free-form in it to translate.
                var routingNoteEn = newAssignee is null
                    ? $"Routed to {category.DefaultDepartment?.ShortName ?? "no directorate"} — " +
                      "no one assigned to that directorate yet."
                    : previousAssignee == newAssignee
                        ? $"Remains assigned to {newAssignee}."
                        : $"Automatically reassigned to {newAssignee}, per the new category.";

                // Attributed to the staff member, not "Sistemi": they did not click a routing button,
                // but they are the one who chose the category that caused this, and the history should
                // credit the action that actually happened rather than dress it up as automatic.
                await workflow.AppendHistoryAsync(report, report.Status, report.Status, routingNote, me, noteEn: routingNoteEn, ct: ct);

                // Assigning is what moves a case out of the triage queue everywhere else in this API
                // (see StaffReportsController.Assign) — a category change that hands the case straight
                // to someone should behave the same way, not leave it sitting in Submitted/InReview.
                if (report.AssignedToStaffId is not null && report.Status is ReportStatus.Submitted or ReportStatus.InReview)
                {
                    await workflow.ChangeStatus(report, ReportStatus.Assigned, null, me, bypassTransitionCheck: true, ct: ct);
                }
            }

            logger.LogInformation("Staff {Staff} overrode AI category on {Ref} -> {Category}",
                me.FullName, report.PublicRef, category.Code);
        }

        realtime.ReportChanged(report, RealtimeActions.Updated);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        var suggested = report.AiSuggestedCategoryId is null
            ? null
            : await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == report.AiSuggestedCategoryId, ct);

        return Ok(report.ToDto(suggested));
    }

    private IQueryable<Report> FullReports() => db.Reports
        .Include(r => r.Category)
        .Include(r => r.Department)
        .Include(r => r.Photos)
        .Include(r => r.AssignedToStaff)
        .Include(r => r.MergedIntoReport);
}

/// <summary>Staff directory for the dashboard's assignment dropdown.</summary>
[ApiController]
[Route("api/v1/staff/users")]
[Authorize]
[Tags("Staff — case management")]
public class StaffUsersController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<List<StaffUserDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<StaffUserDto>>> List(CancellationToken ct)
    {
        var users = await db.StaffUsers.AsNoTracking()
            .Include(u => u.Department)
            .Where(u => u.IsActive)
            .OrderBy(u => u.FullName)
            .ToListAsync(ct);

        return Ok(users.Select(u => u.ToDto()).ToList());
    }
}
