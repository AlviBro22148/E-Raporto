using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Anthropic;
using Anthropic.Models.Messages;
using E_RaportoBackend.Domain;
using Microsoft.Extensions.Options;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace E_RaportoBackend.Services.Ai;

public class AnthropicOptions
{
    public const string SectionName = "Anthropic";

    /// <summary>Never committed. Set via user-secrets or the ANTHROPIC_API_KEY environment variable.</summary>
    public string? ApiKey { get; set; }
    public string Model { get; set; } = "claude-haiku-4-5";
    public int MaxTokens { get; set; } = 700;
    // Higher than a text-only call needs — a request with photos attached takes longer to process.
    public int TimeoutSeconds { get; set; } = 20;
    /// <summary>Kill switch: forces the rule-based path without touching the key. Useful mid-demo.</summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// The real AI feature: one well-prompted Claude call that categorises the report, proposes an urgency,
/// and writes a one-line Albanian summary for the clerk's inbox.
///
/// Two deliberate design choices the pitch depends on:
///   1. The taxonomy is sent from the database, so routing rules stay configurable per municipality.
///   2. Every failure path — no key, timeout, malformed JSON, a category the model invented — falls
///      through to <see cref="RuleBasedReportClassifier"/> rather than failing the citizen's submission.
///      The response records which engine actually ran, and the UI shows it.
/// </summary>
public class ClaudeReportClassifier(
    IOptions<AnthropicOptions> options,
    RuleBasedReportClassifier fallback,
    ILogger<ClaudeReportClassifier> logger) : IReportClassifier
{
    private readonly AnthropicOptions _options = options.Value;
    private AnthropicClient? _client;

    // Claude's vision input only accepts these four formats — HEIC (what most iPhones capture) isn't
    // one of them, so those photos are silently skipped rather than sent and rejected by the API.
    private static readonly Dictionary<string, MediaType> SupportedImageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = MediaType.ImageJpeg,
        ["image/png"] = MediaType.ImagePng,
        ["image/gif"] = MediaType.ImageGif,
        ["image/webp"] = MediaType.ImageWebP,
    };

    public bool IsConfigured => _options.Enabled && !string.IsNullOrWhiteSpace(_options.ApiKey);

    public async Task<ClassificationResult> ClassifyAsync(
        ClassificationRequest request, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            logger.LogInformation("Anthropic key not configured — using rule-based classifier.");
            return await fallback.ClassifyAsync(request, ct);
        }

