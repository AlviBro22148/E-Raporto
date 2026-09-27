using System.Security.Cryptography;

namespace E_RaportoBackend.Services;

/// <summary>
/// Produces the six-character handle a citizen account is known by outside itself.
/// </summary>
public static class PseudonymGenerator
{
    // Crockford-style: no I, L, O, U. A handle gets read down a phone line and written on paper by
    // staff, and "1" against "I" or "0" against "O" is the failure that turns one reporter into two in
    // a duplicate review — which is the single place the handle is used to make a decision.
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private const int Length = 6;

    /// <summary>
    /// A fresh handle. Drawn from <see cref="RandomNumberGenerator"/> rather than <c>Random</c>: this is
    /// the only thing standing between a report and its author, so it must not come from a generator
    /// that is seedable, predictable, or reproducible from a timestamp.
    /// </summary>
    /// <remarks>
    /// 32^6 is a little over one billion, so at Elbasan's scale collisions are vanishingly unlikely —
    /// but "unlikely" is not "impossible" and a repeated handle would silently merge two citizens into
    /// one identity in a duplicate review. The unique index in <c>AppDbContext</c> is what actually
    /// makes that impossible; callers retry on the conflict rather than trusting the odds.
    /// </remarks>
    public static string Next()
    {
        Span<byte> bytes = stackalloc byte[Length];
        RandomNumberGenerator.Fill(bytes);

        return string.Create(Length, bytes.ToArray(), (span, source) =>
        {
            for (var i = 0; i < Length; i++) span[i] = Alphabet[source[i] % Alphabet.Length];
        });
    }
}
