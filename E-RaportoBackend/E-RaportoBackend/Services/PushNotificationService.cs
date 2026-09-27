using System.Text.Json;
using System.Text.Json.Serialization;
using E_RaportoBackend.Data;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Services;

public interface IPushNotificationService
{
    /// <summary>
    /// Best-effort: looks up the citizen's registered device, sends via Expo's push service, and clears
    /// the stored token if Expo reports it dead. Never throws — a push failure must never be the reason
    /// a status change or a merge fails to save.
    /// </summary>
    Task NotifyAsync(Guid citizenUserId, string title, string body, Guid reportId, CancellationToken ct = default);
}

/// <summary>
/// Sends through Expo's push service (https://exp.host/--/api/v2/push/send) rather than talking to
/// FCM/APNs directly. That is the whole point of an Expo-managed app: no server-held FCM/APNs secrets
/// here at all — EAS provisions and rotates those on Expo's own infrastructure once the app is built
/// with a linked project. This code needs nothing from that beyond the token the device itself hands us.
/// </summary>
public class ExpoPushNotificationService(
    IHttpClientFactory httpClientFactory, AppDbContext db, ILogger<ExpoPushNotificationService> logger)
    : IPushNotificationService
{
    private const string PushEndpoint = "https://exp.host/--/api/v2/push/send";

    public async Task NotifyAsync(
        Guid citizenUserId, string title, string body, Guid reportId, CancellationToken ct = default)
    {
        try
        {
            var token = await db.CitizenUsers.AsNoTracking()
                .Where(u => u.Id == citizenUserId)
                .Select(u => u.PushToken)
                .FirstOrDefaultAsync(ct);

            if (string.IsNullOrWhiteSpace(token)) return;   // no device registered — nothing to do

            var client = httpClientFactory.CreateClient(nameof(ExpoPushNotificationService));

            // Always sent as a one-element array, never a bare object: Expo's response shape for `data`
            // follows the request shape exactly (an object for a single message, an array for a list),
            // and every other part of this method — including the DeviceNotRegistered cleanup — assumes
            // the array form, which is also what Expo's own docs show for every example.
            var message = new PushMessage(To: token, Title: title, Body: body, Data: new PushData(reportId), ChannelId: "default");
            using var response = await client.PostAsJsonAsync(PushEndpoint, new[] { message }, ct);

            var payload = await response.Content.ReadFromJsonAsync<PushSendResponse>(cancellationToken: ct);
            var ticket = payload?.Data?.FirstOrDefault();

            if (ticket?.Status == "error")
            {
                logger.LogWarning("Push to citizen {CitizenId} failed: {Message} ({ErrorCode})",
                    citizenUserId, ticket.Message, ticket.Details?.Error);

                // The device uninstalled the app or the token otherwise died — stop trying it forever.
                if (ticket.Details?.Error == "DeviceNotRegistered")
                {
                    await db.CitizenUsers.Where(u => u.Id == citizenUserId && u.PushToken == token)
                        .ExecuteUpdateAsync(s => s.SetProperty(u => u.PushToken, (string?)null), ct);
                }
            }
        }
        catch (Exception ex)
        {
            // Offline Expo API, malformed response, whatever — the citizen still sees the in-app
            // notification list either way, so this is degraded, not broken.
            logger.LogWarning(ex, "Push notification to citizen {CitizenId} could not be sent.", citizenUserId);
        }
    }

    private sealed record PushMessage(
        [property: JsonPropertyName("to")] string To,
        [property: JsonPropertyName("title")] string Title,
        [property: JsonPropertyName("body")] string Body,
        [property: JsonPropertyName("data")] PushData Data,
        [property: JsonPropertyName("channelId")] string ChannelId);

    private sealed record PushData([property: JsonPropertyName("reportId")] Guid ReportId);

    private sealed record PushSendResponse([property: JsonPropertyName("data")] List<PushTicket>? Data);

    private sealed record PushTicket(
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("message")] string? Message,
        [property: JsonPropertyName("details")] PushTicketDetails? Details);

    private sealed record PushTicketDetails([property: JsonPropertyName("error")] string? Error);
}