        var sw = Stopwatch.StartNew();
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));

            _client ??= new AnthropicClient { ApiKey = _options.ApiKey };

            var message = await _client.Messages.Create(new MessageCreateParams
            {
                Model = _options.Model,
                MaxTokens = _options.MaxTokens,
                System = BuildSystemPrompt(request.Taxonomy, request.Images is { Count: > 0 }),
                OutputConfig = new OutputConfig { Format = new JsonOutputFormat { Schema = BuildSchema(request.Taxonomy) } },
                Messages = [new() { Role = Role.User, Content = BuildUserContent(request) }]
            }, cancellationToken: timeout.Token);

            var json = message.Content
                .Select(b => b.Value)
                .OfType<TextBlock>()
                .Select(t => t.Text)
                .FirstOrDefault();

            if (string.IsNullOrWhiteSpace(json))
            {
                logger.LogWarning("Claude returned no text block; falling back to rules.");
                return await fallback.ClassifyAsync(request, ct);
            }

            var parsed = JsonSerializer.Deserialize<ClaudeVerdict>(json);
            if (parsed is null)
            {
                logger.LogWarning("Claude response did not deserialise; falling back. Raw: {Raw}", json);
                return await fallback.ClassifyAsync(request, ct);
            }

            // Whitelist check: never trust a category code the model may have invented.
            var valid = request.Taxonomy.Any(t => t.Code == parsed.CategoryCode);
            if (!valid)
            {
                logger.LogWarning("Claude proposed unknown category '{Code}'; falling back.", parsed.CategoryCode);
                return await fallback.ClassifyAsync(request, ct);
            }

            logger.LogInformation("Claude classified as {Code} ({Confidence:P0}) in {Ms}ms",
                parsed.CategoryCode, parsed.Confidence, sw.ElapsedMilliseconds);

            return new ClassificationResult(
                CategoryCode: parsed.CategoryCode,
                Confidence: Math.Clamp(parsed.Confidence, 0, 1),
                Priority: ParsePriority(parsed.Priority),
                Reasoning: parsed.Reasoning.Trim(),
                SummarySq: parsed.SummarySq?.Trim(),
                SuggestedTitle: string.IsNullOrWhiteSpace(parsed.Title)
                    ? RuleBasedReportClassifier.BuildTitle(request.Description)
                    : parsed.Title.Trim(),
                Source: ClassificationSource.Llm,
                Model: _options.Model,
                SuggestedTitleEn: parsed.TitleEn?.Trim(),
                DescriptionSq: parsed.DescriptionSq?.Trim(),
                DescriptionEn: parsed.DescriptionEn?.Trim(),
                ReasoningEn: parsed.ReasoningEn?.Trim());
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Claude call timed out after {Ms}ms — using rule-based classifier.", sw.ElapsedMilliseconds);
            return await fallback.ClassifyAsync(request, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Claude call failed — using rule-based classifier.");
            return await fallback.ClassifyAsync(request, ct);
        }
    }

    private static string BuildSystemPrompt(IReadOnlyList<TaxonomyEntry> taxonomy, bool hasPhotos)
    {
        var lines = taxonomy.Select(t => $"- {t.Code} — {t.NameSq} ({t.NameEn}): {t.Description}");

        var photoGuidance = hasPhotos
            ? """

              PHOTO EVIDENCE
              One or more photos of the reported problem are attached after the text. Treat them as the
              most reliable evidence available:
              - If the photo confirms the described problem, this should raise your confidence.
              - If the photo shows something different from, additional to, or contradicting the text
                (wrong category, worse/better severity, a second problem not mentioned), trust the photo
                and say so explicitly in `reasoning`.
              - If the photo is blurry, too dark, unrelated, or doesn't actually show the problem, say so
                in `reasoning` and rely on the text instead — do not invent detail that isn't visible.
              """
            : "";

        return $"""
        You are the intake triage system for Bashkia Elbasan (Elbasan Municipality, Albania). Citizens
        submit short reports about municipal problems, usually in Albanian, sometimes in English, often
        with typos, slang, or no diacritics.

        Your job is to classify one report into exactly one category, judge its urgency, and write a
        one-line Albanian summary a municipal clerk can scan in a list view.

        CATEGORIES (choose exactly one `code`):
        {string.Join("\n", lines)}
        {photoGuidance}
        RULES
        - Pick the category describing the PHYSICAL PROBLEM, not the location. A broken street light on a
          road is `lighting`, not `roads`. Rubbish piled in a park is `waste`, not `public_spaces`.
        - Use `other` only when the report genuinely fits no category — not when you are merely unsure.
          If unsure between two real categories, pick the more likely one and lower your confidence.
        - `confidence` is your honest calibrated probability that a municipal clerk would agree with your
          category. Do not inflate it. Reports that are vague, contradictory, or could plausibly belong to
          two categories should score below 0.7. This number is shown to staff and is used to decide
          whether a human reviews the routing, so an overconfident wrong answer is worse than a hedged one.
        - `priority`: `urgent` only for an immediate danger to life or property (flooding, live wires,
          fire, an accident already caused). `high` for a real safety risk or an issue near a school or
          hospital. `normal` for ordinary service faults. `low` for cosmetic issues.
        - `reasoning`: ONE sentence in ALBANIAN, naming the specific evidence in the report (and the photo,
          if one was provided). This is shown to both the citizen and the clerk, so it must justify the
          decision, not restate the description.
        - `reasoning_en`: the same sentence, translated to natural English.
        - `summary_sq`: ONE short Albanian sentence, max 120 characters, factual, no greetings.
        - `title`: a short Albanian noun phrase, max 80 characters, e.g. "Gropë e madhe në Rrugën Qemal Stafa".
        - `title_en`: the same title, translated to natural English — not a literal word-for-word gloss.
        - `description_sq` and `description_en`: the citizen's full REPORT DESCRIPTION below, reproduced
          faithfully in Albanian and in English. Whichever language it was actually written in, put that
          version — lightly cleaned up (typos, missing diacritics) but not shortened or reworded — in the
          matching field, and put a natural, complete translation in the other field. Never summarize here;
          `summary_sq` is the short version, these two are the full text in both languages.

        Return only the JSON object matching the schema.
        """;
    }

    private static string BuildUserMessage(ClassificationRequest request)
    {
        var hint = string.IsNullOrWhiteSpace(request.CitizenCategoryHint)
            ? "(none)"
            : $"{request.CitizenCategoryHint} — treat as a weak hint only; the citizen may be wrong.";

        return $"""
        REPORT DESCRIPTION:
        {request.Description}

        LOCATION NOTE: {(string.IsNullOrWhiteSpace(request.AddressText) ? "(none)" : request.AddressText)}
        CITIZEN'S OWN CATEGORY GUESS: {hint}
        """;
    }

    /// <summary>
    /// The text block always comes first, followed by one image block per usable photo. Images in a
    /// format Claude's vision input doesn't accept (HEIC) are skipped rather than sent — the API would
    /// just reject the whole request, and one bad photo shouldn't cost the report its classification.
    /// </summary>
    private static List<ContentBlockParam> BuildUserContent(ClassificationRequest request)
    {
        var blocks = new List<ContentBlockParam> { new TextBlockParam(BuildUserMessage(request)) };

        foreach (var image in request.Images ?? [])
        {
            if (!SupportedImageTypes.TryGetValue(image.MediaType, out var mediaType)) continue;

            var (data, resizedType) = DownscaleForClassification(image.Data, mediaType);

            blocks.Add(new ImageBlockParam(new Base64ImageSource
            {
                Data = Convert.ToBase64String(data),
                MediaType = resizedType,
            }));
        }

        return blocks;
    }

    // Anthropic's vision input stops gaining quality past ~1568px on the long edge — anything bigger
    // just adds image tokens and latency for no benefit. Phone camera photos routinely come in at
    // 3000px+, so this is the single biggest lever on how long a submit-with-photo call takes. The
    // stored original (what citizens/clerks see) is never touched — only the copy sent to the model.
    private const int MaxEdgePx = 1568;

    private static (byte[] Data, MediaType MediaType) DownscaleForClassification(byte[] original, MediaType mediaType)
    {
        try
        {
            using var image = Image.Load(original);
            if (image.Width <= MaxEdgePx && image.Height <= MaxEdgePx)
                return (original, mediaType);

            image.Mutate(x => x.Resize(new ResizeOptions
            {
                Mode = ResizeMode.Max,
                Size = new Size(MaxEdgePx, MaxEdgePx)
            }));

            using var ms = new MemoryStream();
            image.Save(ms, new JpegEncoder { Quality = 85 });
            return (ms.ToArray(), MediaType.ImageJpeg);
        }
        catch
        {
            // Decoding failed for some reason ImageSharp is pickier about than the API itself — send
            // the original bytes rather than dropping the photo from classification entirely.
            return (original, mediaType);
        }
    }

    private static Dictionary<string, JsonElement> BuildSchema(IReadOnlyList<TaxonomyEntry> taxonomy)
    {
        var codes = taxonomy.Select(t => t.Code).ToArray();

        return new Dictionary<string, JsonElement>
        {
            ["type"] = JsonSerializer.SerializeToElement("object"),
            ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            ["required"] = JsonSerializer.SerializeToElement(
                new[] { "category_code", "confidence", "priority", "reasoning", "reasoning_en", "summary_sq",
                         "title", "title_en", "description_sq", "description_en" }),
            ["properties"] = JsonSerializer.SerializeToElement(new
            {
                category_code = new { type = "string", @enum = codes },
                confidence = new { type = "number" },
                priority = new { type = "string", @enum = new[] { "low", "normal", "high", "urgent" } },
                reasoning = new { type = "string" },
                reasoning_en = new { type = "string" },
                summary_sq = new { type = "string" },
                title = new { type = "string" },
                title_en = new { type = "string" },
                description_sq = new { type = "string" },
                description_en = new { type = "string" }
            })
        };
    }

    private static ReportPriority ParsePriority(string? value) => value?.ToLowerInvariant() switch
    {
        "urgent" => ReportPriority.Urgent,
        "high" => ReportPriority.High,
        "low" => ReportPriority.Low,
        _ => ReportPriority.Normal
    };

    private sealed record ClaudeVerdict(
        [property: JsonPropertyName("category_code")] string CategoryCode,
        [property: JsonPropertyName("confidence")] double Confidence,
        [property: JsonPropertyName("priority")] string Priority,
        [property: JsonPropertyName("reasoning")] string Reasoning,
        [property: JsonPropertyName("reasoning_en")] string? ReasoningEn,
        [property: JsonPropertyName("summary_sq")] string? SummarySq,
        [property: JsonPropertyName("title")] string? Title,
        [property: JsonPropertyName("title_en")] string? TitleEn,
        [property: JsonPropertyName("description_sq")] string? DescriptionSq,
        [property: JsonPropertyName("description_en")] string? DescriptionEn);
}
