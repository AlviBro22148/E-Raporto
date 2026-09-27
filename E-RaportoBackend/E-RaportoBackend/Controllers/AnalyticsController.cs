using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// Operational analytics for the municipality: volume, response times, SLA pressure, and — the metric
/// we care most about defending in the pitch — how often staff had to override the AI.
/// </summary>
[ApiController]
[Route("api/v1/staff/analytics")]
[Authorize]
[Tags("Staff — analytics")]
public class AnalyticsController(AppDbContext db) : ControllerBase
{
    [HttpGet("summary")]
    [ProducesResponseType<AnalyticsSummaryDto>(StatusCodes.Status200OK)]
    public async Task<ActionResult<AnalyticsSummaryDto>> Summary(CancellationToken ct)
    {
        // Merged reports would double-count the same real-world problem in every figure below.
        var reports = await db.Reports.AsNoTracking()
            .Include(r => r.Category)
            .Include(r => r.Department)
            .Where(r => r.Status != ReportStatus.Merged)
            .ToListAsync(ct);

        var resolved = reports.Where(r => r.Status == ReportStatus.Resolved && r.ResolvedAt is not null).ToList();
        var acknowledged = reports.Where(r => r.AcknowledgedAt is not null).ToList();

        double? avgAck = acknowledged.Count == 0
            ? null
            : Math.Round(acknowledged.Average(r => (r.AcknowledgedAt!.Value - r.CreatedAt).TotalHours), 1);

        double? avgResolve = resolved.Count == 0
            ? null
            : Math.Round(resolved.Average(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalHours), 1);

        var openStatuses = new[]
        {
            ReportStatus.Submitted, ReportStatus.InReview, ReportStatus.Assigned, ReportStatus.InProgress
        };

        var slaBreaches = reports.Count(r => r.IsSlaBreached());

        // AI agreement: of everything the classifier categorised, how much did a human leave alone?
        // A proxy, not ground truth — and we say so in the pitch rather than calling it "accuracy".
        var classified = reports.Where(r => r.ClassificationSource != ClassificationSource.Manual || r.IsCategoryOverridden).ToList();
        var overridden = reports.Count(r => r.IsCategoryOverridden);
        double? agreement = classified.Count == 0
            ? null
            : Math.Round(1.0 - (overridden / (double)classified.Count), 3);

        // Group by id, not by the navigation object: AsNoTracking() materialises a separate Category
        // instance per row, so grouping on the reference yields one group per report.
        var byCategory = reports
            .Where(r => r.Category is not null)
            .GroupBy(r => r.Category!.Id)
            .Select(g =>
            {
                var category = g.First().Category!;
                var done = g.Where(r => r.ResolvedAt is not null).ToList();
                return new CategoryStatDto(
                    category.Code, category.NameSq, category.NameEn, category.ColorHex, g.Count(),
                    done.Count == 0
                        ? null
                        : Math.Round(done.Average(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalHours), 1));
            })
            .OrderByDescending(s => s.Count)
            .ToList();

        var byStatus = reports
            .GroupBy(r => r.Status)
            .Select(g => new StatusStatDto(g.Key.ToString(), g.Count()))
            .OrderByDescending(s => s.Count)
            .ToList();

        var byDepartment = reports
            .Where(r => r.Department is not null)
            .GroupBy(r => r.Department!.Id)
            .Select(g =>
            {
                var department = g.First().Department!;
                var done = g.Where(r => r.ResolvedAt is not null).ToList();
                return new DepartmentStatDto(
                    department.Id, department.ShortName,
                    g.Count(r => openStatuses.Contains(r.Status)),
                    g.Count(r => r.Status == ReportStatus.Resolved),
                    g.Count(r => r.IsSlaBreached()),
                    done.Count == 0
                        ? null
                        : Math.Round(done.Average(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalHours), 1));
            })
            .OrderByDescending(s => s.Open + s.Resolved)
            .ToList();

        // Citizen-verified resolution. Measured against every resolved report, not against the citizens
        // who replied: silence is unverified, deliberately. A rate over respondents would improve by
        // asking fewer people, which is the opposite of what this is for. The gap between
        // ResolvedReports and VerificationsConfirmed is the honest thing on this page.
        var currentOutcomes = await db.CurrentVerificationOutcomesAsync(resolved, ct);
        var verificationsConfirmed = currentOutcomes.Count(o => o.Value == nameof(VerificationOutcome.Confirmed));
        var verificationsDisputed = currentOutcomes.Count(o => o.Value == nameof(VerificationOutcome.Disputed));

        double? verifiedRate = resolved.Count == 0
            ? null
            : Math.Round(verificationsConfirmed / (double)resolved.Count, 3);

        var duplicatesMerged = await db.Reports.CountAsync(r => r.Status == ReportStatus.Merged, ct);
        var pendingDuplicates = await db.DuplicateCandidates
            .CountAsync(c => c.ReviewStatus == DuplicateReviewStatus.Pending, ct);
        var openPatterns = await db.SystemicPatterns
            .CountAsync(p => p.ReviewStatus != PatternReviewStatus.Dismissed, ct);
        var pendingPhotoReuse = await db.PhotoReuseFlags
            .CountAsync(f => f.ReviewStatus == PhotoReuseReviewStatus.Pending, ct);

        return Ok(new AnalyticsSummaryDto(
            TotalReports: reports.Count,
            OpenReports: reports.Count(r => openStatuses.Contains(r.Status)),
            ResolvedReports: resolved.Count,
            AvgHoursToAcknowledge: avgAck,
            AvgHoursToResolution: avgResolve,
            SlaBreachCount: slaBreaches,
            DuplicatesMerged: duplicatesMerged,
            PendingDuplicateReviews: pendingDuplicates,
            AiAgreementRate: agreement,
            AiClassifiedCount: classified.Count,
            AiOverriddenCount: overridden,
            ByCategory: byCategory,
            ByStatus: byStatus,
            ByDepartment: byDepartment,
            VerificationsConfirmed: verificationsConfirmed,
            VerificationsDisputed: verificationsDisputed,
            VerificationsAwaiting: resolved.Count - currentOutcomes.Count,
            CitizenVerifiedRate: verifiedRate,
            OpenSystemicPatterns: openPatterns,
            PendingPhotoReuseReviews: pendingPhotoReuse));
    }

