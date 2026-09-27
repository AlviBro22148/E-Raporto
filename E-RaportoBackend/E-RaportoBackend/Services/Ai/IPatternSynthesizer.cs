using E_RaportoBackend.Domain;

namespace E_RaportoBackend.Services.Ai;

/// <summary>One report's worth of context handed to the synthesizer — no photos, no reporter identity,
/// just the facts a human investigating the cluster would also start from.</summary>
public record PatternMemberInfo(
    string PublicRef, string Title, string Description, string? AddressText, DateTime CreatedAt);

public record PatternSynthesisRequest(
    string CategoryNameSq,
    IReadOnlyList<PatternMemberInfo> Members);

/// <summary>
/// The synthesizer's verdict on a cluster. Unlike <see cref="ClassificationResult"/>, there is no
/// rule-based fallback that always produces one of these — a pattern is real information (a count that
/// crossed a threshold) with or without it, so "no verdict" is itself an honest, valid outcome rather
/// than something that needs to be worked around.
/// </summary>
public record PatternVerdict(
    string SummarySq,
    ConnectionType ConnectionType,
    double Confidence,
    string Model);

public interface IPatternSynthesizer
{
    /// <summary>Null means no synthesis happened — key not configured, timeout, malformed response.
    /// The caller still creates the pattern from the raw member count; it just ships without a narrative.</summary>
    Task<PatternVerdict?> SynthesizeAsync(PatternSynthesisRequest request, CancellationToken ct = default);
}
