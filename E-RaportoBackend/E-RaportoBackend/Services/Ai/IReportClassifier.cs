using E_RaportoBackend.Domain;

namespace E_RaportoBackend.Services.Ai;

/// <summary>One entry in the taxonomy handed to the classifier. Built from the DB, never hardcoded.</summary>
public record TaxonomyEntry(string Code, string NameSq, string NameEn, string Description);

/// <summary>One photo's raw bytes and its MIME type, ready to hand to a vision-capable model.</summary>
public record ClassificationImage(byte[] Data, string MediaType);

public record ClassificationRequest(
    string Description,
    string? AddressText,
    string? CitizenCategoryHint,
    IReadOnlyList<TaxonomyEntry> Taxonomy,
    IReadOnlyList<ClassificationImage>? Images = null);

/// <summary>
/// The classifier's verdict. <see cref="Source"/> and <see cref="Confidence"/> travel all the way to
/// the UI — a clerk always sees whether the LLM actually ran and how sure it was.
/// </summary>
public record ClassificationResult(
    string CategoryCode,
    double Confidence,
    ReportPriority Priority,
    string Reasoning,
    string? SummarySq,
    string? SuggestedTitle,
    ClassificationSource Source,
    string? Model,
    // Bilingual pair for the title, and a full bilingual pair for the citizen's own description — same
    // one-call-does-both approach as the rest of this classifier's output. Null on the rule-based path:
    // there is no translation without a model, and the client falls back to the single-language text
    // exactly like NoteEn/BodyEn do elsewhere when translation wasn't possible.
    string? SuggestedTitleEn = null,
    string? DescriptionSq = null,
    string? DescriptionEn = null,
    // English counterpart of Reasoning, same one-call, same null-on-fallback rule as the fields above.
    string? ReasoningEn = null)
{
    /// <summary>Below this, the dashboard flags the report for a human look before it's routed.</summary>
    public bool IsLowConfidence => Confidence < 0.65;
}

public interface IReportClassifier
{
    Task<ClassificationResult> ClassifyAsync(ClassificationRequest request, CancellationToken ct = default);
}
