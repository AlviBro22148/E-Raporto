namespace E_RaportoBackend.Services.Ai;

/// <summary>
/// Translates a piece of staff- or citizen-written Albanian text (a status-change note, a dispute
/// comment) into English, so the bilingual notification/history rows this text ends up in have a real
/// English half instead of a duplicated Albanian one. Unlike the classifier and the pattern synthesizer,
/// this is never on the critical path of a citizen submission — it only ever runs for a staff action or a
/// citizen's own verification, both comparatively rare — so there is no cost-control staging here: every
/// call that has real free text to translate just makes the call.
/// </summary>
public interface INoteTranslator
{
    /// <summary>Null on any failure (no key, timeout, malformed response) — the caller falls back to
    /// storing no English text, and every client already renders that as "show the Albanian original"
    /// rather than a blank field. Never throws.</summary>
    Task<string?> TranslateAsync(string albanianText, CancellationToken ct = default);
}
