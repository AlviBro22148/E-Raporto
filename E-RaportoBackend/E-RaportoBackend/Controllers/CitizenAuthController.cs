using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using E_RaportoBackend.Services;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// Citizen accounts. Replaces the earlier anonymous device-id model — every report, confirmation and
/// notification now belongs to a real account, which is what makes attribution and one-confirmation-
/// per-user possible. Kept as simple as staff auth: email + password, no OTP, no email verification —
/// none of that carries judging weight and every hour spent on it is an hour not spent on the core loop.
/// </summary>
[ApiController]
[Route("api/v1/auth/citizen")]
[Tags("Auth — citizen")]
public class CitizenAuthController(
    AppDbContext db, TokenService tokens, IRealtimeBroadcaster realtime,
    ILogger<CitizenAuthController> logger)
    : ControllerBase
{
    /// <summary>Creates a citizen account and immediately logs it in.</summary>
    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<CitizenLoginResponse>> Register(RegisterCitizenRequest request, CancellationToken ct)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        if (await db.CitizenUsers.AnyAsync(u => u.Email == email, ct))
        {
            return Problem(
                title: "Llogaria ekziston",
                detail: "Ka tashmë një llogari me këtë email. Provoni të hyni në vend që të regjistroheni.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var municipality = await db.Municipalities.OrderBy(m => m.Id).FirstAsync(ct);

        var user = new CitizenUser
        {
            MunicipalityId = municipality.Id,
            Email = email,
            FullName = request.FullName.Trim(),
            Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Pseudonym = PseudonymGenerator.Next(),
            LastLoginAt = DateTime.UtcNow
        };

        db.CitizenUsers.Add(user);

        // Retried rather than trusted: 32^6 makes a collision improbable, not impossible, and two
        // citizens sharing a handle would read as one reporter in a duplicate review. The unique index
        // is what makes it impossible; this loop is what stops that turning into a failed registration
        // for the unlucky second person.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(ct);
                break;
            }
            catch (DbUpdateException) when (attempt < 4)
            {
                user.Pseudonym = PseudonymGenerator.Next();
            }
        }

        // Deliberately not logged together with the pseudonym. Writing "account X = handle Y" into the
        // application log would rebuild, in a file nobody thinks of as a database, exactly the mapping
        // this whole design exists to keep out of reach.
        logger.LogInformation("New citizen account registered");

        var (token, expiresAt) = tokens.IssueForCitizen(user);
        return CreatedAtAction(nameof(Me), null, new CitizenLoginResponse(token, expiresAt, user.ToDto()));
    }

    /// <summary>Exchanges citizen credentials for a JWT.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<CitizenLoginResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var user = await db.CitizenUsers.FirstOrDefaultAsync(u => u.Email == email, ct);

        if (user is null || !user.IsActive || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            logger.LogWarning("Failed citizen login attempt for {Email}", request.Email);
            return Problem(
                title: "Kredenciale të pasakta",
                detail: "Email-i ose fjalëkalimi nuk është i saktë.",
                statusCode: StatusCodes.Status401Unauthorized);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var (token, expiresAt) = tokens.IssueForCitizen(user);
        return Ok(new CitizenLoginResponse(token, expiresAt, user.ToDto()));
    }

    /// <summary>Validates a stored token on app boot and returns the current citizen.</summary>
    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType<CitizenUserDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<CitizenUserDto>> Me(CancellationToken ct)
    {
        var user = await this.CurrentCitizenAsync(db, ct);
        return user is null ? Unauthorized() : Ok(user.ToDto());
    }

    /// <summary>
    /// Updates the citizen's own display name / phone, or the language toggle. The mobile app calls this
    /// with only <c>PreferredLocale</c> set when the citizen flips the app's language switch — separate
    /// from a name/phone save, so one can never accidentally undo the other.
    /// </summary>
    [HttpPatch("me")]
    [Authorize]
    [ProducesResponseType<CitizenUserDto>(StatusCodes.Status200OK)]
    public async Task<ActionResult<CitizenUserDto>> UpdateMe(UpdateCitizenProfileRequest request, CancellationToken ct)
    {
        var user = await this.CurrentCitizenAsync(db, ct);
        if (user is null) return Unauthorized();

        if (!string.IsNullOrWhiteSpace(request.FullName)) user.FullName = request.FullName.Trim();
        // Explicit null vs "field omitted" isn't worth the ceremony here — an empty string means
        // "clear the phone number", which is the only clearing behaviour this form needs.
        user.Phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        if (request.PreferredLocale is not null) user.PreferredLocale = request.PreferredLocale;
        realtime.CitizenProfileUpdated(user.Id);

        await db.SaveChangesAsync(ct);
        await realtime.FlushAsync(ct);

        return Ok(user.ToDto());
    }

    /// <summary>Changes the citizen's password. Requires the current password.</summary>
    [HttpPost("me/change-password")]
    [Authorize]
    [EnableRateLimiting("login")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request, CancellationToken ct)
    {
        var user = await this.CurrentCitizenAsync(db, ct);
        if (user is null) return Unauthorized();

        if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword, user.PasswordHash))
        {
            return Problem(
                title: "Fjalëkalimi aktual është i pasaktë",
                statusCode: StatusCodes.Status401Unauthorized);
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
}
