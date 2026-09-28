using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using E_RaportoBackend.Dtos;
using E_RaportoBackend.Realtime;
using E_RaportoBackend.Services.Ai;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Services;

public record TriageOutcome(
    Report Report,
    ClassificationResult Classification,
    IReadOnlyList<DuplicateCandidate> DuplicateCandidates,
    SystemicPattern? Pattern);

/// <summary>
/// The heart of the product: everything that happens between a citizen tapping "Submit" and a triaged
/// ticket appearing on a clerk's dashboard. Persist → classify → route → duplicate-scan → acknowledge.
///
/// Ordering matters. The report is written first and never rolled back on an AI failure: losing a
/// citizen's report because a model call timed out would be the worst possible failure mode for a
/// civic reporting tool.
/// </summary>
public class ReportTriageService(
    AppDbContext db,
    IReportClassifier classifier,
    IPhotoStorage photoStorage,
    DuplicateDetectionService duplicates,
    SystemicPatternDetectionService patterns,
    PhotoReuseDetectionService photoReuse,
    GpsMismatchService gpsMismatch,
    Ai.FraudSignalService fraud,
    ReportWorkflow workflow,
    IRealtimeBroadcaster realtime,
    ILogger<ReportTriageService> logger)
{
    // Bounds how many photos get sent to the vision model per report — cost/latency control, not a
    // product limit. A report can still attach more photos than this; only the first few get analysed.
    private const int MaxClassificationImages = 3;

    public async Task<TriageOutcome> SubmitAsync(
        CreateReportRequest request, CitizenUser reporter, CancellationToken ct = default)
    {
        var municipality = await db.Municipalities.OrderBy(m => m.Id).FirstAsync(ct);

        var categories = await db.Categories
            .AsNoTracking()
            .Include(c => c.DefaultDepartment!).ThenInclude(d => d.DefaultAssignee)
            .Where(c => c.MunicipalityId == municipality.Id)
            .OrderBy(c => c.SortOrder)
            .ToListAsync(ct);

        var taxonomy = categories
            .Select(c => new TaxonomyEntry(c.Code, c.NameSq, c.NameEn, c.Description))
            .ToList();

        // Read every attached photo once, up front — the classifier only looks at the first few
        // (cost/latency bound), but hashing is free enough that every photo gets one, not just those.
        var photoUrls = request.PhotoUrls.Where(u => !string.IsNullOrWhiteSpace(u)).Select(u => u.Trim()).Take(5).ToList();
        var readPhotos = new List<(string Url, byte[] Data, string ContentType)>();
        foreach (var url in photoUrls)
        {
            var photo = await photoStorage.ReadAsync(url, ct);
            if (photo is { } p) readPhotos.Add((url, p.Data, p.ContentType));
        }

        var images = readPhotos
            .Take(MaxClassificationImages)
            .Select(p => new ClassificationImage(p.Data, p.ContentType))
            .ToList();

        var classification = await classifier.ClassifyAsync(
            new ClassificationRequest(request.Description, request.AddressText, request.CategoryCodeHint, taxonomy, images),
            ct);

        var category = categories.FirstOrDefault(c => c.Code == classification.CategoryCode)
                       ?? categories.First(c => c.Code == "other");

        var report = new Report
        {
            PublicRef = await workflow.NextPublicRefAsync(municipality, ct),
            MunicipalityId = municipality.Id,
            Title = classification.SuggestedTitle ?? RuleBasedReportClassifier.BuildTitle(request.Description),
            TitleEn = classification.SuggestedTitleEn,
            Description = request.Description.Trim(),
            DescriptionSq = classification.DescriptionSq,
            DescriptionEn = classification.DescriptionEn,
            CategoryId = category.Id,
            // Routing: the category owns its default department, so onboarding a new municipality is a
            // seed script rather than a code change.
            DepartmentId = category.DefaultDepartmentId,
            Status = ReportStatus.Submitted,
            Priority = classification.Priority,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            AddressText = request.AddressText?.Trim(),
            // Attribution comes from the authenticated account, never from the request body — a
            // caller cannot file a report under someone else's name. The name is denormalised so it
            // survives a later rename and so list queries never need a join just to show it.
            ReporterUserId = reporter.Id,
            // The handle, not the name. This is the line that decides whether a complaint travels
            // through the municipality with its author attached to it.
            ReporterLabel = reporter.Pseudonym,

            AiSuggestedCategoryId = category.Id,
            AiSuggestedPriority = classification.Priority,
            AiConfidence = classification.Confidence,
            AiReasoning = classification.Reasoning,
            AiReasoningEn = classification.ReasoningEn,
            AiSummarySq = classification.SummarySq,
            AiModel = classification.Model,
            ClassificationSource = classification.Source
        };

        db.Reports.Add(report);

        foreach (var (url, data, _) in readPhotos)
        {
            report.Photos.Add(new ReportPhoto
            {
                ReportId = report.Id,
                Url = url,
                PerceptualHash = PhotoReuseDetectionService.ComputeHash(data, logger),
            });
        }

        // Fully deterministic strings on the one path every citizen submission runs through — noteEn is
        // handed over explicitly everywhere here rather than left to the translator, so filing a report
        // never costs an extra AI call for text that never varies.
        await workflow.AppendHistoryAsync(report, null, ReportStatus.Submitted,
            "Raporti u pranua nga aplikacioni.", null, isSystem: true,
            noteEn: "The report was received by the app.", ct: ct);

        // Auto-acknowledge only when the AI is confident. A low-confidence classification stays in
        // Submitted so it lands in the clerk's "needs a human look" filter rather than being routed
        // on a guess — this is the honest-about-limitations behaviour, implemented rather than claimed.
        if (!classification.IsLowConfidence)
        {
            await workflow.ChangeStatus(report, ReportStatus.InReview,
                "Kategorizuar automatikisht dhe drejtuar drejtorisë përgjegjëse.", null, isSystem: true,
                noteEn: "Automatically categorized and routed to the responsible department.", ct: ct);

            // The department is routing; this is who actually gets the case the moment it lands there.
            // Only fires when the department has a configured default — `public_spaces` and `other`
            // have no staff seeded yet, so those reports correctly stop at InReview for a clerk to pick
            // someone, rather than being confidently assigned to nobody.
            var defaultAssignee = category.DefaultDepartment?.DefaultAssigneeStaffId;
            if (defaultAssignee is { } assigneeId)
            {
                report.AssignedToStaffId = assigneeId;
                // Also the navigation, not just the id: ToDto() reads AssignedToStaff to build the
                // response, and this request returns `report` straight from memory — never re-fetched
                // with a fresh Include — so skipping this is exactly how a citizen who was in fact
                // auto-assigned would see "no one assigned yet" in the response to their own submission.
                report.AssignedToStaff = category.DefaultDepartment!.DefaultAssignee;
                await workflow.ChangeStatus(report, ReportStatus.Assigned,
                    $"Caktuar automatikisht te {category.DefaultDepartment!.DefaultAssignee!.FullName}, " +
                    $"sipas rregullave të drejtimit për kategorinë '{category.NameSq}'.",
                    null, isSystem: true, bypassTransitionCheck: true,
                    noteEn: $"Automatically assigned to {category.DefaultDepartment!.DefaultAssignee!.FullName}, " +
                            $"per the routing rules for category '{category.NameEn}'.",
                    ct: ct);
            }
        }
        else
        {
            logger.LogInformation(
                "Report {Ref} classified with low confidence ({Confidence:P0}) — held for manual review.",
                report.PublicRef, classification.Confidence);
        }

        var candidates = await duplicates.ScanAsync(report, ct);
        var pattern = await patterns.EvaluateAsync(report, category, ct);
        if (pattern is not null) realtime.PatternChanged(pattern.Id, RealtimeActions.Created);

        // Every fraud signal lands in the same place — never surfaced to the citizen, staff-only review
        // queue, same "system proposes, human decides" shape as the pattern and duplicate lenses above.
        var fraudFlags = new List<FraudFlag>();
        fraudFlags.AddRange(await photoReuse.ScanAsync(report, ct));
        fraudFlags.AddRange(gpsMismatch.Evaluate(report));
        if (await duplicates.ScanForTemplatedTextAsync(report, ct) is { } templatedText)
            fraudFlags.Add(templatedText);
        fraudFlags.AddRange(await fraud.AnalyzeAsync(report, images, ct));

        foreach (var flag in fraudFlags)
        {
            db.FraudFlags.Add(flag);
            realtime.FraudFlagged(flag.Id, RealtimeActions.Created);
        }

        realtime.ReportChanged(report, RealtimeActions.Created);

        await db.SaveChangesAsync(ct);
        // This service owns the transaction the whole submission runs in, so it also owns sending the
        // events queued during it — including the auto-acknowledge ChangeStatus above.
        await realtime.FlushAsync(ct);

        // Reload the navigation properties the DTO mapper needs for the response.
        await db.Entry(report).Reference(r => r.Category).LoadAsync(ct);
        await db.Entry(report).Reference(r => r.Department).LoadAsync(ct);

        return new TriageOutcome(report, classification, candidates, pattern);
    }
}
