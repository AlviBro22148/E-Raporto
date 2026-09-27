using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using E_RaportoBackend.Services.Ai;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// The systemic-pattern review queue — the root-cause counterpart to <see cref="DuplicatesController"/>.
/// A cluster is never merged; a supervisor sees the AI's read of it (or the raw member list, if the AI
/// never ran) and decides whether it is worth acting on as one investigation or dismissing as noise.
/// </summary>
[ApiController]
[Route("api/v1/staff/patterns")]
[Authorize]
[Tags("Staff — systemic patterns")]
public class PatternsController(
    AppDbContext db, IPatternSynthesizer synthesizer, IRealtimeBroadcaster realtime,
    ILogger<PatternsController> logger) : ControllerBase
{
    /// <summary>Open patterns (Pending or Acknowledged), most recently active first.</summary>
    [HttpGet]
    [ProducesResponseType<List<SystemicPatternDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<SystemicPatternDto>>> List(CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var patterns = await FullPatterns()
            .Where(p => p.ReviewStatus != PatternReviewStatus.Dismissed)
            .OrderByDescending(p => p.LastReportAt)
            .Take(100)
            .ToListAsync(ct);

        return Ok(patterns.Select(p => p.ToDto()).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType<SystemicPatternDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<SystemicPatternDto>> GetById(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var pattern = await FullPatterns().FirstOrDefaultAsync(p => p.Id == id, ct);
        return pattern is null ? NotFound() : Ok(pattern.ToDto());
    }

    /// <summary>Confirms the pattern is real and worth acting on. Does not change any member report —
    /// acting on it (assigning an inspection, changing status) is done on the reports themselves.</summary>
    [HttpPost("{id:guid}/acknowledge")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Acknowledge(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var pattern = await db.SystemicPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern is null) return NotFound();

        pattern.ReviewStatus = PatternReviewStatus.Acknowledged;
        pattern.ReviewedByStaffId = me.Id;
        pattern.ReviewedAt = DateTime.UtcNow;
        realtime.PatternChanged(pattern.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// Marks the pattern a false positive. Each member report's status, history and visibility are left
    /// exactly as they were — dismissing the pattern is a statement about the grouping, never about the
    /// individual reports inside it, each of which is still a real case someone still has to close.
    /// </summary>
    /// <remarks>
    /// The one thing this DOES change on the members is clearing <c>SystemicPatternId</c> back to null.
    /// That is not incidental — it is what makes <see cref="SystemicPatternDetectionService.FindOpenNearbyPatternAsync"/>'s
    /// "never rejoin a dismissed pattern" promise actually mean something. Without it, these reports
    /// would stay permanently excluded from the "unclustered nearby reports" count a future submission
    /// evaluates, and a genuinely recurring problem in the same spot could never form a fresh pattern —
    /// it would simply vanish the moment this one wrong call was made.
    /// </remarks>
    [HttpPost("{id:guid}/dismiss")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Dismiss(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var pattern = await db.SystemicPatterns
            .Include(p => p.Members)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern is null) return NotFound();

        pattern.ReviewStatus = PatternReviewStatus.Dismissed;
        pattern.ReviewedByStaffId = me.Id;
        pattern.ReviewedAt = DateTime.UtcNow;
        foreach (var member in pattern.Members) member.SystemicPatternId = null;
        realtime.PatternChanged(pattern.Id, RealtimeActions.Reviewed);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        logger.LogInformation("Staff {Staff} dismissed systemic pattern {PatternId} ({Count} members released)",
            me.FullName, pattern.Id, pattern.Members.Count);
        return NoContent();
    }

    /// <summary>
    /// Re-runs the AI synthesis against the pattern's current membership. Manual, never automatic — a
    /// pattern that quietly grows from 4 to 5 members does not need a fresh model call on every join;
    /// staff decide when the summary is stale enough to be worth the cost of asking again.
    /// </summary>
    [HttpPost("{id:guid}/refresh")]
    [ProducesResponseType<SystemicPatternDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<SystemicPatternDto>> Refresh(Guid id, CancellationToken ct)
    {
        var me = await this.CurrentStaffAsync(db, ct);
        if (me is null) return Unauthorized();

        var pattern = await FullPatterns().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern is null) return NotFound();

        var verdict = await synthesizer.SynthesizeAsync(new PatternSynthesisRequest(
            pattern.Category!.NameSq,
            pattern.Members.Select(r => new PatternMemberInfo(
                r.PublicRef, r.Title, r.Description, r.AddressText, r.CreatedAt)).ToList()), ct);

        if (verdict is not null)
        {
            pattern.AiSummarySq = verdict.SummarySq;
            pattern.AiConnectionType = verdict.ConnectionType;
            pattern.AiConfidence = verdict.Confidence;
            pattern.AiModel = verdict.Model;
        }

        realtime.PatternChanged(pattern.Id, RealtimeActions.Updated);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);
        return Ok(pattern.ToDto());
    }

    private IQueryable<SystemicPattern> FullPatterns() => db.SystemicPatterns
        .Include(p => p.Category)
        .Include(p => p.Department)
        .Include(p => p.Members);
}