    /// <summary>Daily submitted-vs-resolved counts. Zero-filled so the chart has no gaps.</summary>
    [HttpGet("trend")]
    [ProducesResponseType<List<TrendPointDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<TrendPointDto>>> Trend([FromQuery] int days = 30, CancellationToken ct = default)
    {
        days = Math.Clamp(days, 7, 180);
        var since = DateTime.UtcNow.Date.AddDays(-days + 1);

        var reports = await db.Reports.AsNoTracking()
            .Where(r => r.Status != ReportStatus.Merged && (r.CreatedAt >= since || r.ResolvedAt >= since))
            .Select(r => new { r.CreatedAt, r.ResolvedAt })
            .ToListAsync(ct);

        var submitted = reports
            .Where(r => r.CreatedAt >= since)
            .GroupBy(r => DateOnly.FromDateTime(r.CreatedAt.Date))
            .ToDictionary(g => g.Key, g => g.Count());

        var resolved = reports
            .Where(r => r.ResolvedAt is not null && r.ResolvedAt >= since)
            .GroupBy(r => DateOnly.FromDateTime(r.ResolvedAt!.Value.Date))
            .ToDictionary(g => g.Key, g => g.Count());

        var points = Enumerable.Range(0, days)
            .Select(offset =>
            {
                var date = DateOnly.FromDateTime(since.AddDays(offset));
                return new TrendPointDto(date, submitted.GetValueOrDefault(date), resolved.GetValueOrDefault(date));
            })
            .ToList();

        return Ok(points);
    }
}
