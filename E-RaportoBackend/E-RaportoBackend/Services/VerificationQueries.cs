using E_RaportoBackend.Data;
using E_RaportoBackend.Domain;
using Microsoft.EntityFrameworkCore;

namespace E_RaportoBackend.Services;

/// <summary>
/// Shared reads over resolution verifications. Lives here rather than in either controller because the
/// citizen's "My reports" list and the staff queue ask the same question — "does a verdict stand against
/// what this report currently claims?" — and two copies of that rule would drift the first time the
/// reopen behaviour changed.
/// </summary>
public static class VerificationQueries
{
    /// <summary>
    /// The verdict standing against each report's <em>current</em> resolution, keyed by report id.
    /// Reports with no verdict, or whose only verdict was about a resolution that has since been
    /// superseded by a reopen, are simply absent from the dictionary.
    /// </summary>
    /// <remarks>
    /// One query for a whole page rather than one per row: this feeds list badges, and the N+1 version
    /// of it would put a round-trip behind every line of the queue.
    /// </remarks>
    public static async Task<Dictionary<Guid, string>> CurrentVerificationOutcomesAsync(
        this AppDbContext db, IReadOnlyList<Report> reports, CancellationToken ct)
    {
        // Only resolved reports can carry a standing verdict, so everything else is dropped before the
        // query is even built — on a normal queue page that is most of the rows.
        var resolvedAt = reports
            .Where(r => r.ResolvedAt is not null)
            .ToDictionary(r => r.Id, r => r.ResolvedAt!.Value);

        if (resolvedAt.Count == 0) return [];

        var ids = resolvedAt.Keys.ToList();
        var rows = await db.ResolutionVerifications.AsNoTracking()
            .Where(v => ids.Contains(v.ReportId))
            .Select(v => new { v.ReportId, v.ResolvedAt, v.Outcome })
            .ToListAsync(ct);

        // At most one row can survive this filter per report — (report_id, resolved_at) is unique — so
        // ToDictionary cannot throw on a duplicate key.
        return rows
            .Where(v => resolvedAt[v.ReportId] == v.ResolvedAt)
            .ToDictionary(v => v.ReportId, v => v.Outcome.ToString());
    }
}
