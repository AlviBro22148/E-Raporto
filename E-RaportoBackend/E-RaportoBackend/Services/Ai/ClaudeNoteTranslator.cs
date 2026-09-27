using System.Diagnostics;
using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Options;

namespace E_RaportoBackend.Services.Ai;

/// <summary>
/// A third, much smaller use of Claude than <see cref="ClaudeReportClassifier"/> or
/// <see cref="ClaudePatternSynthesizer"/> — plain-text in, plain-text out, no schema. Shares
/// <see cref="AnthropicOptions"/> with both for the same reason the synthesizer does: one account, one
/// kill switch, one place to retune.
/// </summary>
public class ClaudeNoteTranslator(
    IOptions<AnthropicOptions> options, ILogger<ClaudeNoteTranslator> logger) : INoteTranslator
{
    private readonly AnthropicOptions _options = options.Value;
    private AnthropicClient? _client;

    private const int MaxTokens = 400;   // a case note is a sentence or two, never a document

    public bool IsConfigured => _options.Enabled && !string.IsNullOrWhiteSpace(_options.ApiKey);

    public async Task<string?> TranslateAsync(string albanianText, CancellationToken ct = default)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(albanianText)) return null;

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
                Messages = [new() { Role = Role.User, Content = BuildUserContent(albanianText) }]
            }, cancellationToken: timeout.Token);

            var text = message.Content
                .Select(b => b.Value)
                .OfType<TextBlock>()
                .Select(t => t.Text)
                .FirstOrDefault();

            if (string.IsNullOrWhiteSpace(text))
            {
                logger.LogWarning("Note translation returned no text block; note ships Albanian-only.");
                return null;
            }

            logger.LogInformation("Note translated to English in {Ms}ms", sw.ElapsedMilliseconds);
            return text.Trim();
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Note translation timed out after {Ms}ms — note ships Albanian-only.", sw.ElapsedMilliseconds);
            return null;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Note translation failed — note ships Albanian-only.");
            return null;
        }
    }

    private static List<ContentBlockParam> BuildUserContent(string albanianText) =>
        [new TextBlockParam(albanianText)];

    private const string SystemPrompt = """
        Translate the Albanian text that follows into natural, professional English.

        It is an internal case-management note from E-Raporto, a municipal issue-reporting system for
        Bashkia Elbasan (Elbasan Municipality, Albania) — written by either a municipal staff member about
        a citizen's reported issue (a pothole, a broken streetlight, etc.) or by the citizen themselves
        confirming or disputing that a resolution actually happened. Translate it as that kind of note:
        plain, factual, professional. Keep street names, place names, and report reference numbers (e.g.
        ELB-2026-0042) unchanged.

        Return ONLY the English translation. No preamble, no quotation marks, no commentary, no
        alternative phrasings — a single translated sentence or two, exactly matching what one sentence or
        two of input deserves.
        """;
}
