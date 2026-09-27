namespace E_RaportoBackend.Domain;

/// <summary>Lifecycle of a citizen report. Transitions are enforced server-side by ReportWorkflow.</summary>
public enum ReportStatus
{
    Submitted = 0,
    InReview = 1,
    Assigned = 2,
    InProgress = 3,
    Resolved = 4,
    Rejected = 5,
    /// <summary>Confirmed duplicate of another report; see <see cref="Report.MergedIntoReportId"/>.</summary>
    Merged = 6
}

public enum ReportPriority
{
    Low = 0,
    Normal = 1,
    High = 2,
    Urgent = 3
}

public enum StaffRole
{
    /// <summary>Sees every department, manages users and duplicates.</summary>
    Admin = 0,
    /// <summary>Sees and assigns within their own department.</summary>
    Supervisor = 1,
    /// <summary>Works reports assigned to them.</summary>
    FieldAgent = 2
}

public enum DuplicateReviewStatus
{
    Pending = 0,
    Confirmed = 1,
    Rejected = 2,
    AutoDismissed = 3
}

/// <summary>
/// Which engine produced the effective categorisation. Persisted and surfaced in the UI so we can be
/// honest about when the LLM actually ran versus when we fell back to deterministic rules.
/// </summary>
public enum ClassificationSource
{
    RuleBased = 0,
    Llm = 1,
    Manual = 2
}

public enum NotificationType
{
    StatusChanged = 0,
    Assigned = 1,
    Resolved = 2,
    MergedIntoExisting = 3,
    Acknowledged = 4,
    /// <summary>
    /// The municipality says it is fixed and we are asking the person who reported it whether that is
    /// true. Its own type rather than a <see cref="Resolved"/> variant because the clients treat it as
    /// a task with an answer owed, not as news: the mobile app opens the verification screen off this.
    /// </summary>
    VerificationRequested = 5
}

/// <summary>
/// The reporter's verdict on a resolution they were asked to check.
///
/// Two values, deliberately. "Partly" or "not sure" would be kinder to the municipality and would
/// quietly destroy the only number this feature exists to produce: the share of closures the citizen
/// who raised them actually stands behind. A question with a soft middle is a question nobody has to
/// answer honestly.
/// </summary>
public enum VerificationOutcome
{
    Confirmed = 0,
    Disputed = 1
}

/// <summary>
/// What kind of link the AI found between the reports in a <see cref="SystemicPattern"/> — and,
/// concretely, what a supervisor should do about it. The two are not the same kind of problem:
/// <see cref="SharedCause"/> means one physical thing is producing several visible symptoms and a single
/// inspection could close every member at once. <see cref="SystemicCondition"/> means each report has its
/// own distinct local cause, but the cluster as a whole points at a structural condition (aging pipework,
/// chronic under-maintenance) that no single site visit fixes — this belongs in a planning conversation,
/// not a work order.
/// </summary>
public enum ConnectionType
{
    SharedCause = 0,
    SystemicCondition = 1,
    /// <summary>The count crossed the threshold, but the AI honestly can't tell which of the two this
    /// is without an inspector on site. Stated rather than guessed, same as everywhere else in this app.</summary>
    Uncertain = 2
}

/// <summary>Mirrors <see cref="DuplicateReviewStatus"/> in shape, not in meaning — a pattern is never
/// "confirmed" into a merge, only acknowledged as real or dismissed as a false positive.</summary>
public enum PatternReviewStatus
{
    Pending = 0,
    Acknowledged = 1,
    Dismissed = 2
}

/// <summary>Same shape as <see cref="PatternReviewStatus"/>, same reasoning: a photo-reuse flag is never
/// "confirmed" into anything — reusing a photo isn't proof of fraud on its own (a citizen can legitimately
/// resubmit their own photo), so a human always looks and either acknowledges it as worth following up
/// on or dismisses it as a false positive. Neither action touches the two reports it points at.</summary>
public enum PhotoReuseReviewStatus
{
    Pending = 0,
    Acknowledged = 1,
    Dismissed = 2
}
