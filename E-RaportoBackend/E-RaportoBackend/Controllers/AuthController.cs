using System.Security.Claims;
using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>Staff authentication for the municipal dashboard (and the mobile app's staff mode).</summary>
[ApiController]
[Route("api/v1/auth")]
[Tags("Auth — staff")]
public class AuthController(AppDbContext db, TokenService tokens, ILogger<AuthController> logger)
    : ControllerBase
{
    /// <summary>Exchanges staff credentials for a JWT.</summary>
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("login")]
    [ProducesResponseType<LoginResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<LoginResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var user = await db.StaffUsers
            .Include(u => u.Department)
            .FirstOrDefaultAsync(u => u.Email == request.Email.Trim().ToLower(), ct);

        // One generic message for both "no such account" and "wrong password" — never confirm which
        // staff emails exist.
        if (user is null || !user.IsActive || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            logger.LogWarning("Failed staff login attempt for {Email}", request.Email);
            return Problem(
                title: "Kredenciale të pasakta",
                detail: "Email-i ose fjalëkalimi nuk është i saktë.",
                statusCode: StatusCodes.Status401Unauthorized);
        }

        user.LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var (token, expiresAt) = tokens.IssueForStaff(user);
        return Ok(new LoginResponse(token, expiresAt, user.ToDto()));
    }

    /// <summary>Validates a stored token on dashboard boot and returns the current staff user.</summary>
    [HttpGet("me")]
    [Authorize]
    [ProducesResponseType<StaffUserDto>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<StaffUserDto>> Me(CancellationToken ct)
    {
        var user = await this.CurrentStaffAsync(db, ct);
        return user is null ? Unauthorized() : Ok(user.ToDto());
    }
}

public static class ControllerExtensions
{
    /// <summary>
    /// Resolves the authenticated staff user from the JWT. Checks the "utyp" claim first and fails
    /// closed on anything else — a citizen token must never resolve to a staff account, even though a
    /// Guid collision between the two tables is practically impossible on its own.
    /// </summary>
    public static async Task<StaffUser?> CurrentStaffAsync(
        this ControllerBase controller, AppDbContext db, CancellationToken ct = default)
    {
        if (controller.User.FindFirstValue(AppClaimTypes.UserType) != "staff") return null;

        var sub = controller.User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
                  ?? controller.User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(sub, out var id)) return null;

        return await db.StaffUsers
            .Include(u => u.Department)
            .FirstOrDefaultAsync(u => u.Id == id && u.IsActive, ct);
    }

    /// <summary>Resolves the authenticated citizen from the JWT, with the same fail-closed check.</summary>
    public static async Task<CitizenUser?> CurrentCitizenAsync(
        this ControllerBase controller, AppDbContext db, CancellationToken ct = default)
    {
        if (controller.User.FindFirstValue(AppClaimTypes.UserType) != "citizen") return null;

        var sub = controller.User.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
                  ?? controller.User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!Guid.TryParse(sub, out var id)) return null;

        return await db.CitizenUsers.FirstOrDefaultAsync(u => u.Id == id && u.IsActive, ct);
    }
}
