using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Services.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace E_RaportoBackend.Services;

public class SystemicPatternOptions
{
    public const string SectionName = "SystemicPattern";

    /// <summary>Wider than <see cref="DuplicateDetectionOptions.SearchRadiusMeters"/> on purpose — this
    /// is looking for a shared underlying cause, not the same physical incident, so it has to see past
    /// a single street corner.</summary>
    public double SearchRadiusMeters { get; set; } = 400;

    /// <summary>Wider than duplicate detection's lookback too — a systemic condition can take months to
    /// show up as a repeated pattern, not days.</summary>
    public int LookbackDays { get; set; } = 120;

    /// <summary>Including the triggering report itself. Tuned down for Elbasan's current real volume
    /// (a handful of reports a week, not a day) — a real municipality at scale would likely raise this.</summary>
    public int MinMembersToDetect { get; set; } = 3;
}

/// <summary>
/// Looks past the single report in front of it and asks whether several different reports, taken
/// together, describe something bigger — the root-cause detector.
///
/// Two-stage by design, and the staging is the cost control: <see cref="EvaluateAsync"/> runs a cheap,
/// deterministic count on essentially every submission, and the expensive AI synthesis
/// (<see cref="IPatternSynthesizer"/>) is only ever reached once that count has already crossed a real
/// threshold. Most reports never get near the AI call this class owns.
/// </summary>
public class SystemicPatternDetectionService(
    AppDbContext db,
    IPatternSynthesizer synthesizer,
    IOptions<SystemicPatternOptions> options,
    ILogger<SystemicPatternDetectionService> logger)
{
    private readonly SystemicPatternOptions _opt = options.Value;

    /// <param name="report">The newly submitted report. Must already be tracked by <paramref name="db"/>
    /// (added, not yet saved) — this method mutates it and any pattern members it finds, but never calls
    /// SaveChanges itself; the caller's transaction owns that, same convention as
    /// <see cref="DuplicateDetectionService.ScanAsync"/>.</param>
    /// <param name="category">Passed in rather than read off <c>report.Category</c>, which is not yet
    /// loaded at the point <see cref="ReportTriageService"/> calls this.</param>
    public async Task<SystemicPattern?> EvaluateAsync(Report report, Category category, CancellationToken ct = default)
    {
        // Step 0 — does this report belong to an existing open pattern already, rather than needing a
        // new one? Checked first, and cheap: at most a handful of open patterns per category exist at
        // once. Deliberately excludes Dismissed patterns — see FindOpenNearbyPatternAsync.
        var existing = await FindOpenNearbyPatternAsync(report, ct);
        if (existing is not null)
        {
            report.SystemicPatternId = existing.Id;
            existing.MemberCount++;
            existing.LastReportAt = report.CreatedAt;
            logger.LogInformation("Report {Ref} joined existing systemic pattern {PatternId} ({Count} members)",
                report.PublicRef, existing.Id, existing.MemberCount);
            return existing;
        }

        // Step 1 — the cheap, deterministic count. No AI touched yet.
        var since = DateTime.UtcNow.AddDays(-_opt.LookbackDays);
        var latDelta = _opt.SearchRadiusMeters / 111_320.0;
        var lngDelta = _opt.SearchRadiusMeters /
                       (111_320.0 * Math.Max(Math.Cos(report.Latitude * Math.PI / 180.0), 0.01));

        // Tracked, not AsNoTracking: if a pattern forms below, these are the entities that get their
        // SystemicPatternId set and saved along with everything else in the caller's SaveChangesAsync.
        //
        // Resolved reports are deliberately included here, unlike DuplicateDetectionService's scan —
        // "we already fixed this same kind of thing three times in this street" is exactly the evidence
        // a systemic pattern exists to surface, not noise to exclude. Only Merged (absorbed elsewhere)
        // and Rejected (never a real issue) reports are excluded.
        var nearby = await db.Reports
            .Where(r => r.Id != report.Id
                        && r.MunicipalityId == report.MunicipalityId
                        && r.CategoryId == report.CategoryId
                        && r.SystemicPatternId == null
                        && r.MergedIntoReportId == null
                        && r.Status != ReportStatus.Merged
                        && r.Status != ReportStatus.Rejected
                        && r.CreatedAt >= since
                        && r.Latitude >= report.Latitude - latDelta && r.Latitude <= report.Latitude + latDelta
                        && r.Longitude >= report.Longitude - lngDelta && r.Longitude <= report.Longitude + lngDelta)
            .ToListAsync(ct);

        var withinRadius = nearby
            .Where(r => DuplicateDetectionService.HaversineMeters(
                report.Latitude, report.Longitude, r.Latitude, r.Longitude) <= _opt.SearchRadiusMeters)
            .ToList();

        // +1 counts the triggering report itself. This is the branch almost every submission takes.
        if (withinRadius.Count + 1 < _opt.MinMembersToDetect) return null;

        // Step 2 — the threshold was crossed. Only now does an AI call happen.
        var allMembers = new List<Report> { report };
        allMembers.AddRange(withinRadius);

        var verdict = await synthesizer.SynthesizeAsync(new Ai.PatternSynthesisRequest(
            category.NameSq,
            allMembers.Select(r => new Ai.PatternMemberInfo(
                r.PublicRef, r.Title, r.Description, r.AddressText, r.CreatedAt)).ToList()), ct);

        var pattern = new SystemicPattern
        {
            MunicipalityId = report.MunicipalityId,
            CategoryId = category.Id,
            // The report's own effective department, not the category's default — by the time this
            // runs, report.DepartmentId already reflects any routing already applied to it this request.
            DepartmentId = report.DepartmentId,
            CentroidLat = allMembers.Average(r => r.Latitude),
            CentroidLng = allMembers.Average(r => r.Longitude),
            MemberCount = allMembers.Count,
            AiSummarySq = verdict?.SummarySq,
            AiConnectionType = verdict?.ConnectionType,
            AiConfidence = verdict?.Confidence,
            AiModel = verdict?.Model,
            LastReportAt = allMembers.Max(r => r.CreatedAt)
        };

        db.SystemicPatterns.Add(pattern);
        foreach (var member in allMembers) member.SystemicPatternId = pattern.Id;

        logger.LogInformation(
            "Systemic pattern detected: {Count} reports, category {Category}, type {Type}",
            pattern.MemberCount, category.Code, pattern.AiConnectionType?.ToString() ?? "(no synthesis)");

        return pattern;
    }

    /// <summary>
    /// An open pattern, same category, whose centroid is within the search radius of this report —
    /// checked only against <see cref="PatternReviewStatus.Pending"/> or
    /// <see cref="PatternReviewStatus.Acknowledged"/> patterns, never <see cref="PatternReviewStatus.Dismissed"/>
    /// ones.
    ///
    /// That exclusion is deliberate and load-bearing: if staff dismissed a pattern as a false positive,
    /// a dismissed pattern must not go on silently absorbing every new nearby report forever — that
    /// would turn one wrong call into a permanent blind spot. Letting a fresh pattern form instead means
    /// a genuinely recurring problem gets looked at with new eyes rather than disappearing into a
    /// decision nobody will revisit.
    /// </summary>
    private async Task<SystemicPattern?> FindOpenNearbyPatternAsync(Report report, CancellationToken ct)
    {
        var candidates = await db.SystemicPatterns
            .Where(p => p.MunicipalityId == report.MunicipalityId
                        && p.CategoryId == report.CategoryId
                        && p.ReviewStatus != PatternReviewStatus.Dismissed)
            .ToListAsync(ct);

        return candidates.FirstOrDefault(p => DuplicateDetectionService.HaversineMeters(
            report.Latitude, report.Longitude, p.CentroidLat, p.CentroidLng) <= _opt.SearchRadiusMeters);
    }
}
