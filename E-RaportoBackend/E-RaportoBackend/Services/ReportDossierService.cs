using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using PIC = DocumentFormat.OpenXml.Drawing.Pictures;
// OpenXml has its own w:category element; in this file "Category" always means the domain taxonomy.
using Category = E_RaportoBackend.Domain.Category;

namespace E_RaportoBackend.Services;

public record ReportDossier(byte[] Content, string FileName);

/// <summary>
/// Builds the printable case file a clerk hands over, files, or attaches to a work order once a report
/// is closed: what was reported, what was done, how long it took against the department's own target,
/// and what the AI contributed — in one Word document.
///
/// Two deliberate choices:
///   · Everything is rendered server-side from the entities, so the mobile app and the dashboard get a
///     byte-identical document. A municipal file that differed depending on which screen produced it
///     would be worthless as a record.
///   · Timestamps are converted to Elbasan local time. The database is UTC, but a document that will be
///     printed and signed must show the time the person signing it actually experienced.
/// </summary>
public class ReportDossierService(
    AppDbContext db, IPhotoStorage photoStorage, ILogger<ReportDossierService> logger)
{
    // The product's own palette (see mobile-app/src/theme.ts and the landing page), so a printed
    // dossier is recognisably the same system the citizen used.
    private const string Navy = "0B2545";
    private const string Brand = "1D4E89";
    private const string Ink = "14181F";
    private const string Muted = "6B7684";
    private const string HairLine = "D8DEE7";
    private const string LabelFill = "F1F4F9";

    private const int PageWidthTwips = 9638;      // A4 minus 2cm margins each side
    private const int LabelColTwips = 3100;
    private const int ValueColTwips = PageWidthTwips - LabelColTwips;

    private const long MaxImageWidthEmu = 5669280;   // 6.2"
    private const long MaxImageHeightEmu = 4114800;  // 4.5" — a portrait photo must not eat a whole page

    /// <summary>Null when the report does not exist. Any status is allowed: staff sometimes need the
    /// file for an open case too — the clients are what surface the option on resolution.</summary>
    public async Task<ReportDossier?> BuildAsync(Guid reportId, StaffUser generatedBy, CancellationToken ct = default)
    {
        var report = await db.Reports
            .AsNoTracking()
            .Include(r => r.Category)
            .Include(r => r.Department)
            .Include(r => r.AssignedToStaff)
            .Include(r => r.Municipality)
            .Include(r => r.Photos)
            .FirstOrDefaultAsync(r => r.Id == reportId, ct);

        if (report is null) return null;

        var history = await db.ReportStatusHistory.AsNoTracking()
            .Where(h => h.ReportId == report.Id)
            .OrderBy(h => h.CreatedAt)
            .ToListAsync(ct);

        var aiCategory = report.AiSuggestedCategoryId is { } aiCatId
            ? await db.Categories.AsNoTracking().FirstOrDefaultAsync(c => c.Id == aiCatId, ct)
            : null;

        var mergedIn = await db.Reports.AsNoTracking()
            .Where(r => r.MergedIntoReportId == report.Id)
            .Select(r => r.PublicRef)
            .ToListAsync(ct);

        // Latest rather than current-resolution-only, matching the detail endpoints: a dossier printed
        // after a reopen should still carry the dispute that caused the reopen.
        var verification = await db.ResolutionVerifications.AsNoTracking()
            .Where(v => v.ReportId == report.Id)
            .OrderByDescending(v => v.CreatedAt)
            .FirstOrDefaultAsync(ct);

        var benchmark = await BuildBenchmarkAsync(report, ct);
        var images = await LoadPhotosAsync(report, ct);
        var afterImage = verification?.PhotoUrl is { } afterUrl
            ? await LoadImageAsync(afterUrl, report.PublicRef, ct)
            : null;

        var pattern = report.SystemicPatternId is { } patternId
            ? await db.SystemicPatterns.AsNoTracking()
                .Include(p => p.Members)
                .FirstOrDefaultAsync(p => p.Id == patternId, ct)
            : null;

        var bytes = Render(
            report, history, aiCategory, mergedIn, benchmark, images, afterImage, verification, pattern, generatedBy);

        logger.LogInformation("Dossier generated for {Ref} by {Staff} ({Bytes} bytes)",
            report.PublicRef, generatedBy.FullName, bytes.Length);

        return new ReportDossier(bytes, $"Dosje-{report.PublicRef}.docx");
    }

    /* ── Data preparation ──────────────────────────────────────────────────── */

    private sealed record Benchmark(double? CategoryAvgHours, double? DepartmentAvgHours, int CategorySample, int DepartmentSample);

    /// <summary>
    /// How this case compares with everything else the municipality has already closed. One query, then
    /// averaged in memory: at municipal volumes that is cheaper than teaching the provider to average an
    /// interval, and it keeps the maths visible here rather than buried in generated SQL.
    /// </summary>
    private async Task<Benchmark> BuildBenchmarkAsync(Report report, CancellationToken ct)
    {
        var closed = await db.Reports.AsNoTracking()
            .Where(r => r.MunicipalityId == report.MunicipalityId
                        && r.Status == ReportStatus.Resolved
                        && r.ResolvedAt != null)
            .Select(r => new { r.Id, r.CategoryId, r.DepartmentId, r.CreatedAt, r.ResolvedAt })
            .ToListAsync(ct);

        // The case being printed is excluded so it is never compared against itself.
        var others = closed.Where(r => r.Id != report.Id).ToList();

        var sameCategory = others
            .Where(r => report.CategoryId != null && r.CategoryId == report.CategoryId)
            .Select(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalHours)
            .ToList();

        var sameDepartment = others
            .Where(r => report.DepartmentId != null && r.DepartmentId == report.DepartmentId)
            .Select(r => (r.ResolvedAt!.Value - r.CreatedAt).TotalHours)
            .ToList();

        return new Benchmark(
            sameCategory.Count > 0 ? sameCategory.Average() : null,
            sameDepartment.Count > 0 ? sameDepartment.Average() : null,
            sameCategory.Count,
            sameDepartment.Count);
    }

    private sealed record EmbeddedImage(byte[] Jpeg, int Width, int Height);

    /// <summary>
    /// Photos are re-encoded to JPEG at a print-sane size before they go in. Word will not reliably
    /// render WebP, and an untouched 8 MB phone photo would make the file unusable over email.
    /// </summary>
    private async Task<List<EmbeddedImage>> LoadPhotosAsync(Report report, CancellationToken ct)
    {
        var result = new List<EmbeddedImage>();

        foreach (var photo in report.Photos.OrderBy(p => p.CreatedAt).Take(4))
        {
            if (await LoadImageAsync(photo.Url, report.PublicRef, ct) is { } image) result.Add(image);
        }

        return result;
    }

    private async Task<EmbeddedImage?> LoadImageAsync(string url, string publicRef, CancellationToken ct)
    {
        var stored = await photoStorage.ReadAsync(url, ct);
        if (stored is not { } file) return null;

        try
        {
            using var image = SixLabors.ImageSharp.Image.Load(file.Data);
            if (image.Width > 1400 || image.Height > 1400)
            {
                image.Mutate(x => x.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new SixLabors.ImageSharp.Size(1400, 1400)
                }));
            }

            using var ms = new MemoryStream();
            image.Save(ms, new JpegEncoder { Quality = 82 });
            return new EmbeddedImage(ms.ToArray(), image.Width, image.Height);
        }
        catch (Exception ex)
        {
            // One unreadable photo must not cost the clerk the whole document.
            logger.LogWarning(ex, "Skipping unreadable photo {Url} for dossier {Ref}", url, publicRef);
            return null;
        }
    }

    /* ── Rendering ─────────────────────────────────────────────────────────── */

    private byte[] Render(
        Report report,
        List<ReportStatusHistory> history,
        Category? aiCategory,
        List<string> mergedIn,
        Benchmark benchmark,
        List<EmbeddedImage> images,
        EmbeddedImage? afterImage,
        ResolutionVerification? verification,
        SystemicPattern? pattern,
        StaffUser generatedBy)
    {
        using var stream = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(stream, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            main.Document = new Document();
            AddStyles(main);

            var body = new Body();

            AddTitleBlock(body, report, generatedBy);
            AddSummary(body, report);
            AddProblem(body, report);
            AddPhotos(body, main, images, afterImage);
            AddTimeline(body, report);
            AddVerification(body, report, verification);
            AddPattern(body, report, pattern);
            AddBenchmark(body, report, benchmark);
            AddAi(body, report, aiCategory);
            AddReporter(body, report, mergedIn);
            AddHistory(body, history);
            AddSignatures(body);

            body.AppendChild(SectionProperties(main));
            main.Document.AppendChild(body);
        }

        return stream.ToArray();
    }

    private static void AddStyles(MainDocumentPart main)
    {
        var part = main.AddNewPart<StyleDefinitionsPart>();
        part.Styles = new Styles(
            new DocDefaults(
                new RunPropertiesDefault(
                    new RunPropertiesBaseStyle(
                        new RunFonts { Ascii = "Calibri", HighAnsi = "Calibri", ComplexScript = "Calibri" },
                        new Color { Val = Ink },
                        new FontSize { Val = "20" },
                        new FontSizeComplexScript { Val = "20" })),
                new ParagraphPropertiesDefault(
                    new ParagraphPropertiesBaseStyle(
                        new SpacingBetweenLines { After = "0", Line = "264", LineRule = LineSpacingRuleValues.Auto }))));
    }

    private static SectionProperties SectionProperties(MainDocumentPart main)
    {
        var footer = main.AddNewPart<FooterPart>();
        footer.Footer = new Footer(
            new Paragraph(
                new ParagraphProperties(
                    new Tabs(new TabStop { Val = TabStopValues.Right, Position = PageWidthTwips }),
                    new Justification { Val = JustificationValues.Left }),
                Run("Gjeneruar automatikisht nga sistemi E-Raporto", 15, color: Muted),
                new Run(new TabChar()),
                Run("Faqe ", 15, color: Muted),
                new Run(new FieldChar { FieldCharType = FieldCharValues.Begin }),
                new Run(new FieldCode(" PAGE ") { Space = SpaceProcessingModeValues.Preserve }),
                new Run(new FieldChar { FieldCharType = FieldCharValues.End })));

        // Header/footer references must precede pgSz in sectPr, or Word rejects the part.
        return new SectionProperties(
            new FooterReference { Type = HeaderFooterValues.Default, Id = main.GetIdOfPart(footer) },
            new PageSize { Width = 11906U, Height = 16838U },
            new PageMargin
            {
                Top = 1134, Right = 1134U, Bottom = 1134, Left = 1134U,
                Header = 567U, Footer = 567U, Gutter = 0U
            });
    }

    /* ── Sections ──────────────────────────────────────────────────────────── */

    private static void AddTitleBlock(Body body, Report report, StaffUser generatedBy)
    {
        body.AppendChild(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { After = "40" }),
            Run((report.Municipality?.Name ?? "Bashkia").ToUpperInvariant(), 18, bold: true, color: Brand, spacing: 60)));

        body.AppendChild(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { After = "140" }),
            Run("DOSJE E RASTIT", 34, bold: true, color: Navy)));

        // A ruled line drawn as a paragraph border — a one-row table used as a rule prints unevenly.
        body.AppendChild(new Paragraph(
            new ParagraphProperties(
                new ParagraphBorders(new BottomBorder
                {
                    Val = BorderValues.Single, Color = Brand, Size = 12U, Space = 1U
                }),
                new SpacingBetweenLines { After = "160" })));

        var table = FixedTable(3100, PageWidthTwips - 3100);
        table.AppendChild(KeyValue("Numri i referencës", report.PublicRef, valueBold: true));
        table.AppendChild(KeyValue("Statusi aktual", StatusLabel(report.Status)));
        table.AppendChild(KeyValue("Dokumenti u gjenerua", $"{Local(DateTime.UtcNow, report):dd.MM.yyyy HH:mm} nga {generatedBy.FullName}"));
        body.AppendChild(table);
        body.AppendChild(Spacer());
    }

    private static void AddSummary(Body body, Report report)
    {
        body.AppendChild(Heading("1. Përmbledhje e rastit"));

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Titulli", report.Title));
        table.AppendChild(KeyValue("Kategoria", report.Category?.NameSq ?? "—"));
        table.AppendChild(KeyValue("Prioriteti", PriorityLabel(report.Priority)));
        table.AppendChild(KeyValue("Drejtoria përgjegjëse", report.Department is null
            ? "E pacaktuar"
            : $"{report.Department.Name} ({report.Department.ShortName})"));
        table.AppendChild(KeyValue("Punonjësi i caktuar", report.AssignedToStaff is null
            ? "I pacaktuar"
            : $"{report.AssignedToStaff.FullName}{(string.IsNullOrWhiteSpace(report.AssignedToStaff.JobTitle) ? "" : $" — {report.AssignedToStaff.JobTitle}")}"));
        body.AppendChild(table);
        body.AppendChild(Spacer());
    }

    private static void AddProblem(Body body, Report report)
    {
        body.AppendChild(Heading("2. Përshkrimi i problemit"));

        body.AppendChild(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { After = "140" }),
            Run(report.Description, 21)));

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Adresa / pika e referencës", string.IsNullOrWhiteSpace(report.AddressText)
            ? "E pashënuar"
            : report.AddressText));
        table.AppendChild(KeyValue("Koordinatat", $"{report.Latitude:F6}, {report.Longitude:F6}"));
        body.AppendChild(table);
        body.AppendChild(Spacer());
    }

    private static void AddPhotos(
        Body body, MainDocumentPart main, List<EmbeddedImage> images, EmbeddedImage? afterImage)
    {
        body.AppendChild(Heading("3. Dokumentimi fotografik"));

        if (images.Count == 0 && afterImage is null)
        {
            body.AppendChild(Note("Nuk ka fotografi të bashkëngjitura këtij raporti."));
            body.AppendChild(Spacer());
            return;
        }

        uint id = 1;
        foreach (var image in images)
        {
            AddPhoto(body, main, image, id,
                $"Fotografia {id} — dërguar nga qytetari me raportin (para ndërhyrjes).");
            id++;
        }

        // The "after" shot goes here rather than in the verification section on purpose: a before and an
        // after belong on the same pages, and a reader flipping through the photo documentation should
        // reach the end of it already knowing how the case looks now.
        if (afterImage is not null)
        {
            AddPhoto(body, main, afterImage, id,
                "Fotografia e verifikimit — dërguar nga raportuesi pasi bashkia e shënoi rastin si të zgjidhur.");
        }

        body.AppendChild(Spacer());
    }

    private static void AddPhoto(
        Body body, MainDocumentPart main, EmbeddedImage image, uint id, string caption)
    {
        var part = main.AddImagePart(ImagePartType.Jpeg);
        using (var ms = new MemoryStream(image.Jpeg)) part.FeedData(ms);

        var (cx, cy) = Fit(image.Width, image.Height);

        body.AppendChild(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { After = "60" }),
            new Run(InlineImage(main.GetIdOfPart(part), cx, cy, id, $"Fotoja {id}"))));

        body.AppendChild(new Paragraph(
            new ParagraphProperties(new SpacingBetweenLines { After = "160" }),
            Run(caption, 16, color: Muted, italic: true)));
    }

    private static void AddTimeline(Body body, Report report)
    {
        body.AppendChild(Heading("4. Kronologjia dhe performanca"));

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Raportuar", Stamp(report.CreatedAt, report)));
        table.AppendChild(KeyValue("Pranuar në shqyrtim", Stamp(report.AcknowledgedAt, report)));
        table.AppendChild(KeyValue("Caktuar", Stamp(report.AssignedAt, report)));
        table.AppendChild(KeyValue("Zgjidhur", Stamp(report.ResolvedAt, report)));
        body.AppendChild(table);

        body.AppendChild(Spacer(80));

        var metrics = FixedTable(LabelColTwips, ValueColTwips);
        metrics.AppendChild(KeyValue("Koha deri në pranim", Span(report.CreatedAt, report.AcknowledgedAt)));
        metrics.AppendChild(KeyValue("Koha deri në caktim", Span(report.CreatedAt, report.AssignedAt)));
        metrics.AppendChild(KeyValue("Koha e punës (nga caktimi te zgjidhja)", Span(report.AssignedAt, report.ResolvedAt)));
        metrics.AppendChild(KeyValue("Kohëzgjatja totale", Span(report.CreatedAt, report.ResolvedAt), valueBold: true));

        if (report.Department is { } dept)
        {
            var due = report.CreatedAt.AddHours(dept.SlaHours);
            metrics.AppendChild(KeyValue("Afati i synuar (SLA)", $"{dept.SlaHours} orë — deri më {Local(due, report):dd.MM.yyyy HH:mm}"));

            if (report.ResolvedAt is { } resolved)
            {
                var breached = resolved > due;
                var delta = Humanise((resolved - due).Duration());
                metrics.AppendChild(KeyValue(
                    "Respektimi i afatit",
                    breached ? $"I TEJKALUAR me {delta}" : $"Brenda afatit ({delta} para skadimit)",
                    valueBold: true,
                    valueColor: breached ? "B42318" : "15803D"));
            }
        }
        else
        {
            metrics.AppendChild(KeyValue("Afati i synuar (SLA)", "Nuk ka drejtori të caktuar, prandaj nuk ka afat."));
        }

        body.AppendChild(metrics);
        body.AppendChild(Spacer());
    }

    /// <summary>
    /// What the person who reported it said about the fix. Its own numbered section, immediately after
    /// the municipality's own timings, because the two belong side by side: section 4 is how fast we say
    /// we closed it, and this is whether the closure was real.
    /// </summary>
    private static void AddVerification(Body body, Report report, ResolutionVerification? verification)
    {
        body.AppendChild(Heading("5. Verifikimi i zgjidhjes nga qytetari"));

        if (verification is null)
        {
            body.AppendChild(Note(report.Status == ReportStatus.Resolved
                ? "Raportuesi është pyetur nëse problemi është rregulluar, por ende nuk është përgjigjur. "
                  + "Ky rast numërohet si i pazgjidhur nga qytetari në statistikat e bashkisë."
                : "Ky rast nuk është shënuar ende si i zgjidhur, prandaj nuk është kërkuar verifikim."));
            body.AppendChild(Spacer());
            return;
        }

        var confirmed = verification.Outcome == VerificationOutcome.Confirmed;
        // A verdict about an earlier closure is still worth printing — it is usually why the case was
        // reopened — but it must not read as a statement about the report's present state.
        var current = report.ResolvedAt is not null && verification.ResolvedAt == report.ResolvedAt;

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Përgjigja e raportuesit", confirmed
            ? "PO — problemi është rregulluar"
            : "JO — sipas raportuesit problemi vazhdon"));
        table.AppendChild(KeyValue("Data e verifikimit", Stamp(verification.CreatedAt, report)));
        table.AppendChild(KeyValue("Zgjidhja e verifikuar", Stamp(verification.ResolvedAt, report)
            + (current ? "" : " (zgjidhje e mëparshme — rasti është rihapur më pas)")));
        table.AppendChild(KeyValue("Fotografi verifikuese", verification.PhotoUrl is null
            ? "Nuk u dërgua"
            : "Po — shih seksionin 3"));
        table.AppendChild(KeyValue("Distanca nga pika e raportuar", verification.DistanceMeters is { } d
            ? $"{d:0} m" + (d <= Mapping.VerificationRadiusMeters
                ? " — brenda vendndodhjes së raportuar"
                : " — jashtë rrezes së pritur")
            : "E panjohur (pajisja nuk dha vendndodhje)"));
        table.AppendChild(KeyValue("Koment i raportuesit", string.IsNullOrWhiteSpace(verification.Comment)
            ? "Pa koment"
            : verification.Comment));
        body.AppendChild(table);

        body.AppendChild(Note(confirmed
            ? "Verifikimi është dhënë nga personi që e ka hapur raportin, jo nga stafi i bashkisë. "
              + "Ai nuk zëvendëson pranimin teknik të punës."
            : "Kontestimi nuk e rihap automatikisht rastin: vendimin e merr stafi. Ai regjistrohet "
              + "përgjithmonë në historikun e rastit dhe zbret nga norma e zgjidhjeve të verifikuara."));
        body.AppendChild(Spacer());
    }

    /// <summary>
    /// Whether this case has been grouped with others as a possible shared cause or a wider structural
    /// condition. Printed with the same caution as the AI classification block below it: a stated
    /// confidence, never a bare assertion, and the sibling references so a reader can go verify.
    /// </summary>
    private static void AddPattern(Body body, Report report, SystemicPattern? pattern)
    {
        body.AppendChild(Heading("6. Model sistemik i mundshëm"));

        if (pattern is null)
        {
            body.AppendChild(Note("Ky rast nuk është grupuar me raporte të tjera si pjesë e një modeli sistemik."));
            body.AppendChild(Spacer());
            return;
        }

        var typeLabel = pattern.AiConnectionType switch
        {
            ConnectionType.SharedCause => "Shkak i përbashkët i mundshëm — një ndërhyrje e vetme mund t'i zgjidhë të gjitha",
            ConnectionType.SystemicCondition => "Kusht sistemik — shkaqe lokale të ndryshme, por model strukturor më i gjerë",
            ConnectionType.Uncertain => "E pasigurt — nevojitet inspektim në terren",
            _ => "Pa sintezë nga AI — numërim i thjeshtë raportesh"
        };

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Lloji i lidhjes", typeLabel));
        table.AppendChild(KeyValue("Numri i rasteve në model", pattern.MemberCount.ToString()));
        table.AppendChild(KeyValue("Statusi i shqyrtimit", pattern.ReviewStatus switch
        {
            PatternReviewStatus.Acknowledged => "Pranuar nga stafi",
            PatternReviewStatus.Dismissed => "Shpërfillur si rast i rremë",
            _ => "Në pritje të shqyrtimit"
        }));
        if (pattern.AiConfidence is { } conf) table.AppendChild(KeyValue("Siguria e AI-së", $"{conf:P0}"));
        table.AppendChild(KeyValue("Raste të tjera në këtë model", string.Join(", ",
            pattern.Members.Where(m => m.Id != report.Id).Select(m => m.PublicRef).DefaultIfEmpty("—"))));
        body.AppendChild(table);

        if (!string.IsNullOrWhiteSpace(pattern.AiSummarySq))
        {
            body.AppendChild(Spacer(80));
            body.AppendChild(new Paragraph(
                new ParagraphProperties(new SpacingBetweenLines { After = "80" }),
                Run(pattern.AiSummarySq, 21, italic: true)));
        }

        body.AppendChild(Note(
            "Ky grupim nuk bashkon rastet — secili mbetet një çështje e veçantë që kërkon inspektim dhe "
            + "mbyllje të vetën. Grupimi është një këndvështrim shtesë për stafin, jo një vendim automatik."));
        body.AppendChild(Spacer());
    }

    private static void AddBenchmark(Body body, Report report, Benchmark benchmark)
    {
        body.AppendChild(Heading("7. Krahasim me mesataret e bashkisë"));

        if (report.ResolvedAt is not { } resolvedAt)
        {
            body.AppendChild(Note("Rasti nuk është ende i zgjidhur, prandaj krahasimi nuk llogaritet."));
            body.AppendChild(Spacer());
            return;
        }

        var hours = (resolvedAt - report.CreatedAt).TotalHours;
        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Ky rast", Humanise(TimeSpan.FromHours(hours)), valueBold: true));

        table.AppendChild(KeyValue(
            $"Mesatarja për kategorinë «{report.Category?.NameSq ?? "—"}»",
            Compare(hours, benchmark.CategoryAvgHours, benchmark.CategorySample)));

        table.AppendChild(KeyValue(
            $"Mesatarja për {report.Department?.ShortName ?? "drejtorinë"}",
            Compare(hours, benchmark.DepartmentAvgHours, benchmark.DepartmentSample)));

        body.AppendChild(table);
        body.AppendChild(Spacer());
    }

    private static void AddAi(Body body, Report report, Category? aiCategory)
    {
        body.AppendChild(Heading("8. Vlerësimi i inteligjencës artificiale"));

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Motori klasifikues", report.ClassificationSource switch
        {
            ClassificationSource.Llm => "Inteligjencë artificiale (model gjuhësor)",
            ClassificationSource.Manual => "Vendosur manualisht nga stafi",
            _ => "Rregulla deterministe (fjalë kyçe)"
        }));
        table.AppendChild(KeyValue("Modeli", string.IsNullOrWhiteSpace(report.AiModel) ? "—" : report.AiModel));

        if (report.AiConfidence is { } confidence)
        {
            var low = confidence < 0.65;
            table.AppendChild(KeyValue(
                "Siguria e klasifikimit",
                $"{confidence * 100:F0}%{(low ? " — nën pragun 65%, u kërkua shqyrtim njerëzor" : "")}",
                valueColor: low ? "B54708" : null));
        }

        table.AppendChild(KeyValue("Kategoria e sugjeruar", aiCategory?.NameSq ?? "—"));
        table.AppendChild(KeyValue("Kategoria përfundimtare", report.Category?.NameSq ?? "—"));
        table.AppendChild(KeyValue("Korrigjuar nga stafi", report.IsCategoryOverridden
            ? $"Po{(string.IsNullOrWhiteSpace(report.OverrideReason) ? "" : $" — {report.OverrideReason}")}"
            : "Jo"));

        if (!string.IsNullOrWhiteSpace(report.AiSummarySq))
            table.AppendChild(KeyValue("Përmbledhja", report.AiSummarySq));

        if (!string.IsNullOrWhiteSpace(report.AiReasoning))
            table.AppendChild(KeyValue("Arsyetimi", report.AiReasoning));

        body.AppendChild(table);
        body.AppendChild(Spacer());
    }

    /// <summary>
    /// The reporter section, which deliberately contains no reporter.
    /// </summary>
    /// <remarks>
    /// This used to print the citizen's name, email and telephone into a signed municipal document that
    /// then circulates by email and on paper — the single worst place in the system for an identity to
    /// end up, and the one hardest to recall once it has. It now prints the handle and says plainly why.
    /// </remarks>
    private static void AddReporter(Body body, Report report, List<string> mergedIn)
    {
        body.AppendChild(Heading("9. Raportuesi"));

        var table = FixedTable(LabelColTwips, ValueColTwips);
        table.AppendChild(KeyValue("Identifikuesi", $"Qytetari {report.ReporterLabel}"));
        table.AppendChild(KeyValue("Konfirmime nga qytetarë të tjerë", report.ConfirmationCount.ToString()));
        table.AppendChild(KeyValue("Raporte të bashkuara në këtë rast", mergedIn.Count == 0
            ? "Asnjë"
            : $"{mergedIn.Count} — {string.Join(", ", mergedIn)}"));
        body.AppendChild(table);

        body.AppendChild(Note(
            "Raportimet në E-Raporto janë pseudonime. Raportuesi ka një llogari të regjistruar dhe të "
            + "verifikuar, por emri, email-i dhe telefoni i tij nuk i shfaqen asnjë punonjësi të bashkisë "
            + "dhe nuk gjenden në asnjë ekran, eksport apo dokument të sistemit. Kjo mbron qytetarin nga "
            + "hakmarrja dhe e mbron bashkinë nga dyshimi se rastet trajtohen sipas personit që i hap."));
        body.AppendChild(Spacer());
    }

    private static void AddHistory(Body body, List<ReportStatusHistory> history)
    {
        body.AppendChild(Heading("10. Historiku i plotë i rastit"));

        var table = FixedTable(1900, 1900, 3939, 1899);
        table.AppendChild(new TableRow(
            HeaderCell("Data", 1900), HeaderCell("Statusi", 1900),
            HeaderCell("Shënimi", 3939), HeaderCell("Vepruesi", 1899)));

        foreach (var entry in history)
        {
            table.AppendChild(new TableRow(
                BodyCell(entry.CreatedAt.ToLocalMunicipal().ToString("dd.MM.yyyy HH:mm"), 1900),
                BodyCell(StatusLabel(entry.ToStatus), 1900),
                BodyCell(string.IsNullOrWhiteSpace(entry.Note) ? "—" : entry.Note, 3939),
                BodyCell(entry.ChangedByLabel, 1899)));
        }

        body.AppendChild(table);
        body.AppendChild(Spacer());
    }

    private static void AddSignatures(Body body)
    {
        body.AppendChild(new Paragraph(
            new ParagraphProperties(
                new ParagraphBorders(new TopBorder { Val = BorderValues.Single, Color = HairLine, Size = 6U, Space = 1U }),
                new SpacingBetweenLines { Before = "240", After = "240" })));

        var table = FixedTable(4819, 4819);
        table.AppendChild(new TableRow(
            BorderlessCell("Punonjësi përgjegjës", 4819, bold: true),
            BorderlessCell("Drejtori i drejtorisë", 4819, bold: true)));
        table.AppendChild(new TableRow(
            BorderlessCell("\n_______________________\nEmri, mbiemri dhe firma", 4819, color: Muted),
            BorderlessCell("\n_______________________\nEmri, mbiemri dhe firma", 4819, color: Muted)));

        body.AppendChild(table);
    }

    /* ── Building blocks ───────────────────────────────────────────────────── */

    private static Paragraph Heading(string text) => new(
        new ParagraphProperties(
            new KeepNext(),
            new SpacingBetweenLines { Before = "120", After = "120" }),
        Run(text, 24, bold: true, color: Navy));

    private static Paragraph Note(string text) => new(
        new ParagraphProperties(new SpacingBetweenLines { Before = "80", After = "40" }),
        Run(text, 16, color: Muted, italic: true));

    private static Paragraph Spacer(string after = "220") => new(
        new ParagraphProperties(new SpacingBetweenLines { After = after }));

    private static Paragraph Spacer(int after) => Spacer(after.ToString());

    private static Run Run(
        string text, int halfPoints, bool bold = false, string? color = null,
        bool italic = false, int? spacing = null)
    {
        var properties = new RunProperties();
        if (bold) properties.AppendChild(new Bold());
        if (italic) properties.AppendChild(new Italic());
        if (color is not null) properties.AppendChild(new Color { Val = color });
        if (spacing is { } s) properties.AppendChild(new Spacing { Val = s });
        properties.AppendChild(new FontSize { Val = halfPoints.ToString() });
        properties.AppendChild(new FontSizeComplexScript { Val = halfPoints.ToString() });

        var run = new Run(properties);

        // Word keeps no line breaks inside a single w:t — each line has to be its own run child.
        var lines = text.Replace("\r\n", "\n").Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            if (i > 0) run.AppendChild(new Break());
            run.AppendChild(new Text(lines[i]) { Space = SpaceProcessingModeValues.Preserve });
        }

        return run;
    }

    private static Table FixedTable(params int[] columnWidths)
    {
        var table = new Table(
            new TableProperties(
                new TableWidth { Width = columnWidths.Sum().ToString(), Type = TableWidthUnitValues.Dxa },
                new TableBorders(
                    new TopBorder { Val = BorderValues.Single, Color = HairLine, Size = 4U },
                    new BottomBorder { Val = BorderValues.Single, Color = HairLine, Size = 4U },
                    new LeftBorder { Val = BorderValues.Single, Color = HairLine, Size = 4U },
                    new RightBorder { Val = BorderValues.Single, Color = HairLine, Size = 4U },
                    new InsideHorizontalBorder { Val = BorderValues.Single, Color = HairLine, Size = 4U },
                    new InsideVerticalBorder { Val = BorderValues.Single, Color = HairLine, Size = 4U }),
                new TableLayout { Type = TableLayoutValues.Fixed },
                new TableCellMarginDefault(
                    new TopMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
                    new BottomMargin { Width = "60", Type = TableWidthUnitValues.Dxa },
                    new TableCellLeftMargin { Width = 110, Type = TableWidthValues.Dxa },
                    new TableCellRightMargin { Width = 110, Type = TableWidthValues.Dxa })));

        var grid = new TableGrid();
        foreach (var width in columnWidths) grid.AppendChild(new GridColumn { Width = width.ToString() });
        table.AppendChild(grid);

        return table;
    }

    private static TableRow KeyValue(
        string label, string value, bool valueBold = false, string? valueColor = null) => new(
        new TableCell(
            new TableCellProperties(
                new TableCellWidth { Width = LabelColTwips.ToString(), Type = TableWidthUnitValues.Dxa },
                new Shading { Val = ShadingPatternValues.Clear, Fill = LabelFill },
                new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }),
            new Paragraph(Run(label, 17, color: Muted, bold: true))),
        new TableCell(
            new TableCellProperties(
                new TableCellWidth { Width = ValueColTwips.ToString(), Type = TableWidthUnitValues.Dxa },
                new TableCellVerticalAlignment { Val = TableVerticalAlignmentValues.Center }),
            new Paragraph(Run(value, 20, bold: valueBold, color: valueColor))));

    private static TableCell HeaderCell(string text, int width) => new(
        new TableCellProperties(
            new TableCellWidth { Width = width.ToString(), Type = TableWidthUnitValues.Dxa },
            new Shading { Val = ShadingPatternValues.Clear, Fill = LabelFill }),
        new Paragraph(Run(text, 16, bold: true, color: Navy)));

    private static TableCell BodyCell(string text, int width) => new(
        new TableCellProperties(new TableCellWidth { Width = width.ToString(), Type = TableWidthUnitValues.Dxa }),
        new Paragraph(Run(text, 17)));

    private static TableCell BorderlessCell(string text, int width, bool bold = false, string? color = null) => new(
        new TableCellProperties(
            new TableCellWidth { Width = width.ToString(), Type = TableWidthUnitValues.Dxa },
            new TableCellBorders(
                new TopBorder { Val = BorderValues.Nil }, new BottomBorder { Val = BorderValues.Nil },
                new LeftBorder { Val = BorderValues.Nil }, new RightBorder { Val = BorderValues.Nil })),
        new Paragraph(Run(text, 17, bold: bold, color: color)));

    private static (long Cx, long Cy) Fit(int width, int height)
    {
        var cx = MaxImageWidthEmu;
        var cy = (long)(MaxImageWidthEmu * (double)height / width);

        if (cy > MaxImageHeightEmu)
        {
            cy = MaxImageHeightEmu;
            cx = (long)(MaxImageHeightEmu * (double)width / height);
        }

        return (cx, cy);
    }

    private static Drawing InlineImage(string relationshipId, long cx, long cy, uint id, string name) => new(
        new DW.Inline(
            new DW.Extent { Cx = cx, Cy = cy },
            new DW.EffectExtent { LeftEdge = 0L, TopEdge = 0L, RightEdge = 0L, BottomEdge = 0L },
            new DW.DocProperties { Id = id, Name = name },
            new DW.NonVisualGraphicFrameDrawingProperties(new A.GraphicFrameLocks { NoChangeAspect = true }),
            new A.Graphic(
                new A.GraphicData(
                    new PIC.Picture(
                        new PIC.NonVisualPictureProperties(
                            new PIC.NonVisualDrawingProperties { Id = 0U, Name = name },
                            new PIC.NonVisualPictureDrawingProperties()),
                        new PIC.BlipFill(
                            new A.Blip { Embed = relationshipId },
                            new A.Stretch(new A.FillRectangle())),
                        new PIC.ShapeProperties(
                            new A.Transform2D(
                                new A.Offset { X = 0L, Y = 0L },
                                new A.Extents { Cx = cx, Cy = cy }),
                            new A.PresetGeometry(new A.AdjustValueList()) { Preset = A.ShapeTypeValues.Rectangle })))
                { Uri = "http://schemas.openxmlformats.org/drawingml/2006/picture" }))
        {
            DistanceFromTop = 0U, DistanceFromBottom = 0U,
            DistanceFromLeft = 0U, DistanceFromRight = 0U
        });

    /* ── Formatting ────────────────────────────────────────────────────────── */

    private static string Stamp(DateTime? utc, Report report) =>
        utc is { } value ? $"{Local(value, report):dd.MM.yyyy HH:mm}" : "—";

    private static DateTime Local(DateTime utc, Report report) =>
        utc.ToLocalMunicipal(report.Municipality?.Timezone);

    private static string Span(DateTime? from, DateTime? to) =>
        from is { } f && to is { } t && t >= f ? Humanise(t - f) : "—";

    /// <summary>Albanian keeps one form for ditë/orë; only minutë/minuta inflects.</summary>
    private static string Humanise(TimeSpan span)
    {
        if (span.TotalMinutes < 1) return "më pak se një minutë";
        if (span.TotalHours < 1) return $"{(int)span.TotalMinutes} {((int)span.TotalMinutes == 1 ? "minutë" : "minuta")}";
        if (span.TotalDays < 1) return span.Minutes == 0
            ? $"{(int)span.TotalHours} orë"
            : $"{(int)span.TotalHours} orë e {span.Minutes} min";

        var days = (int)span.TotalDays;
        return span.Hours == 0 ? $"{days} ditë" : $"{days} ditë e {span.Hours} orë";
    }

    private static string Compare(double actualHours, double? averageHours, int sample)
    {
        if (averageHours is not { } average || sample == 0)
            return "Nuk ka ende raste të tjera të zgjidhura për krahasim.";

        var averageText = $"{Humanise(TimeSpan.FromHours(average))} (nga {sample} {(sample == 1 ? "rast" : "raste")})";
        var difference = Humanise(TimeSpan.FromHours(Math.Abs(actualHours - average)));

        return actualHours <= average
            ? $"{averageText} — ky rast u zgjidh {difference} më shpejt"
            : $"{averageText} — ky rast zgjati {difference} më shumë";
    }

    private static string StatusLabel(ReportStatus status) => status switch
    {
        ReportStatus.Submitted => "I dërguar",
        ReportStatus.InReview => "Në shqyrtim",
        ReportStatus.Assigned => "I caktuar",
        ReportStatus.InProgress => "Në punë",
        ReportStatus.Resolved => "I zgjidhur",
        ReportStatus.Rejected => "I refuzuar",
        ReportStatus.Merged => "I bashkuar",
        _ => status.ToString()
    };

    private static string PriorityLabel(ReportPriority priority) => priority switch
    {
        ReportPriority.Low => "I ulët",
        ReportPriority.Normal => "Normal",
        ReportPriority.High => "I lartë",
        ReportPriority.Urgent => "Urgjent",
        _ => priority.ToString()
    };
}

internal static class MunicipalTimeExtensions
{
    /// <summary>
    /// The database is UTC; a document that gets printed and signed must carry the wall-clock time the
    /// signer lived through. Falls back to UTC if the host has no tz database entry rather than failing
    /// the whole export over a timezone lookup.
    /// </summary>
    public static DateTime ToLocalMunicipal(this DateTime utc, string? timezone = null)
    {
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timezone ?? "Europe/Tirane");
            return TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return utc;
        }
    }
}
