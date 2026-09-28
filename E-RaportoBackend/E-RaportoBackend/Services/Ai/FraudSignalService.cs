using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Anthropic;
using Anthropic.Models.Messages;
using E_RaportoBackend.Domain;
using Microsoft.Extensions.Options;

namespace E_RaportoBackend.Services.Ai;

/// <summary>
/// Four calibrated, narrow questions about a report's photo — one Claude call, not four — each answering
/// something a clerk could check by eye given enough time, not "is this fraud" (unanswerable, and the one
/// dishonest capability this app refuses to claim; see <see cref="PhotoReuseDetectionService"/>'s own
/// remarks). Every flag here is advisory: it only ever asks a human to look, never blocks or auto-rejects
/// a report, and a low-confidence hunch is worth staying silent about — a wrong accusation against an
/// honest citizen costs more than a missed one against a dishonest one.
///
/// Runs once per report, only when a photo was attached — reuses the same downscaled image bytes already
/// built for <see cref="ClaudeReportClassifier"/>, so this costs one extra model call, not an extra photo
/// read or a second resize pass.
/// </summary>
public class FraudSignalService(
    IOptions<AnthropicOptions> options, ILogger<FraudSignalService> logger)
{
    private readonly AnthropicOptions _options = options.Value;
    private AnthropicClient? _client;

    /// <summary>Below this, a hunch stays a hunch — it's simply not surfaced. Set well above the
    /// classifier's own "route it anyway, but flag for review" bar: a wrong category costs a clerk one
    /// re-file, a wrong fraud accusation costs a citizen's trust in the whole system.</summary>
    public const double MinFlagConfidence = 0.6;

    /// <summary>Deliberately its own budget, not <see cref="AnthropicOptions.MaxTokens"/> — that value is
    /// tuned for the classifier's single reasoning sentence, and silently truncates this call's four
    /// independent reasoning fields mid-JSON, which fails the whole response instead of degrading it.</summary>
    private const int MaxTokens = 1200;

    public bool IsConfigured => _options.Enabled && !string.IsNullOrWhiteSpace(_options.ApiKey);

    public async Task<List<FraudFlag>> AnalyzeAsync(
        Report report, IReadOnlyList<ClassificationImage> images, CancellationToken ct = default)
    {
        if (!IsConfigured || images.Count == 0) return [];

        var sw = Stopwatch.StartNew();
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

            _client ??= new AnthropicClient { ApiKey = _options.ApiKey };

            var message = await _client.Messages.Create(new MessageCreateParams
            {
                Model = _options.Model,
                MaxTokens = MaxTokens,
                System = SystemPrompt,
                OutputConfig = new OutputConfig { Format = new JsonOutputFormat { Schema = Schema } },
                Messages = [new() { Role = Role.User, Content = BuildUserContent(report, images) }]
            }, cancellationToken: timeout.Token);

            var json = message.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text).FirstOrDefault();
            if (string.IsNullOrWhiteSpace(json))
            {
                logger.LogWarning("Fraud-signal call returned no text block for report {Ref}.", report.PublicRef);
                return [];
            }

            var parsed = JsonSerializer.Deserialize<Verdict>(json);
            if (parsed is null)
            {
                logger.LogWarning("Fraud-signal response did not deserialise for report {Ref}. Raw: {Raw}",
                    report.PublicRef, json);
                return [];
            }

            var flags = new List<FraudFlag>();
            AddIfFlagged(flags, report, FraudFlagKind.DescriptionMismatch, parsed.DescriptionMismatch);
            AddIfFlagged(flags, report, FraudFlagKind.SeverityExaggeration, parsed.SeverityExaggeration);
            AddIfFlagged(flags, report, FraudFlagKind.StockPhoto, parsed.StockPhoto);
            AddIfFlagged(flags, report, FraudFlagKind.PhotoOfPhoto, parsed.PhotoOfPhoto);

            if (flags.Count > 0)
            {
                logger.LogInformation("Report {Ref}: {Count} AI fraud signal(s) in {Ms}ms",
                    report.PublicRef, flags.Count, sw.ElapsedMilliseconds);
            }

            return flags;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Fraud-signal call timed out after {Ms}ms for report {Ref}.",
                sw.ElapsedMilliseconds, report.PublicRef);
            return [];
        }
        catch (Exception ex)
        {
            // Never blocks report creation — a missed fraud signal is a much smaller problem than a
            // failed submission over a feature that only ever adds a staff-side hint.
            logger.LogError(ex, "Fraud-signal call failed for report {Ref}.", report.PublicRef);
            return [];
        }
    }

    private static void AddIfFlagged(List<FraudFlag> flags, Report report, FraudFlagKind kind, Signal signal)
    {
        var confidence = Math.Clamp(signal.Confidence, 0, 1);
        if (!signal.Flagged || confidence < MinFlagConfidence || string.IsNullOrWhiteSpace(signal.Reasoning))
            return;

        flags.Add(new FraudFlag
        {
            ReportId = report.Id,
            Kind = kind,
            Score = Math.Round(confidence, 2),
            Reasoning = signal.Reasoning.Trim(),
        });
    }

    private const string SystemPrompt = """
        You are a second, narrower pass over a citizen's report to Bashkia Elbasan (Elbasan Municipality,
        Albania) — not classification, a fraud-signal check. You are given the same photo(s) and
        description already used to categorise the report.

        Answer exactly four independent questions about the FIRST photo attached. Each is a factual,
        checkable claim about the image itself — never a judgement about the reporter's intent, which no
        model can honestly make:

        1. description_mismatch — does the photo plausibly show the problem the text describes? Only flag
           a genuine mismatch (wrong subject entirely — text describes a pothole, photo shows a tree).
           Do NOT flag a photo that is simply a worse angle, blurry, or shows the same problem from
           further away — that is normal, not suspicious.
        2. severity_exaggeration — does the text claim a severity/urgency (flooding, structural collapse,
           fire, immediate danger to life) that the photo plainly does not support at all? Only flag a
           real, visible contradiction, not a photo that merely doesn't capture the full scale.
        3. stock_photo — does the photo look like professional/stock/advertising photography (studio
           lighting, a watermark, an overly polished composition or framing) rather than an ordinary
           phone snapshot of a real street-level scene?
        4. photo_of_photo — does the photo appear to be a picture taken OF another photo or a screen
           (a visible phone bezel, screen pixels or moiré pattern, glare typical of glass or a print)
           rather than a direct photo of the real scene?

        For each: set "flagged" only when you would actually stand behind it, set "confidence" as your
        honest calibrated probability (0-1) that a person looking carefully would agree, and always fill
        "reasoning" with ONE sentence in Albanian naming the specific visual evidence — even when
        "flagged" is false, in which case reasoning may be empty. Staying silent (flagged: false) is
        always the safer default: a wrong accusation against an honest citizen costs the municipality's
        trust in the whole system, and every flag here is shown to a clerk who decides, never automatic.

        Return only the JSON object matching the schema.
        """;

    private static List<ContentBlockParam> BuildUserContent(Report report, IReadOnlyList<ClassificationImage> images)
    {
        var text = $"""
            REPORT DESCRIPTION:
            {report.Description}
            """;

        var blocks = new List<ContentBlockParam> { new TextBlockParam(text) };

        // Only the first photo — the four questions above are all about "does the primary evidence photo
        // match the claim", and sending every attached photo would multiply cost for no real gain there.
        var first = images.FirstOrDefault();
        if (first is not null)
        {
            blocks.Add(new ImageBlockParam(new Base64ImageSource
            {
                Data = Convert.ToBase64String(first.Data),
                MediaType = first.MediaType switch
                {
                    "image/png" => MediaType.ImagePng,
                    "image/gif" => MediaType.ImageGif,
                    "image/webp" => MediaType.ImageWebP,
                    _ => MediaType.ImageJpeg,
                },
            }));
        }

        return blocks;
    }

    private static readonly Dictionary<string, JsonElement> SignalSchema = new()
    {
        ["type"] = JsonSerializer.SerializeToElement("object"),
        ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
        ["required"] = JsonSerializer.SerializeToElement(new[] { "flagged", "confidence", "reasoning" }),
        ["properties"] = JsonSerializer.SerializeToElement(new
        {
            flagged = new { type = "boolean" },
            confidence = new { type = "number" },
            reasoning = new { type = "string" },
        }),
    };

    private static Dictionary<string, JsonElement> Schema => new()
    {
        ["type"] = JsonSerializer.SerializeToElement("object"),
        ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
        ["required"] = JsonSerializer.SerializeToElement(new[]
        {
            "description_mismatch", "severity_exaggeration", "stock_photo", "photo_of_photo"
        }),
        ["properties"] = JsonSerializer.SerializeToElement(new
        {
            description_mismatch = SignalSchema,
            severity_exaggeration = SignalSchema,
            stock_photo = SignalSchema,
            photo_of_photo = SignalSchema,
        }),
    };

    private sealed record Signal(
        [property: JsonPropertyName("flagged")] bool Flagged,
        [property: JsonPropertyName("confidence")] double Confidence,
        [property: JsonPropertyName("reasoning")] string Reasoning);

    private sealed record Verdict(
        [property: JsonPropertyName("description_mismatch")] Signal DescriptionMismatch,
        [property: JsonPropertyName("severity_exaggeration")] Signal SeverityExaggeration,
        [property: JsonPropertyName("stock_photo")] Signal StockPhoto,
        [property: JsonPropertyName("photo_of_photo")] Signal PhotoOfPhoto);
}
