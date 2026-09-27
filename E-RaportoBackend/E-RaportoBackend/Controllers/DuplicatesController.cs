using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

public record DuplicateReviewItemDto(
    Guid CandidateId,
    ReportListItemDto NewReport,
    ReportListItemDto ExistingReport,
    double DistanceMeters,
    double TextSimilarity,
    double Score,
    string Method,
    DateTime CreatedAt);

/// <summary>
/// The duplicate review queue. A clerk sees both reports side by side with the full score breakdown —
/// distance, text overlap, category match — and decides. Nothing merges without that decision.
/// </summary>
[ApiController]
[Route("api/v1/staff/duplicates")]
[Authorize]
[Tags("Staff — duplicates")]
public class DuplicatesController(
    AppDbContext db, ReportWorkflow workflow, IRealtimeBroadcaster realtime,
    ILogger<DuplicatesController> logger) : ControllerBase
{
    /// <summary>Pending duplicate suggestions, strongest first.</summary>
    [HttpGet]
    [ProducesResponseType<List<DuplicateReviewItemDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<DuplicateReviewItemDto>>> List(CancellationToken ct)
    {
        var candidates = await db.DuplicateCandidates.AsNoTracking()
            .Where(c => c.ReviewStatus == DuplicateReviewStatus.Pending)
            .OrderByDescending(c => c.Score)
            .Take(100)
            .ToListAsync(ct);

        if (candidates.Count == 0) return Ok(new List<DuplicateReviewItemDto>());

        var ids = candidates.SelectMany(c => new[] { c.ReportId, c.CandidateReportId }).Distinct().ToList();
        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category).Include(r => r.Department).Include(r => r.Photos)
            .Where(r => ids.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, ct);

        var items = candidates
            .Where(c => reports.ContainsKey(c.ReportId) && reports.ContainsKey(c.CandidateReportId))
            .Select(c => new DuplicateReviewItemDto(
                c.Id,
                reports[c.ReportId].ToListItem(),
                reports[c.CandidateReportId].ToListItem(),
                c.DistanceMeters, c.TextSimilarity, c.Score, c.Method, c.CreatedAt))
            .ToList();

        return Ok(items);
    }

    /// <summary>
    /// Confirms the duplicate: the newer report is merged into the existing one and its reporter starts
    /// following that ticket. Reversible by design — the merged report keeps its row and its history.
    /// </summary>
    [HttpPost("{candidateId:guid}/confirm")]
    [ProducesResponseType<ReportDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ReportDto>> Confirm(Guid candidateId, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var candidate = await db.DuplicateCandidates.FirstOrDefaultAsync(c => c.Id == candidateId, ct);
        if (candidate is null) return NotFound();

        if (candidate.ReviewStatus != DuplicateReviewStatus.Pending)
            return Problem(title: "Tashmë e shqyrtuar",
                detail: "Ky propozim dublikimi është shqyrtuar më parë.",
                statusCode: StatusCodes.Status409Conflict);

        var child = await db.Reports.FirstOrDefaultAsync(r => r.Id == candidate.ReportId, ct);
        var parent = await db.Reports
            .Include(r => r.Category).Include(r => r.Department).Include(r => r.Photos)
            .FirstOrDefaultAsync(r => r.Id == candidate.CandidateReportId, ct);
        if (child is null || parent is null) return NotFound();

        await workflow.Merge(child, parent, me, ct: ct);

        candidate.ReviewStatus = DuplicateReviewStatus.Confirmed;
        candidate.ReviewedByStaffId = me.Id;
        candidate.ReviewedAt = DateTime.UtcNow;

        // Any other pending suggestion involving the now-merged child is moot.
        await db.DuplicateCandidates
            .Where(c => c.Id != candidateId
                        && c.ReviewStatus == DuplicateReviewStatus.Pending
                        && (c.ReportId == child.Id || c.CandidateReportId == child.Id))
            .ExecuteUpdateAsync(s => s.SetProperty(c => c.ReviewStatus, DuplicateReviewStatus.AutoDismissed), ct);

        realtime.DuplicateReviewed(candidate.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        logger.LogInformation("Staff {Staff} confirmed duplicate {Child} -> {Parent}",
            me.FullName, child.PublicRef, parent.PublicRef);

        return Ok(parent.ToDto());
    }

    /// <summary>Rejects the suggestion so it never resurfaces — the two reports are genuinely distinct.</summary>
    [HttpPost("{candidateId:guid}/reject")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Reject(Guid candidateId, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var candidate = await db.DuplicateCandidates.FirstOrDefaultAsync(c => c.Id == candidateId, ct);
        if (candidate is null) return NotFound();

        candidate.ReviewStatus = DuplicateReviewStatus.Rejected;
        candidate.ReviewedByStaffId = me.Id;
        candidate.ReviewedAt = DateTime.UtcNow;
        realtime.DuplicateReviewed(candidate.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        return NoContent();
    }
}
