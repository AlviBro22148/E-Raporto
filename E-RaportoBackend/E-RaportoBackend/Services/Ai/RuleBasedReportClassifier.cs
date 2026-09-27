using System.Globalization;
using System.Text;
using E_RaportoBackend.Domain;

namespace E_RaportoBackend.Services.Ai;

/// <summary>
/// Deterministic Albanian/English keyword classifier. This is not a demo stub — it is the safety net
/// that makes the live pitch survive a dead API key, a rate limit, or venue Wi-Fi, and it is what the
/// LLM path falls back to on any failure. Weighted term matching, no external calls, ~0ms.
/// </summary>
public class RuleBasedReportClassifier(ILogger<RuleBasedReportClassifier> logger) : IReportClassifier
{
    // Weighted signals per category. Strong terms (3) name the object; weak terms (1) are context.
    private static readonly Dictionary<string, (string Term, int Weight)[]> Signals = new()
    {
        ["roads"] =
        [
            ("gropë", 3), ("grope", 3), ("gropa", 3), ("pothole", 3), ("asfalt", 3), ("asfaltim", 3),
            ("karrexhat", 3), ("trotuar", 3), ("kapak", 2), ("puseti", 2), ("rrugë", 2), ("rruga", 2),
            ("rrugës", 2), ("road", 2), ("sidewalk", 2), ("pavement", 2), ("shenj", 1), ("semafor", 2),
            ("ura", 2), ("bridge", 2), ("crack", 2), ("çarje", 2), ("dëmtuar", 1)
        ],
        ["waste"] =
        [
            ("mbeturina", 3), ("mbeturinat", 3), ("plehra", 3), ("pleh", 3), ("garbage", 3), ("trash", 3),
            ("waste", 3), ("kontejner", 3), ("kazan", 3), ("bin", 2), ("dumpster", 3), ("grumbullim", 2),
            ("pastrim", 2), ("erë e keqe", 2), ("qelb", 2), ("smell", 1), ("landfill", 2), ("derdhje", 2),
            ("mbledhja", 1), ("higjien", 2)
        ],
        ["lighting"] =
        [
            ("ndriçim", 3), ("ndricim", 3), ("ndriçimi", 3), ("llamb", 3), ("llamba", 3), ("shtyll", 2),
            ("street light", 3), ("streetlight", 3), ("lamp", 3), ("dritë", 2), ("drita", 2), ("light", 2),
            ("errët", 2), ("erret", 2), ("dark", 2), ("fikur", 2), ("nuk ndizet", 3), ("bulb", 2)
        ],
        ["water"] =
        [
            ("ujë", 3), ("uji", 3), ("ujë i pijshëm", 3), ("ujësjellës", 3), ("kanalizim", 3),
            ("kanalizime", 3), ("water", 3), ("sewage", 3), ("sewer", 3), ("rrjedhje", 3), ("leak", 3),
            ("tub", 2), ("tubacion", 3), ("pipe", 2), ("përmbytje", 3), ("permbytje", 3), ("flood", 3),
            ("shpim", 1), ("presion", 1), ("zezë", 1)
        ],
        ["public_spaces"] =
        [
            ("park", 3), ("parku", 3), ("lulishte", 3), ("gjelbërim", 3), ("gjelberim", 3), ("pem", 2),
            ("pemë", 3), ("pema", 3), ("tree", 3), ("bar", 1), ("bench", 3), ("stol", 3), ("stola", 3),
            ("lodra", 3), ("playground", 3), ("kënd lojrash", 3), ("shesh", 2), ("square", 2),
            ("green", 1), ("graffiti", 2), ("grafit", 2), ("varrez", 2)
        ]
    };

    // Terms that override the category's own priority — a stated danger outranks a routine complaint.
    private static readonly (string Term, ReportPriority Priority)[] UrgencySignals =
    [
        ("rrezik", ReportPriority.High), ("rreziko", ReportPriority.High), ("danger", ReportPriority.High),
        ("aksident", ReportPriority.Urgent), ("accident", ReportPriority.Urgent),
        ("emergjenc", ReportPriority.Urgent), ("emergency", ReportPriority.Urgent),
        ("fëmij", ReportPriority.High), ("femij", ReportPriority.High), ("children", ReportPriority.High),
        ("shkoll", ReportPriority.High), ("school", ReportPriority.High),
        ("spital", ReportPriority.High), ("hospital", ReportPriority.High),
        ("i plagosur", ReportPriority.Urgent), ("injured", ReportPriority.Urgent),
        ("përmbyt", ReportPriority.Urgent), ("permbyt", ReportPriority.Urgent),
        ("shkëndij", ReportPriority.Urgent), ("zjarr", ReportPriority.Urgent), ("fire", ReportPriority.Urgent)
    ];

