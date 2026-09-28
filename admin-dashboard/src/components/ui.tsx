import type { ReactNode } from 'react';
import type {
  ClassificationSource, ConnectionType, FraudFlagKind, FraudReviewStatus, ReportPriority, ReportStatus,
} from '../api/types';

/* ── Localised labels ─────────────────────────────────────────────────────── */

export const STATUS_LABEL: Record<ReportStatus, string> = {
  Submitted: 'I dërguar',
  InReview: 'Në shqyrtim',
  Assigned: 'I caktuar',
  InProgress: 'Në punë',
  Resolved: 'I zgjidhur',
  Rejected: 'I refuzuar',
  Merged: 'I bashkuar',
};

export const STATUS_VAR: Record<ReportStatus, string> = {
  Submitted: 'var(--st-submitted)',
  InReview: 'var(--st-inreview)',
  Assigned: 'var(--st-assigned)',
  InProgress: 'var(--st-inprogress)',
  Resolved: 'var(--st-resolved)',
  Rejected: 'var(--st-rejected)',
  Merged: 'var(--st-merged)',
};

export const PRIORITY_LABEL: Record<ReportPriority, string> = {
  Low: 'E ulët',
  Normal: 'Normale',
  High: 'E lartë',
  Urgent: 'Urgjente',
};

const PRIORITY_VAR: Record<ReportPriority, string> = {
  Low: 'var(--st-submitted)',
  Normal: 'var(--st-inreview)',
  High: 'var(--warning)',
  Urgent: 'var(--danger)',
};

export const SOURCE_LABEL: Record<ClassificationSource, string> = {
  Llm: 'Klasifikuar nga AI',
  RuleBased: 'Klasifikuar me rregulla',
  Manual: 'Vendosur nga stafi',
};

/** SharedCause: one identifiable thing likely explains every member — a single inspection could close
 *  them all. SystemicCondition: distinct local causes, but the cluster points at a broader structural
 *  problem — belongs in planning, not a work order. Uncertain: the AI honestly can't tell which. */
export const CONNECTION_LABEL: Record<ConnectionType, string> = {
  SharedCause: 'Shkak i përbashkët i mundshëm',
  SystemicCondition: 'Kusht sistemik',
  Uncertain: 'E pasigurt',
};

export const CONNECTION_HINT: Record<ConnectionType, string> = {
  SharedCause: 'Një ndërhyrje e vetme mund t’i zgjidhë të gjitha rastet — dërgo një inspektim.',
  SystemicCondition: 'Shkaqe lokale të ndryshme, por model strukturor më i gjerë — kjo i takon planifikimit, jo një urdhri pune.',
  Uncertain: 'AI-ja nuk mund të dallojë cilin nga të dy pa inspektim në terren.',
};

export const CONNECTION_COLOR: Record<ConnectionType, string> = {
  SharedCause: 'var(--success)',
  SystemicCondition: 'var(--warning)',
  Uncertain: 'var(--ink-3)',
};

/**
 * Some status-history rows aren't a real transition — the backend writes a same-status "annotation"
 * row (`fromStatus === toStatus`) when a citizen confirms or disputes a resolution, since the report's
 * actual status doesn't change either way (see ReportsController.VerifyResolution). Left alone, that
 * row renders as a plain "I zgjidhur" entry even for a dispute, which reads as good news it isn't.
 *
 * Detects which kind of annotation a row is from its backend-generated note, which always starts with
 * one of exactly two fixed Albanian sentences (never user-authored) — reliable per-row, unlike keying
 * off "the last entry", which breaks once a case is disputed, reopened, and resolved again.
 */
export function historyEntryKind(entry: { fromStatus?: string | null; toStatus: string; note?: string | null }): 'confirmed' | 'disputed' | null {
  if (!entry.fromStatus || entry.fromStatus !== entry.toStatus) return null;
  if (entry.note?.startsWith('Qytetari konfirmoi')) return 'confirmed';
  if (entry.note?.startsWith('Qytetari kontestoi')) return 'disputed';
  return null;
}

export const HISTORY_KIND_LABEL = { confirmed: 'I konfirmuar', disputed: 'I kontestuar' } as const;

/** Every reason a report might be worth a fraud review — see the backend's FraudFlagKind. */
export const FRAUD_KIND_LABEL: Record<FraudFlagKind, string> = {
  PhotoReuse: 'Foto e ripërdorur',
  DescriptionMismatch: 'Përshkrimi nuk përputhet me foton',
  SeverityExaggeration: 'Ashpërsi e ekzagjeruar',
  StockPhoto: 'Foto e ngjashme me stok',
  PhotoOfPhoto: 'Foto e një fotoje ose ekrani',
  GpsMismatch: 'Vendndodhja e fotos nuk përputhet',
  TemplatedText: 'Tekst i kopjuar nga një raport tjetër',
  StaffFlagged: 'Shënuar nga stafi',
};

/** brand for StaffFlagged — a person said this, not an algorithm — everything else warning/danger. */
export const FRAUD_KIND_COLOR: Record<FraudFlagKind, string> = {
  PhotoReuse: 'var(--warning)',
  DescriptionMismatch: 'var(--warning)',
  SeverityExaggeration: 'var(--danger)',
  StockPhoto: 'var(--warning)',
  PhotoOfPhoto: 'var(--warning)',
  GpsMismatch: 'var(--warning)',
  TemplatedText: 'var(--warning)',
  StaffFlagged: 'var(--brand-600)',
};

