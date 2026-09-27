using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Anthropic;
using Anthropic.Models.Messages;
using E_RaportoBackend.Domain;
using Microsoft.Extensions.Options;

namespace E_RaportoBackend.Services.Ai;

/// <summary>
/// The second AI call this product makes, and a different shape of question from the first. Where
/// <see cref="ClaudeReportClassifier"/> reads one report in isolation, this reads several reports
/// together and asks whether they add up to something bigger than any one of them — one failing water
/// main producing four separate leak reports, say, rather than four unrelated potholes.
///
/// It shares <see cref="AnthropicOptions"/> with the classifier rather than getting its own client
/// config — same account, same kill switch, same reasoning for reusing one connection rather than
/// standing up a second. It is called far less often, though: only once a deterministic count of nearby
/// same-category reports has already crossed a threshold (see <see cref="SystemicPatternDetectionService"/>),
/// so almost every report submission never reaches this class at all.
/// </summary>
public class ClaudePatternSynthesizer(
    IOptions<AnthropicOptions> options, ILogger<ClaudePatternSynthesizer> logger) : IPatternSynthesizer
{
    private readonly AnthropicOptions _options = options.Value;
    private AnthropicClient? _client;

    public bool IsConfigured => _options.Enabled && !string.IsNullOrWhiteSpace(_options.ApiKey);

    public async Task<PatternVerdict?> SynthesizeAsync(PatternSynthesisRequest request, CancellationToken ct = default)
    {
        if (!IsConfigured)
        {
            logger.LogInformation("Anthropic key not configured — systemic pattern created without a synthesis.");
            return null;
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
                System = BuildSystemPrompt(),
                OutputConfig = new OutputConfig { Format = new JsonOutputFormat { Schema = BuildSchema() } },
                Messages = [new() { Role = Role.User, Content = BuildUserContent(request) }]
            }, cancellationToken: timeout.Token);

            var json = message.Content
                .Select(b => b.Value)
                .OfType<TextBlock>()
                .Select(t => t.Text)
                .FirstOrDefault();

            if (string.IsNullOrWhiteSpace(json))
            {
                logger.LogWarning("Claude returned no text block for pattern synthesis; pattern ships without one.");
                return null;
            }

            var parsed = JsonSerializer.Deserialize<ClaudeVerdict>(json);
            if (parsed is null)
            {
                logger.LogWarning("Pattern synthesis response did not deserialise. Raw: {Raw}", json);
                return null;
            }

            var connectionType = parsed.ConnectionType switch
            {
                "shared_cause" => ConnectionType.SharedCause,
                "systemic_condition" => ConnectionType.SystemicCondition,
                _ => ConnectionType.Uncertain
            };

            logger.LogInformation("Pattern synthesized as {Type} ({Confidence:P0}) in {Ms}ms",
                connectionType, parsed.Confidence, sw.ElapsedMilliseconds);

            return new PatternVerdict(
                SummarySq: parsed.SummarySq.Trim(),
                ConnectionType: connectionType,
                Confidence: Math.Clamp(parsed.Confidence, 0, 1),
                Model: _options.Model);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Pattern synthesis call timed out after {Ms}ms — pattern ships without one.", sw.ElapsedMilliseconds);
            return null;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Pattern synthesis call failed — pattern ships without one.");
            return null;
        }
    }

    private static string BuildSystemPrompt() => """
        You are helping a municipal supervisor in Elbasan, Albania understand why several separate
        citizen reports have clustered together — same problem category, near each other, within a few
        months of one another. Your job is NOT to classify a single report; several reports about
        genuinely different physical spots have already been grouped by their location and timing, and
        you are being asked whether that grouping means something.

        There are exactly two ways a cluster like this can be real, plus an honest "don't know":

        - `shared_cause`: the reports most likely describe symptoms of ONE identifiable physical thing
          failing — e.g. four separate visible leaks that are plausibly all fed by one corroded pipe
          segment. A single inspection at one location could plausibly explain and fix all of them.
        - `systemic_condition`: the reports most likely have genuinely DIFFERENT local causes, but
          together they indicate a broader structural problem — e.g. aging infrastructure across a
          neighbourhood, or chronic under-maintenance of one type of asset. No single site visit closes
          all of them; this belongs in a budget/planning conversation, not a work order.
        - `uncertain`: you genuinely cannot tell which of the two this is from the text alone. This is a
          legitimate answer, not a failure — say so rather than guessing.

        RULES
        - `summary_sq`: ONE or TWO sentences in ALBANIAN, addressed to a supervisor deciding what to do
          next. Name the specific pattern you see (streets, timing, what's repeated) — do not restate
          each report individually. If `uncertain`, say plainly what would need to be true to resolve it
          (e.g. "duhet inspektim në terren për të përcaktuar nëse është një burim i vetëm").
        - `connection_type`: your honest best read of the two categories above.
        - `confidence`: your calibrated probability that a supervisor reading your summary and then
          sending an inspector would agree with your `connection_type`. Do not inflate it — a cluster of
          reports with only vague location text ("qendra e qytetit") deserves a LOW confidence regardless
          of how many there are, because there may not be enough here to actually locate one shared cause.

        Return only the JSON object matching the schema.
        """;

    private static List<ContentBlockParam> BuildUserContent(PatternSynthesisRequest request) =>
        [new TextBlockParam(BuildUserMessage(request))];

    private static string BuildUserMessage(PatternSynthesisRequest request)
    {
        var lines = request.Members
            .OrderBy(m => m.CreatedAt)
            .Select(m => $"- {m.PublicRef} ({m.CreatedAt:yyyy-MM-dd}) at \"{m.AddressText ?? "(no address given)"}\": "
                         + $"\"{m.Title}\" — {m.Description}");

        return $"""
        CATEGORY: {request.CategoryNameSq}

        {request.Members.Count} REPORTS IN THIS CLUSTER:
        {string.Join("\n", lines)}
        """;
    }

    private static Dictionary<string, JsonElement> BuildSchema() => new()
    {
        ["type"] = JsonSerializer.SerializeToElement("object"),
        ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
        ["required"] = JsonSerializer.SerializeToElement(new[] { "summary_sq", "connection_type", "confidence" }),
        ["properties"] = JsonSerializer.SerializeToElement(new
        {
            summary_sq = new { type = "string" },
            connection_type = new { type = "string", @enum = new[] { "shared_cause", "systemic_condition", "uncertain" } },
            confidence = new { type = "number" }
        })
    };

    private sealed record ClaudeVerdict(
        [property: JsonPropertyName("summary_sq")] string SummarySq,
        [property: JsonPropertyName("connection_type")] string ConnectionType,
        [property: JsonPropertyName("confidence")] double Confidence);
}
