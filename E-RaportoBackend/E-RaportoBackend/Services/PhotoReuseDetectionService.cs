using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace E_RaportoBackend.Services;

/// <summary>
/// Flags a photo that perceptually matches one already used on a different report — the same picture,
/// or a lightly-edited copy of it (resized, recompressed, colour-adjusted), reused across two reports.
///
/// Deliberately NOT an attempt at "is this photo AI-generated" — that stays out of scope for the reason
/// stated everywhere else honesty matters in this app: no current model does that reliably, and claiming
/// otherwise would be the one dishonest capability in a product built around calibrated, explainable AI.
/// This instead catches the far more common real version of photo fraud — recycling a stock image, or
/// reusing an old "before" photo to claim a since-fixed problem is still broken — with a technique that
/// is deterministic, cheap, and fully explainable: a perceptual hash, not a model call.
///
/// Entirely infrastructure-free by the same design choice <see cref="DuplicateDetectionService"/> already
/// made for text: no vector index, no external service. At the report volume this app is built for, a
/// full in-memory comparison against every existing hash is microseconds of work; a real high-volume
/// pilot would want an indexed nearest-neighbour structure instead, same honest caveat as the text side.
/// </summary>
public class PhotoReuseDetectionService(AppDbContext db, ILogger<PhotoReuseDetectionService> logger)
{
    /// <summary>
    /// Hamming distance, out of 64 bits, at or below which two dHashes are treated as "the same or a
    /// lightly-edited copy of the same picture". dHash's own literature puts unrelated photos at roughly
    /// 30+ bits different on average and a resize/recompress/minor-crop of the same photo at single
    /// digits — 6 sits well inside that gap, tuned toward not missing a real reuse over never producing
    /// a false one, since a false positive here only ever opens a staff review, never blocks anything.
    /// </summary>
    public const int MatchThreshold = 6;

    /// <summary>
    /// Computes a difference hash (dHash) of an image's visual content. Resizes to a fixed 9x8 — 9
    /// columns produce 8 left-to-right brightness comparisons per row, 8 rows of them is 64 bits — so
    /// the result is comparable across photos of any original size or format. Returns null rather than
    /// throwing: a file the JPEG encoder already accepted but this can't decode is not a reason to fail
    /// the report, only a reason this one photo doesn't get compared.
    /// </summary>
    public static long? ComputeHash(byte[] imageBytes, ILogger? logger = null)
    {
        try
        {
            using var image = Image.Load<Rgba32>(imageBytes);
            image.Mutate(x => x.Resize(9, 8).Grayscale());

            long hash = 0;
            var bit = 0;
            for (var y = 0; y < 8; y++)
            {
                for (var x = 0; x < 8; x++)
                {
                    // After Grayscale(), R/G/B are equal — R alone is the pixel's luminance.
                    var left = image[x, y].R;
                    var right = image[x + 1, y].R;
                    if (left > right) hash |= 1L << bit;
                    bit++;
                }
            }
            return hash;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "Could not compute a perceptual hash for an uploaded photo.");
            return null;
        }
    }

    /// <summary>Bits differing between two hashes — the whole "score", shown to staff exactly as-is.</summary>
    public static int HammingDistance(long a, long b) => System.Numerics.BitOperations.PopCount((ulong)(a ^ b));

    /// <summary>
    /// Compares this report's already-hashed photos against every other report's hashed photos and
    /// queues a <see cref="FraudFlag"/> (<see cref="FraudFlagKind.PhotoReuse"/>) for the first match found
    /// per photo. Does not call SaveChanges — the caller (<see cref="ReportTriageService"/>) owns the
    /// transaction, exactly like <see cref="DuplicateDetectionService"/> and
    /// <see cref="SystemicPatternDetectionService"/> do.
    /// </summary>
    public async Task<List<FraudFlag>> ScanAsync(Report report, CancellationToken ct = default)
    {
        var ownHashes = report.Photos
            .Where(p => p.PerceptualHash is not null)
            .Select(p => p.PerceptualHash!.Value)
            .ToList();
        if (ownHashes.Count == 0) return [];

        var existing = await db.ReportPhotos.AsNoTracking()
            .Where(p => p.ReportId != report.Id && p.PerceptualHash != null)
            .Select(p => new { p.ReportId, Hash = p.PerceptualHash!.Value })
            .ToListAsync(ct);
        if (existing.Count == 0) return [];

        var flags = new List<FraudFlag>();
        var alreadyFlaggedReports = new HashSet<Guid>();

        foreach (var ownHash in ownHashes)
        {
            // One flag per matched report is enough signal — if three of this report's photos all
            // happen to match the same other report, that is still one thing for staff to look at, not
            // three identical cards.
            var match = existing
                .Select(e => (e.ReportId, Distance: HammingDistance(ownHash, e.Hash)))
                .Where(m => m.Distance <= MatchThreshold && !alreadyFlaggedReports.Contains(m.ReportId))
                .OrderBy(m => m.Distance)
                .FirstOrDefault();

            if (match == default) continue;

            alreadyFlaggedReports.Add(match.ReportId);
            flags.Add(new FraudFlag
            {
                ReportId = report.Id,
                RelatedReportId = match.ReportId,
                Kind = FraudFlagKind.PhotoReuse,
                Score = match.Distance,
                Reasoning = match.Distance == 0
                    ? "Fotoja është identike me një foto të përdorur tashmë në një raport tjetër."
                    : $"Fotoja përputhet {match.Distance} bit nga 64 me një foto të përdorur tashmë " +
                      "në një raport tjetër — ndoshta e njëjta foto, e ripërpunuar lehtë.",
            });
        }

        if (flags.Count > 0)
        {
            logger.LogInformation("Report {Ref}: {Count} photo-reuse match(es) found",
                report.PublicRef, flags.Count);
        }

        return flags;
    }
}