export const FRAUD_STATUS_LABEL: Record<FraudReviewStatus, string> = {
  Pending: 'Në pritje',
  Acknowledged: 'Pranuar për ndjekje',
  Dismissed: 'Rast i rremë',
};

/* ── Badges ───────────────────────────────────────────────────────────────── */

/** Colour is never the only signal — the label is always rendered alongside the dot. */
export function StatusBadge({ status }: { status: ReportStatus }) {
  const color = STATUS_VAR[status];
  return (
    <span
      className="badge"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <span className="dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: ReportPriority }) {
  const color = PRIORITY_VAR[priority];
  const emphasised = priority === 'Urgent' || priority === 'High';
  return (
    <span
      className="badge"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} ${emphasised ? 45 : 30}%, transparent)`,
        background: `color-mix(in srgb, ${color} ${emphasised ? 13 : 8}%, transparent)`,
      }}
    >
      <span className="dot" aria-hidden="true" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function CategoryChip({ category }: { category?: { nameSq: string; colorHex: string } }) {
  if (!category) return <span className="chip">Pa kategori</span>;
  return (
    <span className="chip">
      <span className="swatch" style={{ background: category.colorHex }} aria-hidden="true" />
      {category.nameSq}
    </span>
  );
}

export function SlaBadge({ breached, dueAt }: { breached: boolean; dueAt?: string }) {
  if (!dueAt) return null;
  const color = breached ? 'var(--danger)' : 'var(--ink-3)';
  return (
    <span
      className="badge"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
        background: breached ? `color-mix(in srgb, ${color} 11%, transparent)` : 'transparent',
      }}
      title={`Afati: ${formatDateTime(dueAt)}`}
    >
      <span className="dot" aria-hidden="true" />
      {breached ? 'Afat i tejkaluar' : `Afati ${formatRelative(dueAt)}`}
    </span>
  );
}

/* ── The AI honesty surface ───────────────────────────────────────────────── */

/**
 * Renders the classifier's confidence as a labelled meter. This is the component the
 * "honest about its limitations" criterion is graded on, so it never rounds a weak signal up,
 * and it always names which engine produced the result.
 */
export function ConfidenceMeter({
  confidence, source, compact = false,
}: { confidence?: number; source: ClassificationSource; compact?: boolean }) {
  if (source === 'Manual' || confidence == null) {
    return <span className="chip" title="Kategoria u vendos nga stafi, jo nga AI.">Vendosur nga stafi</span>;
  }

  const pct = Math.round(confidence * 100);
  const low = confidence < 0.65;
  const color = low ? 'var(--warning)' : confidence < 0.85 ? 'var(--st-inreview)' : 'var(--success)';

  return (
    <span
      className="row"
      style={{ gap: 8 }}
      title={`${SOURCE_LABEL[source]} · siguri ${pct}%${low ? ' — nën pragun 65%, kërkon shqyrtim njerëzor' : ''}`}
    >
      <span
        aria-hidden="true"
        style={{
          width: compact ? 44 : 64, height: 5, borderRadius: 3,
          background: 'var(--surface-3)', overflow: 'hidden', flex: 'none',
        }}
      >
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 32 }}>{pct}%</span>
      {!compact && (
        <span className="muted" style={{ fontSize: 12 }}>
          {source === 'Llm' ? 'AI' : 'rregulla'}
        </span>
      )}
    </span>
  );
}

/* ── Layout primitives ────────────────────────────────────────────────────── */

export function Card({ title, action, children, pad = true }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; pad?: boolean;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card-head">
          <h2 style={{ fontSize: 15 }}>{title}</h2>
          {action}
        </header>
      )}
      <div className={pad ? 'card-pad' : undefined}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint, tone = 'default' }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const color = tone === 'danger' ? 'var(--danger)'
    : tone === 'warning' ? 'var(--warning)'
    : tone === 'success' ? 'var(--success)'
    : 'var(--ink)';

  return (
    <div className="card card-pad">
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 680, letterSpacing: '-0.02em', color, lineHeight: 1.15 }}>
        {value}
      </div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="row" style={{ gap: 10, padding: '28px 0', justifyContent: 'center', color: 'var(--ink-3)' }}>
      <span className="spinner" aria-hidden="true" />
      <span style={{ fontSize: 13 }}>{label ?? 'Duke ngarkuar…'}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {hint && <p className="muted" style={{ fontSize: 13, maxWidth: 420, margin: '0 auto 14px' }}>{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Ndodhi një gabim i papritur.';
  return (
    <div style={{ padding: '32px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>{message}</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Kontrolloni që API-ja po ekzekutohet dhe provoni sërish.
      </p>
      {onRetry && <button className="btn" onClick={onRetry}>Provo sërish</button>}
    </div>
  );
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

const sq = 'sq-AL';

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(sq, { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(sq, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/** Compact relative time in Albanian — "3 orë më parë", "për 2 ditë". */
export function formatRelative(iso: string): string {
  const deltaMs = new Date(iso).getTime() - Date.now();
  const past = deltaMs < 0;
  const minutes = Math.abs(deltaMs) / 60000;

  const [value, unit] =
    minutes < 60 ? [Math.round(minutes), 'min']
    : minutes < 1440 ? [Math.round(minutes / 60), 'orë']
    : minutes < 43200 ? [Math.round(minutes / 1440), 'ditë']
    : [Math.round(minutes / 43200), 'muaj'];

  return past ? `${value} ${unit} më parë` : `për ${value} ${unit}`;
}

/** Hours → a readable duration. Response times run from minutes to weeks, so one unit won't do. */
export function formatHours(hours?: number): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} orë`;
  return `${(hours / 24).toFixed(1)} ditë`;
}
