using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services.Ai;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Services;

/// <summary>Raised when a caller attempts a status change the workflow does not permit.</summary>
public class InvalidStatusTransitionException(ReportStatus from, ReportStatus to)
    : Exception($"Cannot move a report from {from} to {to}.")
{
    public ReportStatus From { get; } = from;
    public ReportStatus To { get; } = to;
}

/// <summary>
/// Owns every mutation of a report's status. The transition table lives here rather than in the
/// controllers so both the citizen path and the staff path obey the same rules, and so the API rejects
/// an illegal jump instead of trusting whatever the client sent.
/// </summary>
public class ReportWorkflow(
    AppDbContext db, IPushNotificationService push, IRealtimeBroadcaster realtime,
    INoteTranslator noteTranslator, ILogger<ReportWorkflow> logger)
{
    // Merged and Assigned are deliberately absent from where they used to appear below: neither may be
    // a manually-picked status. The only legitimate way a report becomes Merged is ReportWorkflow.Merge()
    // (DuplicatesController.Confirm for staff, ReportsController.ConfirmDuplicate for the citizen); the
    // only legitimate way it becomes Assigned is StaffReportsController.Assign actually choosing a
    // department or officer. Both call ChangeStatus with a validation bypass instead of relying on this
    // table, so removing them here only closes the second, unintended path: a staff member flipping a
    // report straight to "Merged"/"Assigned" from the generic status buttons with no parent report or
    // assignee ever chosen.
    //
    // Once Assigned, the case has exactly one manual next step — Resolved. There is deliberately no
    // "back to review" and no separate "in progress" click: assigning a case already means someone owns
    // it, so nothing is gained by staff re-declaring that with an extra status click.
    private static readonly Dictionary<ReportStatus, ReportStatus[]> Allowed = new()
    {
        [ReportStatus.Submitted] = [ReportStatus.InReview, ReportStatus.Rejected],
        [ReportStatus.InReview] = [ReportStatus.Rejected],
        [ReportStatus.Assigned] = [ReportStatus.Resolved, ReportStatus.Rejected],
        // InProgress is now unreachable by any transition below — kept only as a historical enum value
        // for old data, not as a status this system will assign to a report again.
        [ReportStatus.InProgress] = [ReportStatus.Resolved, ReportStatus.Assigned],
        [ReportStatus.Resolved] = [ReportStatus.Assigned],     // reopen — back to being someone's case, not "in progress"
        [ReportStatus.Rejected] = [ReportStatus.InReview],     // appeal
        [ReportStatus.Merged] = []                             // terminal
    };

    public static IReadOnlyList<ReportStatus> AllowedNext(ReportStatus from) =>
        Allowed.TryGetValue(from, out var next) ? next : [];

    public static bool CanTransition(ReportStatus from, ReportStatus to) => AllowedNext(from).Contains(to);

    /// <summary>
    /// Applies a status change: validates it, stamps the milestone timestamps the analytics depend on,
    /// appends an immutable history row, and queues a citizen notification.
    /// Does not call SaveChanges — the caller owns the transaction.
    /// </summary>
    /// <param name="isSystem">
    /// This was the system's own decision, not a person's — e.g. an auto-acknowledge. Bypasses the
    /// transition table AND attributes the history row to "Sistemi" regardless of <paramref name="actor"/>.
    /// </param>
    /// <param name="bypassTransitionCheck">
    /// A person made this decision, but through a dedicated action (assigning, merging) rather than by
    /// picking a status directly — so the generic transition table, which governs the plain status
    /// buttons, doesn't apply here. Unlike <paramref name="isSystem"/>, the history row still credits
    /// <paramref name="actor"/> by name.
    /// </param>
    /// <param name="noteEn">
    /// A pre-written English translation of <paramref name="note"/>, for the small number of callers on
    /// the report-submission hot path whose note is a fully deterministic system string — passing this
    /// skips the AI translation call entirely. Every other caller leaves it null and gets a real
    /// translation of whatever free text was actually typed.
    /// </param>
    public async Task ChangeStatus(
        Report report, ReportStatus to, string? note, StaffUser? actor,
        bool isSystem = false, bool bypassTransitionCheck = false, string? noteEn = null,
        CancellationToken ct = default)
    {
        var from = report.Status;
        if (from == to)
        {
            // Not an error: staff re-saving a form shouldn't 409. Just record the note if there is one.
            if (!string.IsNullOrWhiteSpace(note))
                await AppendHistoryAsync(report, from, to, note, actor, isSystem, noteEn: noteEn, ct: ct);
            return;
        }

        if (!isSystem && !bypassTransitionCheck && !CanTransition(from, to))
            throw new InvalidStatusTransitionException(from, to);

        report.Status = to;
        report.UpdatedAt = DateTime.UtcNow;

        // Milestone stamps are set once, on first entry — a reopen must not reset time-to-resolution.
        switch (to)
        {
            case ReportStatus.InReview:
                report.AcknowledgedAt ??= DateTime.UtcNow;
                break;
            case ReportStatus.Assigned:
                report.AcknowledgedAt ??= DateTime.UtcNow;
                report.AssignedAt ??= DateTime.UtcNow;
                break;
            case ReportStatus.Resolved:
                report.ResolvedAt = DateTime.UtcNow;
                break;
        }

        // Leaving Resolved by any route clears the stamp. This used to be a single `case InProgress when
        // from == Resolved`, written when a reopen landed on InProgress; the reopen destination has since
        // become Assigned, which quietly left every reopened report still carrying a ResolvedAt. Three
        // things read that field and all three were wrong for those reports: the citizen's detail screen
        // still said "Zgjidhur 3 ditë më parë" under a case that was open again, IsSlaBreached() judged it
        // against its old resolution instead of against now (so a reopened case could never breach again),
        // and the resolution-verification key would have treated the stale stamp as a live question.
        // Written as a rule about leaving the status rather than as a case for one destination, so the next
        // change to the transition table cannot reintroduce it.
        if (from == ReportStatus.Resolved && to != ReportStatus.Resolved) report.ResolvedAt = null;

        var resolvedNoteEn = await AppendHistoryAsync(report, from, to, note, actor, isSystem, noteEn: noteEn, ct: ct);
        var notification = QueueNotification(report, from, to, note, resolvedNoteEn);

        logger.LogInformation("Report {Ref}: {From} -> {To} by {Actor}",
            report.PublicRef, from, to, actor?.FullName ?? "Sistemi");

        // Queued, not sent: these go out when the caller flushes after SaveChanges. See RealtimeBroadcaster.
        realtime.ReportChanged(report, to == ReportStatus.Merged
            ? RealtimeActions.Merged
            : RealtimeActions.StatusChanged);

        if (notification is not null)
        {
            realtime.NotificationCreated(notification.CitizenUserId, new NotificationDto(
                notification.Id, notification.ReportId, report.PublicRef, notification.Type.ToString(),
                notification.Title, notification.Body, notification.TitleEn, notification.BodyEn,
                notification.IsRead, notification.CreatedAt));
        }

        // Sent from here, not after the caller's SaveChanges: the push carries its own title/body, so it
        // needs nothing the database round-trip would add, and every caller of ChangeStatus saves
        // immediately afterwards anyway. Failure here is swallowed inside NotifyAsync itself.
        if (notification is not null) await SendLocalizedPushAsync(notification, ct);
    }

    /// <param name="label">
    /// Overrides who the timeline credits. Exists for the one actor this system has that is neither a
    /// staff member nor itself: the citizen, who writes history when they verify or dispute a resolution.
    /// Attributing that to "Sistemi" would hide the single most important thing about it — that the
    /// verdict came from outside the municipality.
    /// </param>
    /// <param name="noteEn">
    /// A pre-written translation, when the caller already knows one (a deterministic system string, or a
    /// translation already produced earlier in the same request). Left null, a non-empty
    /// <paramref name="note"/> is translated here via <see cref="INoteTranslator"/> — null back means the
    /// call failed or wasn't configured, which is an honest, valid outcome: the row simply has no English
    /// text, and every client already falls back to <see cref="ReportStatusHistory.Note"/> for that case.
    /// </param>
    /// <returns>The English text actually stored (or null), so a caller building a notification from the
    /// same note doesn't pay for a second translation of identical text.</returns>
    public async Task<string?> AppendHistoryAsync(
        Report report, ReportStatus? from, ReportStatus to, string? note, StaffUser? actor,
        bool isSystem = false, string? label = null, string? noteEn = null, CancellationToken ct = default)
    {
        if (noteEn is null && !string.IsNullOrWhiteSpace(note))
            noteEn = await noteTranslator.TranslateAsync(note, ct);

        db.ReportStatusHistory.Add(new ReportStatusHistory
        {
            ReportId = report.Id,
            FromStatus = from,
            ToStatus = to,
            Note = note,
            NoteEn = noteEn,
            ChangedByStaffId = actor?.Id,
            ChangedByLabel = label ?? (isSystem || actor is null ? "Sistemi" : actor.FullName)
        });

        return noteEn;
    }

    /// <summary>
    /// Merges <paramref name="child"/> into <paramref name="parent"/>. Nothing is deleted: the child
    /// keeps its row, gains a pointer to the parent, and the citizen who filed it starts following the
    /// parent's status instead. The parent's confirmation count is what turns 40 tickets into one
    /// ticket with 40 voices behind it.
    /// </summary>
    public async Task Merge(Report child, Report parent, StaffUser? actor, string? note = null, CancellationToken ct = default)
    {
        if (child.Id == parent.Id) throw new InvalidOperationException("A report cannot be merged into itself.");
        if (child.Status == ReportStatus.Merged) return;

        child.MergedIntoReportId = parent.Id;
        child.UpdatedAt = DateTime.UtcNow;
        parent.ConfirmationCount += Math.Max(1, child.ConfirmationCount);
        parent.UpdatedAt = DateTime.UtcNow;

        var mergeNote = note ?? $"Bashkuar me raportin {parent.PublicRef}.";
        await ChangeStatus(child, ReportStatus.Merged, mergeNote, actor, isSystem: true, ct: ct);

        const string title = "Raporti juaj u bashkua";
        var body = $"Raporti juaj i ngjashëm u bashkua me {parent.PublicRef}. Do të njoftoheni për çdo ndryshim statusi.";
        const string titleEn = "Your report was merged";
        var bodyEn = $"Your similar report was merged into {parent.PublicRef}. You'll be notified of any status change.";

        var notification = new CitizenNotification
        {
            ReportId = parent.Id,
            CitizenUserId = child.ReporterUserId,
            Type = NotificationType.MergedIntoExisting,
            Title = title,
            Body = body,
            TitleEn = titleEn,
            BodyEn = bodyEn
        };
        db.CitizenNotifications.Add(notification);

        logger.LogInformation("Merged report {Child} into {Parent}", child.PublicRef, parent.PublicRef);
        await SendLocalizedPushAsync(notification, ct);

        // The parent gained a confirmation and the child became Merged — both are visible changes, and the
        // child's own ChangeStatus above only covered the child.
        realtime.ReportChanged(parent, RealtimeActions.Updated);
        realtime.NotificationCreated(child.ReporterUserId, new NotificationDto(
            notification.Id, notification.ReportId, parent.PublicRef, notification.Type.ToString(),
            notification.Title, notification.Body, notification.TitleEn, notification.BodyEn,
            notification.IsRead, notification.CreatedAt));
    }

    private CitizenNotification? QueueNotification(
        Report report, ReportStatus from, ReportStatus to, string? note, string? noteEn)
    {
        string title, body, titleEn, bodyEn;
        NotificationType type;

        // A reopen lands on Assigned like any other routing, but the citizen was told days ago that this
        // exact report was resolved. Sending them "u caktua" here would quietly contradict that without
        // ever saying what actually happened, so the one case where the destination status does not tell
        // the truth on its own gets its own message.
        if (from == ReportStatus.Resolved && to == ReportStatus.Assigned)
        {
            type = NotificationType.StatusChanged;
            title = "Raporti juaj u rihap";
            body = $"{report.PublicRef} u rihap dhe iu kthye drejtorisë përgjegjëse.";
            titleEn = "Your report was reopened";
            bodyEn = $"{report.PublicRef} was reopened and returned to the responsible department.";
        }
        else
        {
            (title, body, titleEn, bodyEn, type) = to switch
            {
                ReportStatus.InReview => ("Raporti juaj është në shqyrtim",
                    $"{report.PublicRef} po shqyrtohet nga bashkia.",
                    "Your report is under review",
                    $"{report.PublicRef} is being reviewed by the municipality.",
                    NotificationType.Acknowledged),
                ReportStatus.Assigned => ("Raporti juaj u caktua",
                    $"{report.PublicRef} iu caktua drejtorisë përgjegjëse.",
                    "Your report was assigned",
                    $"{report.PublicRef} was assigned to the responsible department.",
                    NotificationType.Assigned),
                ReportStatus.InProgress => ("Puna ka filluar",
                    $"Ekipi ka filluar punën për {report.PublicRef}.",
                    "Work has started",
                    $"The team has started work on {report.PublicRef}.",
                    NotificationType.StatusChanged),
                // Not "u zgjidh" any more, and not phrased as news. The municipality has made a claim
                // about the citizen's street and the citizen is the only person who can check it, so the
                // message that carries that claim is the message that asks them to. NotificationType is
                // VerificationRequested rather than Resolved because the clients branch on it: this is
                // the one notification that opens a screen with a question on it.
                ReportStatus.Resolved => ("Raporti juaj u shënua si i zgjidhur",
                    $"Bashkia thotë se {report.PublicRef} është rregulluar. A është vërtet? Hapeni për ta konfirmuar.",
                    "Your report was marked resolved",
                    $"The municipality says {report.PublicRef} has been fixed. Is that true? Open it to confirm.",
                    NotificationType.VerificationRequested),
                ReportStatus.Rejected => ("Raporti juaj nuk u pranua",
                    $"{report.PublicRef} nuk u pranua. Shihni shënimin për arsyen.",
                    "Your report was not accepted",
                    $"{report.PublicRef} was not accepted. See the note for the reason.",
                    NotificationType.StatusChanged),
                _ => (string.Empty, string.Empty, string.Empty, string.Empty, NotificationType.StatusChanged)
            };

            if (string.IsNullOrEmpty(title)) return null;
        }

        // noteEn is a real translation whenever AppendHistoryAsync (called just before this, from
        // ChangeStatus) managed to produce one. It falls back to the raw Albanian note only if the
        // translator wasn't configured or the call failed — better a bilingual sentence than a dropped one.
        if (!string.IsNullOrWhiteSpace(note))
        {
            body = $"{body} — {note}";
            bodyEn = $"{bodyEn} — {noteEn ?? note}";
        }

        var notification = new CitizenNotification
        {
            ReportId = report.Id,
            CitizenUserId = report.ReporterUserId,
            Type = type,
            Title = title,
            Body = body,
            TitleEn = titleEn,
            BodyEn = bodyEn
        };
        db.CitizenNotifications.Add(notification);
        return notification;
    }

    /// <summary>
    /// Picks Title/Body or TitleEn/BodyEn by the reporter's stored PreferredLocale before handing off to
    /// the push service, which just sends whatever strings it's given. This is the one place a language
    /// choice has to be resolved server-side rather than left to the client — an OS push notification is
    /// finalised and delivered while the app may not even be running, so there is no render-time picker
    /// to defer to the way every other screen in the product does.
    /// </summary>
    private async Task SendLocalizedPushAsync(CitizenNotification notification, CancellationToken ct)
    {
        var locale = await db.CitizenUsers.AsNoTracking()
            .Where(u => u.Id == notification.CitizenUserId)
            .Select(u => u.PreferredLocale)
            .FirstOrDefaultAsync(ct);

        var useEnglish = locale == "en" && !string.IsNullOrEmpty(notification.TitleEn);
        var title = useEnglish ? notification.TitleEn : notification.Title;
        var body = useEnglish ? notification.BodyEn : notification.Body;

        await push.NotifyAsync(notification.CitizenUserId, title, body, notification.ReportId, ct);
    }

    /// <summary>
    /// Allocates the next human-quotable reference, e.g. ELB-2026-0042. Sequential per municipality
    /// per year so a citizen can read it out over the phone.
    /// </summary>
    public async Task<string> NextPublicRefAsync(Municipality municipality, CancellationToken ct = default)
    {
        var year = DateTime.UtcNow.Year;
        var prefix = $"{municipality.RefPrefix}-{year}-";

        var lastRef = await db.Reports
            .Where(r => r.MunicipalityId == municipality.Id && r.PublicRef.StartsWith(prefix))
            .OrderByDescending(r => r.PublicRef)
            .Select(r => r.PublicRef)
            .FirstOrDefaultAsync(ct);

        var next = 1;
        if (lastRef is not null && int.TryParse(lastRef[prefix.Length..], out var parsed)) next = parsed + 1;

        return $"{prefix}{next:D4}";
    }
}
