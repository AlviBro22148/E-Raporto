import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { SystemicPatternDto, SystemicPatternMemberDto } from '../api/types';
import {
  CONNECTION_COLOR, CONNECTION_HINT, CONNECTION_LABEL, EmptyState, ErrorState, STATUS_LABEL,
  STATUS_VAR, Spinner, StatusBadge, formatDateTime, formatRelative,
} from '../components/ui';

/**
 * The systemic-pattern review queue — the root-cause counterpart to the duplicate queue.
 *
 * Where duplicates ask "is this the same physical problem as that one?", a pattern answers a different
 * question: do several DIFFERENT reports, taken together, point at one thing worth investigating as a
 * whole? A pattern never merges its members — each stays its own case, inspected and closed on its own.
 */
export function PatternsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patterns'],
    queryFn: api.patterns,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['patterns'] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const acknowledge = useMutation({ mutationFn: api.acknowledgePattern, onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: api.dismissPattern, onSuccess: invalidate });
  const refresh = useMutation({ mutationFn: api.refreshPattern, onSuccess: invalidate });

  return (
    <div style={{ padding: '22px 26px 48px', maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1>Modele sistemike</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 2, maxWidth: 680 }}>
          Kur disa raporte <em>të ndryshme</em> — jo i njëjti incident, por probleme më vete — vijnë nga
          e njëjta zonë dhe kategori brenda pak muajsh, sistemi kontrollon nëse ka gjasa të ndajnë një
          shkak. Asgjë nuk bashkohet: secili rast mbetet i veçantë, ky është vetëm një këndvështrim shtesë.
        </p>
      </header>

      {isLoading ? <Spinner />
        : isError ? <ErrorState error={error} onRetry={() => refetch()} />
        : !data || data.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Asnjë model sistemik për shqyrtim"
              hint="Kur tre ose më shumë raporte të së njëjtës kategori grumbullohen pranë njëri-tjetrit brenda katër muajve, do të shfaqen këtu."
            />
          </div>
        ) : (
          <div className="stack-16">
            {data.map(pattern => (
              <PatternCard
                key={pattern.id}
                pattern={pattern}
                busy={acknowledge.isPending || dismiss.isPending || refresh.isPending}
                onAcknowledge={() => acknowledge.mutate(pattern.id)}
                onDismiss={() => dismiss.mutate(pattern.id)}
                onRefresh={() => refresh.mutate(pattern.id)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

function PatternCard({ pattern, busy, onAcknowledge, onDismiss, onRefresh }: {
  pattern: SystemicPatternDto; busy: boolean;
  onAcknowledge: () => void; onDismiss: () => void; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const type = pattern.connectionType;
  const color = type ? CONNECTION_COLOR[type] : 'var(--ink-3)';
  const confidencePct = pattern.confidence == null ? null : Math.round(pattern.confidence * 100);

  return (
    <section className="card">
      <header className="card-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 12 }}>
          <div
            style={{
              display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 12, flex: 'none',
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{pattern.memberCount}</span>
          </div>
          <div>
            <h2 style={{ fontSize: 15 }}>
              {type ? CONNECTION_LABEL[type] : 'Grup i pashqyrtuar nga AI'}
              {confidencePct != null && (
                <span className="muted" style={{ fontSize: 12, fontWeight: 500, marginLeft: 8 }}>
                  {confidencePct}% siguri
                </span>
              )}
            </h2>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {pattern.category.nameSq}
              {pattern.department && ` · ${pattern.department.name}`} ·{' '}
              {pattern.memberCount} raporte · aktiv {formatRelative(pattern.lastReportAt)}
            </p>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" disabled={busy} onClick={onRefresh} title="Rithirr AI-në mbi anëtarësinë aktuale">
            ↻ Rifresko
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={onDismiss}>
            Shpërfill
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onAcknowledge}>
            Prano si real
          </button>
        </div>
      </header>

      <div className="card-pad" style={{ paddingTop: 0 }}>
        {type && (
          <p className="dim" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
            {CONNECTION_HINT[type]}
          </p>
        )}

        {pattern.summarySq ? (
          <blockquote
            style={{
              margin: '0 0 14px', padding: '10px 14px',
              borderLeft: `3px solid ${color}`,
              background: 'var(--surface-2)', borderRadius: '0 6px 6px 0',
              fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)',
            }}
          >
            {pattern.summarySq}
          </blockquote>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
            AI-ja nuk e ka analizuar ende këtë grup (çelësi jo i konfiguruar, ose thirrja dështoi) — vetëm
            numërimi është real. Shtypni “Rifresko” për të provuar sërish.
          </p>
        )}

        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setExpanded(e => !e)}
          style={{ marginBottom: expanded ? 10 : 0 }}
        >
          {expanded ? '▾' : '▸'} {pattern.members.length} raste në këtë model
        </button>

        {expanded && (
          <div className="stack-8">
            {pattern.members.map(member => <MemberRow key={member.id} member={member} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function MemberRow({ member }: { member: SystemicPatternMemberDto }) {
  return (
    <Link
      to={`/reports/${member.id}`}
      className="row"
      style={{
        gap: 12, padding: 12, borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)', background: 'var(--surface-2)',
        textDecoration: 'none', color: 'inherit',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8, marginBottom: 3 }}>
          <span className="mono muted" style={{ fontSize: 11 }}>{member.publicRef}</span>
          <StatusBadge status={member.status} />
        </div>
        <div className="truncate" style={{ fontWeight: 550 }}>{member.title}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {member.addressText ?? 'Pa adresë'} · {formatDateTime(member.createdAt)}
        </div>
      </div>
      <span
        aria-hidden="true"
        style={{ fontSize: 11, color: STATUS_VAR[member.status], fontWeight: 700 }}
      >
        {STATUS_LABEL[member.status]}
      </span>
    </Link>
  );
}
