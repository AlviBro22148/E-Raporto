using E_RaportoBackend.Data;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Controllers;

/// <summary>
/// Citizen notifications. Delivered two ways at once: the mobile app polls this list on focus (so the
/// in-app list and the tab badge always work, even with no push configured), and the same rows trigger
/// a real Expo push send from <see cref="ReportWorkflow"/> so a citizen who has the app closed still
/// gets told their case moved — see <see cref="RegisterPushToken"/> for how a device opts into that.
/// </summary>
[ApiController]
[Route("api/v1/notifications")]
[Tags("Citizen — notifications")]
[Authorize]
public class NotificationsController(AppDbContext db, IRealtimeBroadcaster realtime) : ControllerBase
{
    /// <summary>
    /// Registers (or updates) this device's Expo push token against the signed-in citizen. Idempotent —
    /// the client is expected to call this on every app start, since a token can rotate at any time.
    /// </summary>
    [HttpPut("push-token")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> RegisterPushToken(RegisterPushTokenRequest request, CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        citizen.PushToken = request.Token.Trim();
        citizen.PushTokenUpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>
    /// Unregisters this citizen's device — called on sign-out so a shared or resold phone stops
    /// receiving another person's case updates.
    /// </summary>
    [HttpDelete("push-token")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> UnregisterPushToken(CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        citizen.PushToken = null;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Notifications for the signed-in citizen, newest first.</summary>
    [HttpGet]
    [ProducesResponseType<List<NotificationDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<List<NotificationDto>>> Get(
        [FromQuery] bool unreadOnly = false, CancellationToken ct = default)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        var query = db.CitizenNotifications.AsNoTracking()
            .Include(n => n.Report)
            .Where(n => n.CitizenUserId == citizen.Id);

        if (unreadOnly) query = query.Where(n => !n.IsRead);

        var notifications = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(100)
            .ToListAsync(ct);

        return Ok(notifications.Select(n => n.ToDto()).ToList());
    }

    [HttpPost("{id:guid}/read")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> MarkRead(Guid id, CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        var notification = await db.CitizenNotifications
            .FirstOrDefaultAsync(n => n.Id == id && n.CitizenUserId == citizen.Id, ct);
        if (notification is null) return NotFound();

        notification.IsRead = true;
        await db.SaveChangesAsync(ct);

        // Counted after the save so the number is the truth, not a prediction — this citizen's other
        // devices set their badge from it directly rather than refetching the whole list to count.
        var unread = await db.CitizenNotifications
            .CountAsync(n => n.CitizenUserId == citizen.Id && !n.IsRead, ct);

        realtime.NotificationsRead(citizen.Id, unread);
        await realtime.FlushAsync(ct);

        return NoContent();
    }

    [HttpPost("read-all")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> MarkAllRead(CancellationToken ct)
    {
        var citizen = await this.CurrentCitizenAsync(db, ct);
        if (citizen is null) return Unauthorized();

        await db.CitizenNotifications
            .Where(n => n.CitizenUserId == citizen.Id && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true), ct);

        // ExecuteUpdateAsync writes straight through, so there is nothing left to save — the count is
        // known to be zero by construction here.
        realtime.NotificationsRead(citizen.Id, 0);
        await realtime.FlushAsync(ct);

        return NoContent();
    }
}