    public Task<ClassificationResult> ClassifyAsync(ClassificationRequest request, CancellationToken ct = default)
    {
        var haystack = Normalize($"{request.Description} {request.AddressText}");

        var scores = new Dictionary<string, int>();
        var matched = new Dictionary<string, List<string>>();

        foreach (var entry in request.Taxonomy)
        {
            if (!Signals.TryGetValue(entry.Code, out var signals)) continue;

            var score = 0;
            var hits = new List<string>();
            foreach (var (term, weight) in signals)
            {
                if (!haystack.Contains(Normalize(term), StringComparison.Ordinal)) continue;
                score += weight;
                hits.Add(term);
            }

            if (score <= 0) continue;
            scores[entry.Code] = score;
            matched[entry.Code] = hits;
        }

        // The citizen's own guess is a tiebreaker, not an override — they pick from a 6-item list and
        // are often approximately right, but "other" gets chosen out of laziness far too often.
        if (!string.IsNullOrWhiteSpace(request.CitizenCategoryHint) &&
            request.CitizenCategoryHint != "other" &&
            request.Taxonomy.Any(t => t.Code == request.CitizenCategoryHint))
        {
            scores[request.CitizenCategoryHint] = scores.GetValueOrDefault(request.CitizenCategoryHint) + 2;
        }

        if (scores.Count == 0)
        {
            logger.LogInformation("Rule-based classifier found no signals; falling back to 'other'.");
            return Task.FromResult(new ClassificationResult(
                CategoryCode: "other",
                Confidence: 0.30,
                Priority: DetectPriority(haystack, ReportPriority.Normal),
                Reasoning: "Asnjë term dallues nuk u gjet në përshkrim — kërkon shqyrtim manual.",
                SummarySq: Truncate(request.Description, 140),
                SuggestedTitle: BuildTitle(request.Description),
                Source: ClassificationSource.RuleBased,
                Model: "rule-based-v1"));
        }

        var best = scores.OrderByDescending(kv => kv.Value).First();
        var total = scores.Values.Sum();

        // Confidence = share of total signal, damped so a single weak keyword never reads as certainty.
        var share = best.Value / (double)total;
        var strength = Math.Min(best.Value / 6.0, 1.0);
        var confidence = Math.Round(Math.Clamp(0.35 + (share * strength * 0.55), 0.30, 0.88), 2);

        var terms = string.Join(", ", matched[best.Key].Take(4));

        return Task.FromResult(new ClassificationResult(
            CategoryCode: best.Key,
            Confidence: confidence,
            Priority: DetectPriority(haystack, ReportPriority.Normal),
            Reasoning: $"Përputhje me fjalë kyçe: {terms}.",
            SummarySq: Truncate(request.Description, 140),
            SuggestedTitle: BuildTitle(request.Description),
            Source: ClassificationSource.RuleBased,
            Model: "rule-based-v1"));
    }

    private static ReportPriority DetectPriority(string normalizedHaystack, ReportPriority fallback)
    {
        var highest = fallback;
        foreach (var (term, priority) in UrgencySignals)
        {
            if (normalizedHaystack.Contains(Normalize(term), StringComparison.Ordinal) && priority > highest)
                highest = priority;
        }
        return highest;
    }

    /// <summary>Lowercase and strip diacritics so "gropë"/"grope" and "ndriçim"/"ndricim" both match.</summary>
    internal static string Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return string.Empty;

        var decomposed = input.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(decomposed.Length);
        foreach (var c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                sb.Append(c);
        }
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    internal static string BuildTitle(string description)
    {
        var cleaned = description.Trim().ReplaceLineEndings(" ");
        var cut = cleaned.IndexOfAny(['.', '!', '?', ';']);
        if (cut > 15) cleaned = cleaned[..cut];
        return Truncate(cleaned, 90);
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..(max - 1)].TrimEnd() + "…";
}
