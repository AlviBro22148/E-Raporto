using E_RaportoBackend.Domain;
using Microsoft.Extensions.Caching.Memory;

namespace E_RaportoBackend.Services;

/// <summary>
/// The one fraud check in this app that isn't AI and isn't a hash — just two coordinate pairs and the
/// same Haversine math <see cref="DuplicateDetectionService"/> and the municipality boundary check
/// already use. A photo's own embedded GPS, read once at upload time before
/// <see cref="LocalPhotoStorage"/> strips it, says where the phone actually was when the shutter fired;
/// comparing that to the pin the citizen placed catches a photo that wasn't taken at the claimed scene —
/// an old photo, or one grabbed from somewhere else.
///
/// Coverage is deliberately expected to be low: most phones don't tag photos with location any more, and
/// anything that passed through another app first (a gallery pick, a forward) usually already lost it. A
/// miss here proves nothing — it only ever means there was nothing to check. Only a real mismatch, when
/// the data exists, is worth a clerk's time.
/// </summary>
public class GpsMismatchService(IMemoryCache cache, ILogger<GpsMismatchService> logger)
{
    /// <summary>
    /// Generous on purpose. This has to tolerate someone photographing a problem from across the street,
    /// or from a moving car — normal GPS behaviour, not a red flag. It's only meant to catch a photo
    /// that plainly wasn't taken anywhere near the claimed scene.
    /// </summary>
    public const double MismatchThresholdMeters = 750;

    public List<FraudFlag> Evaluate(Report report)
    {
        var flags = new List<FraudFlag>();

        foreach (var photo in report.Photos)
        {
            if (!cache.TryGetValue(LocalPhotoStorage.GpsCacheKey(photo.Url), out (double Lat, double Lng) gps))
                continue;

            var distance = DuplicateDetectionService.HaversineMeters(
                report.Latitude, report.Longitude, gps.Lat, gps.Lng);

            if (distance <= MismatchThresholdMeters) continue;

            flags.Add(new FraudFlag
            {
                ReportId = report.Id,
                Kind = FraudFlagKind.GpsMismatch,
                Score = Math.Round(distance, 0),
                Reasoning = $"Vendndodhja e regjistruar te fotoja është {Math.Round(distance):N0} metra " +
                            "larg pikës së shënuar në hartë — fotoja mund të mos jetë bërë në vendngjarje.",
            });
        }

        if (flags.Count > 0)
        {
            logger.LogInformation("Report {Ref}: {Count} GPS-mismatch flag(s) found",
                report.PublicRef, flags.Count);
        }

        return flags;
    }
}
