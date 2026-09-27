using E_RaportoBackend.Dtos;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Mvc;

namespace E_RaportoBackend.Controllers;

/// <summary>Photo upload for citizen reports. Returns a URL the client passes back on submit.</summary>
[ApiController]
[Route("api/v1/uploads")]
[Tags("Citizen — uploads")]
public class UploadsController(IPhotoStorage storage, ILogger<UploadsController> logger) : ControllerBase
{
    private const long MaxBytes = 8 * 1024 * 1024;

    /// <summary>Uploads one image (max 8 MB).</summary>
    [HttpPost("photo")]
    [RequestSizeLimit(MaxBytes)]
    [ProducesResponseType<PhotoUploadResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<PhotoUploadResponse>> UploadPhoto(IFormFile file, CancellationToken ct)
    {
        if (file.Length == 0)
            return Problem(title: "Skedar bosh", detail: "Skedari i ngarkuar është bosh.",
                statusCode: StatusCodes.Status400BadRequest);

        if (file.Length > MaxBytes)
            return Problem(title: "Skedar shumë i madh", detail: "Fotoja nuk mund të kalojë 8 MB.",
                statusCode: StatusCodes.Status400BadRequest);

        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return Problem(title: "Format i papranuar", detail: "Pranohen vetëm imazhe.",
                statusCode: StatusCodes.Status400BadRequest);

        await using var stream = file.OpenReadStream();
        var stored = await storage.SaveAsync(stream, file.FileName, file.ContentType, ct);

        logger.LogInformation("Photo uploaded: {Url}", stored.Url);
        return Created(stored.Url, new PhotoUploadResponse(stored.Url, stored.StoragePath, stored.SizeBytes));
    }
}
