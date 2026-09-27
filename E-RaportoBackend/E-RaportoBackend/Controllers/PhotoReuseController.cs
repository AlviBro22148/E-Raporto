using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

public record PhotoReuseFlagDto(
    Guid FlagId,
    ReportListItemDto Report,
    ReportListItemDto MatchedReport,
    int HammingDistance,
    DateTime CreatedAt);

/// <summary>
/// The reused-photo review queue — same "system proposes, human decides" shape as
/// <see cref="DuplicatesController"/> and <see cref="PatternsController"/>, aimed at a different question:
/// not "are these the same complaint" but "has this exact picture shown up on another report before".
/// Reusing a photo isn't proof of anything on its own — a citizen can legitimately resubmit their own
/// photo, or two people can photograph the same public eyesore — so nothing here touches either report;
/// staff just get the pairing surfaced for a look.
/// </summary>
[ApiController]
[Route("api/v1/staff/photo-reuse")]
[Authorize]
[Tags("Staff — photo reuse")]
public class PhotoReuseController(
    AppDbContext db, IRealtimeBroadcaster realtime, ILogger<PhotoReuseController> logger) : ControllerBase
{
    /// <summary>Pending reuse flags, most recent first.</summary>
    [HttpGet]
    [ProducesResponseType<List<PhotoReuseFlagDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<PhotoReuseFlagDto>>> List(CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var flags = await db.PhotoReuseFlags.AsNoTracking()
            .Where(f => f.ReviewStatus == PhotoReuseReviewStatus.Pending)
            .OrderByDescending(f => f.CreatedAt)
            .Take(100)
            .ToListAsync(ct);

        if (flags.Count == 0) return Ok(new List<PhotoReuseFlagDto>());

        var ids = flags.SelectMany(f => new[] { f.ReportId, f.MatchedReportId }).Distinct().ToList();
        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category).Include(r => r.Department).Include(r => r.Photos)
            .Where(r => ids.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, ct);

        var items = flags
            .Where(f => reports.ContainsKey(f.ReportId) && reports.ContainsKey(f.MatchedReportId))
            .Select(f => new PhotoReuseFlagDto(
                f.Id,
                reports[f.ReportId].ToListItem(),
                reports[f.MatchedReportId].ToListItem(),
                f.HammingDistance, f.CreatedAt))
            .ToList();

        return Ok(items);
    }

    /// <summary>Confirms the reuse is worth following up on. Touches neither report — see class remarks.</summary>
    [HttpPost("{id:guid}/acknowledge")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Acknowledge(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var flag = await db.PhotoReuseFlags.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (flag is null) return NotFound();

        flag.ReviewStatus = PhotoReuseReviewStatus.Acknowledged;
        flag.ReviewedByStaffId = me.Id;
        flag.ReviewedAt = DateTime.UtcNow;
        realtime.PhotoReuseFlagged(flag.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);
        return NoContent();
    }

    /// <summary>Marks the match a false positive — a coincidence or a legitimately resubmitted photo.</summary>
    [HttpPost("{id:guid}/dismiss")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Dismiss(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var flag = await db.PhotoReuseFlags.FirstOrDefaultAsync(f => f.Id == id, ct);
        if (flag is null) return NotFound();

        flag.ReviewStatus = PhotoReuseReviewStatus.Dismissed;
        flag.ReviewedByStaffId = me.Id;
        flag.ReviewedAt = DateTime.UtcNow;
        realtime.PhotoReuseFlagged(flag.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        logger.LogInformation("Staff {Staff} dismissed photo-reuse flag {FlagId}", me.FullName, flag.Id);
        return NoContent();
    }
}
