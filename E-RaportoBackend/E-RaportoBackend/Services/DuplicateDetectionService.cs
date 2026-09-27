using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Services.Ai;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Services;

public class DuplicateDetectionOptions
{
    public const string SectionName = "DuplicateDetection";

    /// <summary>Nothing further away than this is ever considered. Tuned against the Elbasan seed data.</summary>
    public double SearchRadiusMeters { get; set; } = 150;
    /// <summary>Reports older than this are assumed to be a genuinely separate incident.</summary>
    public int LookbackDays { get; set; } = 45;
    /// <summary>Below this combined score we don't bother the citizen or the clerk.</summary>
    public double MinScore { get; set; } = 0.45;
    public int MaxCandidates { get; set; } = 3;
}

/// <summary>
/// Geo-distance + text-similarity duplicate scanner.
///
/// Deliberately explainable rather than clever: haversine distance, Albanian-normalised token overlap,
/// and a same-category boost. A clerk can read the score breakdown and understand why two reports were
/// linked — which matters far more on stage than the marginal accuracy of an embedding model, and needs
/// no extra infrastructure. Embeddings are the named post-hackathon upgrade.
/// </summary>
public class DuplicateDetectionService(
    AppDbContext db,
    Microsoft.Extensions.Options.IOptions<DuplicateDetectionOptions> options,
    ILogger<DuplicateDetectionService> logger)
{
    private readonly DuplicateDetectionOptions _opt = options.Value;

    private static readonly HashSet<string> StopWords = new(StringComparer.Ordinal)
    {
        "dhe", "ne", "te", "me", "per", "nga", "nje", "eshte", "ka", "ku", "qe", "si", "kjo", "kete",
        "shume", "shum", "ketu", "aty", "duhet", "lutem", "faleminderit", "the", "and", "a", "an",
        "is", "in", "on", "at", "of", "to", "for", "this", "that", "there", "very", "please", "it"
    };

    /// <summary>
    /// Scores <paramref name="report"/> against nearby open reports and persists the candidates.
    /// The new report is never modified — a duplicate is a suggestion, not an automatic merge.
    /// </summary>
    public async Task<List<DuplicateCandidate>> ScanAsync(Report report, CancellationToken ct = default)
    {
        var since = DateTime.UtcNow.AddDays(-_opt.LookbackDays);

        // Bounding box first so Postgres uses the (latitude, longitude) index; exact haversine after.
        var latDelta = _opt.SearchRadiusMeters / 111_320.0;
        var lngDelta = _opt.SearchRadiusMeters /
                       (111_320.0 * Math.Max(Math.Cos(report.Latitude * Math.PI / 180.0), 0.01));

        var nearby = await db.Reports
            .AsNoTracking()
            .Where(r => r.Id != report.Id
                        && r.MunicipalityId == report.MunicipalityId
                        && r.MergedIntoReportId == null
                        && r.Status != ReportStatus.Merged
                        && r.Status != ReportStatus.Rejected
                        && r.Status != ReportStatus.Resolved
                        && r.CreatedAt >= since
                        && r.Latitude >= report.Latitude - latDelta
                        && r.Latitude <= report.Latitude + latDelta
                        && r.Longitude >= report.Longitude - lngDelta
                        && r.Longitude <= report.Longitude + lngDelta)
            .Select(r => new
            {
                r.Id, r.Latitude, r.Longitude, r.Title, r.Description, r.CategoryId, r.CreatedAt
            })
            .ToListAsync(ct);

        var reportTokens = Tokenize($"{report.Title} {report.Description}");
        var scored = new List<DuplicateCandidate>();

        foreach (var other in nearby)
        {
            var distance = HaversineMeters(report.Latitude, report.Longitude, other.Latitude, other.Longitude);
            if (distance > _opt.SearchRadiusMeters) continue;

            // Proximity decays linearly to zero at the search radius — 10m apart is a much stronger
            // signal than 140m apart, and a flat "within radius" boolean would lose that.
            var proximity = 1.0 - (distance / _opt.SearchRadiusMeters);
            var textSimilarity = JaccardSimilarity(reportTokens, Tokenize($"{other.Title} {other.Description}"));
            var sameCategory = report.CategoryId is not null && report.CategoryId == other.CategoryId;

            // Geography carries the most weight: two people describing the same pothole rarely use the
            // same words, but they always stand in the same place.
            var score = (proximity * 0.55) + (textSimilarity * 0.30) + (sameCategory ? 0.15 : 0.0);
            score = Math.Round(Math.Clamp(score, 0, 1), 3);

            if (score < _opt.MinScore) continue;

            scored.Add(new DuplicateCandidate
            {
                ReportId = report.Id,
                CandidateReportId = other.Id,
                DistanceMeters = Math.Round(distance, 1),
                TextSimilarity = Math.Round(textSimilarity, 3),
                Score = score,
                Method = sameCategory ? "geo+tokens+same-category" : "geo+tokens",
                ReviewStatus = DuplicateReviewStatus.Pending
            });
        }

        var top = scored.OrderByDescending(c => c.Score).Take(_opt.MaxCandidates).ToList();
        if (top.Count > 0)
        {
            db.DuplicateCandidates.AddRange(top);
            logger.LogInformation("Found {Count} duplicate candidate(s) for report {Ref}, best score {Score}",
                top.Count, report.PublicRef, top[0].Score);
        }

        return top;
    }

    /// <summary>Great-circle distance in metres.</summary>
    public static double HaversineMeters(double lat1, double lng1, double lat2, double lng2)
    {
        const double earthRadiusM = 6_371_000;
        var dLat = (lat2 - lat1) * Math.PI / 180.0;
        var dLng = (lng2 - lng1) * Math.PI / 180.0;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180.0) * Math.Cos(lat2 * Math.PI / 180.0) *
                Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return earthRadiusM * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    /// <summary>Diacritic-insensitive word set, minus stop words and very short tokens.</summary>
    private static HashSet<string> Tokenize(string text)
    {
        var normalized = RuleBasedReportClassifier.Normalize(text);
        var tokens = normalized.Split(
            [' ', '\t', '\n', '\r', ',', '.', ';', ':', '!', '?', '(', ')', '"', '\'', '-', '/'],
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        return tokens.Where(t => t.Length > 2 && !StopWords.Contains(t)).ToHashSet(StringComparer.Ordinal);
    }

    private static double JaccardSimilarity(HashSet<string> a, HashSet<string> b)
    {
        if (a.Count == 0 || b.Count == 0) return 0;
        var intersection = a.Count(b.Contains);
        var union = a.Count + b.Count - intersection;
        return union == 0 ? 0 : intersection / (double)union;
    }
}
