using E_RaportoBackend.Dtos;

namespace E_RaportoBackend.Realtime;

/// <summary>
/// What changed, not what it now contains. Every payload carries an identity and just enough context to
/// decide whether a screen cares — never the record itself.
///
/// That is deliberate and it is the security boundary of this whole feature: one broadcast reaches
/// clients with very different rights over the same report (the citizen who filed it, an unrelated
/// citizen looking at the public map, a clerk who may see the reporter's phone number). Shipping the
/// entity in the event would mean re-deriving all of that per recipient on every change. Instead the
/// client refetches through the ordinary REST endpoint, which already authorises correctly, so a
/// realtime event can never widen what somebody is allowed to see.
/// </summary>
public record EntityChangedEvent(
    string Entity,
    string Action,
    Guid Id,
    string? PublicRef,
    string? Status,
    DateTime OccurredAt);

/// <summary>
/// The strongly-typed client surface. Naming a Hub&lt;T&gt; against this means a typo in a method name
/// is a compile error here rather than an event that silently never arrives on the phone.
/// </summary>
public interface IRealtimeClient
{
    Task EntityChanged(EntityChangedEvent payload);

    /// <summary>
    /// A new notification for this citizen, delivered whole: unlike <see cref="EntityChanged"/>, this
    /// only ever goes to the one citizen it belongs to, so it can carry its own content and save the
    /// client a refetch just to show a banner.
    /// </summary>
    Task NotificationReceived(NotificationDto payload);

    /// <summary>
    /// Authoritative unread count for this citizen. Sent when read-state changes so a second device
    /// updates its badge exactly, rather than each device guessing from a list it may not have refetched.
    /// </summary>
    Task UnreadCountChanged(int unreadCount);
}

public static class RealtimeGroups
{
    /// <summary>Every authenticated connection. Carries only what the public map already exposes.</summary>
    public const string Public = "public";

    /// <summary>Municipal staff — the queue, the duplicate review list, the analytics.</summary>
    public const string Staff = "staff";

    public static string Citizen(Guid citizenUserId) => $"citizen:{citizenUserId}";

    /// <summary>A single report's detail screen. Opt-in via <c>Subscribe</c>.</summary>
    public static string Report(Guid reportId) => $"report:{reportId}";
}

public static class RealtimeEntities
{
    public const string Report = "report";
    public const string Notification = "notification";
    public const string DuplicateCandidate = "duplicateCandidate";
    public const string CitizenProfile = "citizenProfile";
    public const string SystemicPattern = "systemicPattern";
    public const string PhotoReuseFlag = "photoReuseFlag";
}

public static class RealtimeActions
{
    public const string Created = "created";
    public const string Updated = "updated";
    public const string Deleted = "deleted";
    public const string StatusChanged = "statusChanged";
    public const string Assigned = "assigned";
    public const string Merged = "merged";
    public const string Confirmed = "confirmed";
    public const string Read = "read";
    public const string Reviewed = "reviewed";

    // A citizen answered the "is it actually fixed?" question. Two actions rather than one generic
    // "verified" so a listener can react differently to the two answers without refetching first —
    // the dashboard raises a dispute to attention, a confirmation just updates quietly.
    public const string Verified = "verified";
    public const string Disputed = "disputed";
}
