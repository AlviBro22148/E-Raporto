using Microsoft.Extensions.Caching.Memory;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;

namespace E_RaportoBackend.Services;

public record StoredPhoto(string Url, string StoragePath, long SizeBytes);

/// <summary>
/// Abstraction over photo persistence. Local disk today so the hackathon needs no cloud account;
/// swapping in S3 / Azure Blob for a real pilot is a single implementation, not a refactor.
/// </summary>
public interface IPhotoStorage
{
    Task<StoredPhoto> SaveAsync(Stream content, string originalFileName, string contentType, CancellationToken ct = default);

    /// <summary>
    /// Reads back a previously-stored photo by the URL <see cref="SaveAsync"/> returned. Used to hand
    /// the raw bytes to the AI classifier — returns null for anything that isn't one of our own
    /// uploads (wrong prefix, path traversal attempt, or the file no longer exists).
    /// </summary>
    Task<(byte[] Data, string ContentType)?> ReadAsync(string url, CancellationToken ct = default);
}

public class LocalPhotoStorage(
    IWebHostEnvironment env, IMemoryCache cache, ILogger<LocalPhotoStorage> logger) : IPhotoStorage
{
    private const string GpsCacheKeyPrefix = "photo-gps:";

    /// <summary>The cache key a photo's GPS (if any) is stored under — shared with
    /// <see cref="GpsMismatchService"/>, which reads what this class writes here.</summary>
    public static string GpsCacheKey(string photoUrl) => GpsCacheKeyPrefix + photoUrl;

    private static readonly MemoryCacheEntryOptions GpsCacheOptions =
        new() { SlidingExpiration = TimeSpan.FromHours(2) };
    /// <summary>
    /// Stores an uploaded photo, re-encoded and stripped of its metadata.
    /// </summary>
    /// <remarks>
    /// The re-encode is not about file size — it is the second half of this system's anonymity, and
    /// without it the first half is decoration.
    ///
    /// A photo straight off a phone carries EXIF: the GPS coordinates where the shutter fired, the
    /// device model, and the exact local timestamp. A clerk who cannot see the reporter's name can
    /// still download the attached image and read the coordinates — which, for someone photographing
    /// the pothole outside their own gate, is their home address. Removing the name while leaving that
    /// in place would have been a promise the product could not keep.
    ///
    /// Decoding into pixels and re-encoding drops every metadata block: there is nothing to filter or
    /// forget, because the output is built from image data alone. The report keeps its own coordinates
    /// — the ones the citizen deliberately confirmed on the map — which is the location the
    /// municipality actually needs.
    /// </remarks>
    public async Task<StoredPhoto> SaveAsync(
        Stream content, string originalFileName, string contentType, CancellationToken ct = default)
    {
        // Date-partitioned so the uploads folder stays navigable after a busy pilot month.
        var now = DateTime.UtcNow;
        var relativeDir = Path.Combine("uploads", now.ToString("yyyy"), now.ToString("MM"));
        var absoluteDir = Path.Combine(env.WebRootPath, relativeDir);
        Directory.CreateDirectory(absoluteDir);

        // Generated name: the client never controls the path on disk. Always .jpg — whatever came in
        // (HEIC from an iPhone, WebP, PNG) leaves as one format, so nothing downstream has to reason
        // about a container that might still be carrying metadata.
        var fileName = $"{Guid.NewGuid():N}.jpg";
        var absolutePath = Path.Combine(absoluteDir, fileName);

        // Buffered first: ImageSharp needs a seekable stream, and the request body is not one.
        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, ct);
        buffer.Position = 0;

        var url = $"/{relativeDir.Replace(Path.DirectorySeparatorChar, '/')}/{fileName}";

        try
        {
            using var image = await Image.LoadAsync(buffer, ct);

            // The one legitimate read of this photo's real GPS — everywhere else in this class exists to
            // make sure nobody ever gets another chance at it. Read before the strip below, cached under
            // the URL this method is about to hand back, never returned to any caller.
            var gps = TryReadGpsCoordinates(image.Metadata.ExifProfile);
            if (gps is { } coords)
                cache.Set(GpsCacheKey(url), coords, GpsCacheOptions);

            // Belt and braces. Re-encoding already drops metadata, but clearing it explicitly means a
            // future change of encoder cannot quietly start preserving it again.
            image.Metadata.ExifProfile = null;
            image.Metadata.XmpProfile = null;
            image.Metadata.IptcProfile = null;

            await image.SaveAsJpegAsync(absolutePath, new JpegEncoder { Quality = 85 }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // A file that will not decode is not an image, whatever the client's Content-Type claimed —
            // and storing it unprocessed to be helpful would reopen the exact hole this method closes.
            logger.LogWarning(ex, "Rejected an upload that could not be decoded as an image");
            throw new InvalidDataException("Skedari nuk u lexua dot si imazh.");
        }

        var sizeBytes = new FileInfo(absolutePath).Length;

        logger.LogInformation("Stored photo {Url} ({Size} bytes, metadata stripped)", url, sizeBytes);
        return new StoredPhoto(url, absolutePath, sizeBytes);
    }

    /// <summary>
    /// Decodes EXIF GPS (degrees/minutes/seconds plus a hemisphere reference) into plain decimal degrees.
    /// Most photos won't have this at all — location-tagging is off by default on a lot of phones now,
    /// and anything that passed through another app first usually lost it already — so null is the
    /// common case, not a failure.
    /// </summary>
    private static (double Lat, double Lng)? TryReadGpsCoordinates(ExifProfile? exif)
    {
        if (exif is null) return null;

        try
        {
            // GetValue, not an indexer or a TryGetValue — ExifProfile only exposes the former, and it
            // returns null for a tag that isn't present rather than throwing. Wrapped regardless: this
            // must never be the reason an otherwise-valid upload gets rejected below.
            var lat = ToDecimalDegrees(exif.GetValue(ExifTag.GPSLatitude)?.Value);
            var lng = ToDecimalDegrees(exif.GetValue(ExifTag.GPSLongitude)?.Value);
            var latRef = exif.GetValue(ExifTag.GPSLatitudeRef)?.Value;
            var lngRef = exif.GetValue(ExifTag.GPSLongitudeRef)?.Value;
            if (lat is null || lng is null || latRef is null || lngRef is null) return null;

            if (string.Equals(latRef, "S", StringComparison.OrdinalIgnoreCase)) lat = -lat;
            if (string.Equals(lngRef, "W", StringComparison.OrdinalIgnoreCase)) lng = -lng;

            return (lat.Value, lng.Value);
        }
        catch
        {
            return null;
        }
    }

    private static double? ToDecimalDegrees(Rational[]? dms)
    {
        if (dms is not { Length: 3 }) return null;
        return dms[0].ToDouble() + dms[1].ToDouble() / 60.0 + dms[2].ToDouble() / 3600.0;
    }

    public async Task<(byte[] Data, string ContentType)?> ReadAsync(string url, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("/uploads/", StringComparison.Ordinal))
            return null;

        var uploadsRoot = Path.GetFullPath(Path.Combine(env.WebRootPath, "uploads") + Path.DirectorySeparatorChar);
        var relative = url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var absolutePath = Path.GetFullPath(Path.Combine(env.WebRootPath, relative));

        // A URL is client-supplied at report-submission time — refuse anything that resolves outside
        // the uploads folder before touching the filesystem.
        if (!absolutePath.StartsWith(uploadsRoot, StringComparison.Ordinal) || !File.Exists(absolutePath))
            return null;

        var contentType = Path.GetExtension(absolutePath).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "application/octet-stream"
        };

        var data = await File.ReadAllBytesAsync(absolutePath, ct);
        return (data, contentType);
    }
}
