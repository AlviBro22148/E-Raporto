using System.Security.Claims;
using System.Text.RegularExpressions;
using E_RaportoBackend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace E_RaportoBackend.Realtime;

/// <summary>
/// The single realtime endpoint for both clients. Connections are placed into groups from their JWT on
/// connect — the client never asks to be put somewhere it has rights to, because it never gets to choose.
/// The only client-driven membership is <see cref="Subscribe"/>, and that is restricted to per-report
/// rooms, which carry nothing the public map does not already show.
/// </summary>
[Authorize]
public partial class GlobalNotificationHub(ILogger<GlobalNotificationHub> logger) : Hub<IRealtimeClient>
{
    /// <summary>The only topic shape a client may join on its own: report:{guid}.</summary>
    [GeneratedRegex(@"^report:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")]
    private static partial Regex SubscribableTopic();

    public override async Task OnConnectedAsync()
    {
        var user = Context.User;
        var userType = user?.FindFirstValue(AppClaimTypes.UserType);

        await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeGroups.Public);

        if (userType == "staff")
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeGroups.Staff);
        }
        else if (userType == "citizen" && TryGetUserId(out var citizenId))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, RealtimeGroups.Citizen(citizenId));
        }

        logger.LogInformation("Realtime connected: {ConnectionId} as {UserType}", Context.ConnectionId, userType ?? "unknown");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Group membership is dropped by SignalR itself on disconnect; this only records why, because a
        // silent reconnect loop on a phone is otherwise invisible from the server side.
        if (exception is not null)
            logger.LogWarning(exception, "Realtime dropped: {ConnectionId}", Context.ConnectionId);

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Joins a per-report room, for a detail screen that wants events about one case. Anything that is
    /// not a report room is refused rather than ignored: silently doing nothing would leave a client
    /// believing it is subscribed and quietly missing every update.
    /// </summary>
    public async Task Subscribe(string topic)
    {
        if (!SubscribableTopic().IsMatch(topic))
            throw new HubException($"Topic '{topic}' is not subscribable.");

        await Groups.AddToGroupAsync(Context.ConnectionId, topic);
    }

    public async Task Unsubscribe(string topic)
    {
        if (!SubscribableTopic().IsMatch(topic))
            throw new HubException($"Topic '{topic}' is not subscribable.");

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, topic);
    }

    private bool TryGetUserId(out Guid id)
    {
        // Both claim names are checked for the same reason the controller helpers do it: whether "sub"
        // survives as "sub" or is remapped to NameIdentifier depends on inbound claim mapping.
        var sub = Context.User?.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)
                  ?? Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);

        return Guid.TryParse(sub, out id);
    }
}
