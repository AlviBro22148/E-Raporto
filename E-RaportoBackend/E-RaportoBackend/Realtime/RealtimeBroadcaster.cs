using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace E_RaportoBackend.Realtime;

public interface IRealtimeBroadcaster
{
    /// <summary>A report was created, edited, routed, resolved or merged.</summary>
    void ReportChanged(Report report, string action);

    /// <summary>A notification row was written for this citizen.</summary>
    void NotificationCreated(Guid citizenUserId, NotificationDto notification);

    /// <summary>Read-state changed; <paramref name="unreadCount"/> is the authoritative new count.</summary>
    void NotificationsRead(Guid citizenUserId, int unreadCount);

    /// <summary>A duplicate suggestion was confirmed or rejected by staff.</summary>
    void DuplicateReviewed(Guid candidateId, string action);

    /// <summary>A systemic pattern was detected, or a pending one was acknowledged/dismissed by staff.</summary>
    void PatternChanged(Guid patternId, string action);

    /// <summary>Any fraud flag — automated or staff-raised — was created, or a pending one was
    /// acknowledged/dismissed.</summary>
    void FraudFlagged(Guid flagId, string action);

    /// <summary>This citizen's own profile changed, for their other signed-in devices.</summary>
    void CitizenProfileUpdated(Guid citizenUserId);

    /// <summary>
    /// Sends everything queued during this request. Call it after <c>SaveChangesAsync</c> — never before.
    /// </summary>
    Task FlushAsync(CancellationToken ct = default);
}

/// <summary>
/// Queues realtime events during a request and sends them only when the caller flushes.
///
/// The queue exists for one reason: an event tells clients to refetch, so publishing before the
/// transaction commits invites every listener to read the old row back and cache it as current. That
/// race is rare, silent, and miserable to debug, so the ordering is enforced by shape here rather than
/// left to whoever edits a controller next.
/// </summary>
public class RealtimeBroadcaster(
    IHubContext<GlobalNotificationHub, IRealtimeClient> hub,
    ILogger<RealtimeBroadcaster> logger) : IRealtimeBroadcaster, IDisposable
{
    // Keyed so one request cannot send the same event twice: assigning a case, for example, moves it
    // through two statuses in a single call, and the client gains nothing from being told to refetch the
    // same report twice. A null key means "always send" (per-citizen payloads, which are never identical).
    private readonly List<(string? Key, Func<CancellationToken, Task> Send)> _pending = [];
    private bool _flushed;

    public void ReportChanged(Report report, string action)
    {
        var payload = new EntityChangedEvent(
            RealtimeEntities.Report,
            action,
            report.Id,
            report.PublicRef,
            report.Status.ToString(),
            DateTime.UtcNow);

        // Sent to `public` alone, and that is load-bearing rather than lazy. Every connection is in
        // `public`; `staff`, `citizen:{id}` and `report:{id}` are all subsets of it. Sending to those as
        // well would deliver the same event two or three times to any client that happens to be in more
        // than one — SignalR delivers per group and does not deduplicate per connection — which is
        // exactly what an early version of this did: one status change, three refetches on the phone.
        //
        // The payload is public-safe by construction (id, reference, status), so a single broadcast to
        // everyone is both correct and the narrowest thing that reaches every screen that cares.
        _pending.Add(($"{RealtimeEntities.Report}:{action}:{report.Id}",
            async ct => await hub.Clients.Group(RealtimeGroups.Public).EntityChanged(payload)));
    }

    public void NotificationCreated(Guid citizenUserId, NotificationDto notification)
    {
        _pending.Add((null, async ct =>
            await hub.Clients.Group(RealtimeGroups.Citizen(citizenUserId)).NotificationReceived(notification)));
    }

    public void NotificationsRead(Guid citizenUserId, int unreadCount)
    {
        var payload = new EntityChangedEvent(
            RealtimeEntities.Notification, RealtimeActions.Read, citizenUserId, null, null, DateTime.UtcNow);

        _pending.Add(($"{RealtimeEntities.Notification}:read:{citizenUserId}", async ct =>
        {
            await hub.Clients.Group(RealtimeGroups.Citizen(citizenUserId)).EntityChanged(payload);
            await hub.Clients.Group(RealtimeGroups.Citizen(citizenUserId)).UnreadCountChanged(unreadCount);
        }
        ));
    }

    public void DuplicateReviewed(Guid candidateId, string action)
    {
        var payload = new EntityChangedEvent(
            RealtimeEntities.DuplicateCandidate, action, candidateId, null, null, DateTime.UtcNow);

        _pending.Add(($"{RealtimeEntities.DuplicateCandidate}:{action}:{candidateId}",
            async ct => await hub.Clients.Group(RealtimeGroups.Staff).EntityChanged(payload)));
    }

    public void PatternChanged(Guid patternId, string action)
    {
        var payload = new EntityChangedEvent(
            RealtimeEntities.SystemicPattern, action, patternId, null, null, DateTime.UtcNow);

        // Staff-only, same reasoning as DuplicateReviewed: this is internal prioritisation tooling, not
        // something the public map needs to reflect live.
        _pending.Add(($"{RealtimeEntities.SystemicPattern}:{action}:{patternId}",
            async ct => await hub.Clients.Group(RealtimeGroups.Staff).EntityChanged(payload)));
    }

    public void FraudFlagged(Guid flagId, string action)
    {
        var payload = new EntityChangedEvent(
            RealtimeEntities.FraudFlag, action, flagId, null, null, DateTime.UtcNow);

        _pending.Add(($"{RealtimeEntities.FraudFlag}:{action}:{flagId}",
            async ct => await hub.Clients.Group(RealtimeGroups.Staff).EntityChanged(payload)));
    }

    public void CitizenProfileUpdated(Guid citizenUserId)
    {
        var payload = new EntityChangedEvent(
            RealtimeEntities.CitizenProfile, RealtimeActions.Updated, citizenUserId, null, null, DateTime.UtcNow);

        _pending.Add(($"{RealtimeEntities.CitizenProfile}:{citizenUserId}", async ct =>
            await hub.Clients.Group(RealtimeGroups.Citizen(citizenUserId)).EntityChanged(payload)));
    }

    public async Task FlushAsync(CancellationToken ct = default)
    {
        _flushed = true;
        if (_pending.Count == 0) return;

        var sent = new HashSet<string>();

        foreach (var (key, send) in _pending)
        {
            if (key is not null && !sent.Add(key)) continue;

            try
            {
                await send(ct);
            }
            catch (Exception ex)
            {
                // The write already succeeded and the client still has polling and pull-to-refresh.
                // Losing a live update is a degraded experience; throwing here would turn it into a
                // failed request for a change that is, in fact, saved.
                logger.LogWarning(ex, "Realtime broadcast failed; clients will reconcile on next fetch.");
            }
        }

        _pending.Clear();
    }

    public void Dispose()
    {
        // A queued-but-never-flushed event means a write path forgot its flush, which otherwise shows up
        // only as "the app doesn't update, sometimes" weeks later. Say so loudly, at the point of the bug.
        if (!_flushed && _pending.Count > 0)
        {
            logger.LogError(
                "{Count} realtime event(s) were queued but never flushed — a write path is missing its FlushAsync call.",
                _pending.Count);
        }

        GC.SuppressFinalize(this);
    }
}
