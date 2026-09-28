using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// The unified fraud review queue — every <see cref="FraudFlagKind"/> in one list, same "system
/// proposes, human decides" shape as <see cref="DuplicatesController"/> and <see cref="PatternsController"/>.
/// Confirming a flag here never touches the report(s) it points at; it only records that a clerk looked
/// and agreed it's worth following up on. See <see cref="StaffReportsController.RaiseFraudFlag"/> for the
/// one kind with no automated check behind it — a clerk's own judgement call.
/// </summary>
[ApiController]
[Route("api/v1/staff/fraud")]
[Authorize]
[Tags("Staff — fraud")]
public class FraudController(
    AppDbContext db, IRealtimeBroadcaster realtime, ILogger<FraudController> logger) : ControllerBase
{
    /// <summary>Pending flags, most recent first — every kind, automated and staff-raised alike.</summary>
    [HttpGet]
    [ProducesResponseType<List<FraudFlagDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<FraudFlagDto>>> List(CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var flags = await db.FraudFlags.AsNoTracking()
            .Include(f => f.RaisedByStaff)
            .Where(f => f.ReviewStatus == FraudReviewStatus.Pending)
            .OrderByDescending(f => f.CreatedAt)
            .Take(200)
            .ToListAsync(ct);

        if (flags.Count == 0) return Ok(new List<FraudFlagDto>());

        var ids = flags.Select(f => f.ReportId)
            .Concat(flags.Where(f => f.RelatedReportId is not null).Select(f => f.RelatedReportId!.Value))
            .Distinct().ToList();

        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category).Include(r => r.Department).Include(r => r.Photos)
            .Where(r => ids.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, ct);

        var items = flags
            .Where(f => reports.ContainsKey(f.ReportId))
            .Select(f => f.ToDto(
                reports[f.ReportId],
                f.RelatedReportId is { } relatedId && reports.TryGetValue(relatedId, out var related) ? related : null))
            .ToList();

        return Ok(items);
    }

    /// <summary>Confirms the flag is worth following up on. Touches neither report — see class remarks.</summary>
    [HttpPost("{id:guid}/acknowledge")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Acknowledge(Guid id, CancellationToken ct) =>
        Review(id, FraudReviewStatus.Acknowledged, ct);

    /// <summary>Marks the flag a false positive — a coincidence, or an innocent explanation.</summary>
    [HttpPost("{id:guid}/dismiss")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IActionResult> Dismiss(Guid id, CancellationToken ct) =>
        Review(id, FraudReviewStatus.Dismissed, ct);

    private async Task<IActionResult> Review(Guid id, FraudReviewStatus status, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var flag = await db.FraudFlags.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (flag is null) return NotFound();

        flag.ReviewStatus = status;
        flag.ReviewedByStaffId = me.Id;
        flag.ReviewedAt = DateTime.UtcNow;

        realtime.FraudFlagged(flag.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        logger.LogInformation("Staff {Staff} {Status} fraud flag {FlagId} ({Kind})",
            me.FullName, status, flag.Id, flag.Kind);
        return NoContent();
    }
}
