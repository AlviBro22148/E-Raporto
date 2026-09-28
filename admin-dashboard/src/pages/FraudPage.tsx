import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from '../api/client';
import type { FraudFlagDto, FraudFlagKind, ReportListItemDto } from '../api/types';
import {
  CategoryChip, EmptyState, ErrorState, FRAUD_KIND_COLOR, FRAUD_KIND_LABEL, Spinner, StatusBadge,
  formatDateTime, formatRelative,
} from '../components/ui';

/**
 * The unified fraud review queue — every reason a report might be worth a second look, in one place.
 * Six are automated (a perceptual hash, a distance check, four calibrated Claude vision questions), one
 * is a clerk's own judgement call with no algorithm behind it. None of them are proof: reusing a photo,
 * text that reads templated, a photo whose GPS doesn't match the pin — every one of these has an honest
 * explanation as often as a dishonest one. Nothing here ever touches the report(s) it points at; a flag
 * only ever asks a clerk to look, and acknowledging one just records that the look happened.
 */
const KIND_ORDER = Object.keys(FRAUD_KIND_LABEL) as FraudFlagKind[];

function formatScore(flag: FraudFlagDto): string | null {
  if (flag.score == null) return null;
  switch (flag.kind) {
    case 'PhotoReuse': return `${flag.score}/64 bit diferencë`;
    case 'GpsMismatch': return `${flag.score.toLocaleString('sq-AL')} m larg nga pika e shënuar`;
    case 'TemplatedText': return `${Math.round(flag.score * 100)}% përputhje teksti`;
    default: return `${Math.round(flag.score * 100)}% siguri`;
  }
}

export function FraudPage() {
  const queryClient = useQueryClient();
  const [kindFilter, setKindFilter] = useState<FraudFlagKind | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fraud'],
    queryFn: api.fraudFlags,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['fraud'] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const acknowledge = useMutation({ mutationFn: api.acknowledgeFraudFlag, onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: api.dismissFraudFlag, onSuccess: invalidate });

  const counts = useMemo(() => {
    const byKind = new Map<FraudFlagKind, number>();
    for (const flag of data ?? []) byKind.set(flag.kind, (byKind.get(flag.kind) ?? 0) + 1);
    return byKind;
  }, [data]);

  const visible = kindFilter ? (data ?? []).filter(f => f.kind === kindFilter) : data;

  return (
    <div style={{ padding: '22px 26px 48px', maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1>Mashtrime të mundshme</h1>
      </header>

      {isLoading ? <Spinner />
        : isError ? <ErrorState error={error} onRetry={() => refetch()} />
        : !data || data.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Asnjë rast për shqyrtim"
              hint="Çdo sinjal — foto e ripërdorur, tekst i kopjuar, ose një shënim i stafit — do të shfaqet këtu."
            />
          </div>
        ) : (
          <>
            <div className="row-wrap" style={{ gap: 6, marginBottom: 18 }}>
              <button
                onClick={() => setKindFilter(null)}
                aria-pressed={kindFilter === null}
                className="chip"
                style={{
                  cursor: 'pointer',
                  background: kindFilter === null ? 'var(--brand-100)' : 'var(--surface-3)',
                  borderColor: kindFilter === null ? 'var(--brand-600)' : 'var(--border)',
                  color: kindFilter === null ? 'var(--brand-700)' : 'var(--ink-2)',
                }}
              >
                Të gjitha · {data.length}
              </button>
              {KIND_ORDER.filter(kind => counts.has(kind)).map(kind => {
                const active = kindFilter === kind;
                return (
                  <button
                    key={kind}
                    onClick={() => setKindFilter(active ? null : kind)}
                    aria-pressed={active}
                    className="chip"
                    style={{
                      cursor: 'pointer',
                      background: active ? 'var(--brand-100)' : 'var(--surface-3)',
                      borderColor: active ? 'var(--brand-600)' : 'var(--border)',
                      color: active ? 'var(--brand-700)' : 'var(--ink-2)',
                    }}
                  >
                    {FRAUD_KIND_LABEL[kind]} · {counts.get(kind)}
                  </button>
                );
              })}
            </div>

            <div className="stack-16">
              {visible!.map(flag => (
                <FraudCard
                  key={flag.flagId}
                  flag={flag}
                  busy={acknowledge.isPending || dismiss.isPending}
                  onAcknowledge={() => acknowledge.mutate(flag.flagId)}
                  onDismiss={() => dismiss.mutate(flag.flagId)}
                />
              ))}
            </div>
          </>
        )}
    </div>
  );
}

function FraudCard({ flag, busy, onAcknowledge, onDismiss }: {
  flag: FraudFlagDto; busy: boolean; onAcknowledge: () => void; onDismiss: () => void;
}) {
  const label = FRAUD_KIND_LABEL[flag.kind];
  const color = FRAUD_KIND_COLOR[flag.kind];
  const score = formatScore(flag);

  return (
    <section className="card">
      <header className="card-head" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 10, flex: 'none',
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
            }}
          >
            <span style={{ fontSize: 17 }}>{flag.kind === 'StaffFlagged' ? '🖐' : '⚠'}</span>
          </div>
          <div>
            <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
              <h2 style={{ fontSize: 15, color }}>{label}</h2>
              {score && <span className="muted" style={{ fontSize: 12.5 }}>{score}</span>}
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 620, marginTop: 4 }}>{flag.reasoning}</p>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              {flag.raisedByStaffName ? `${flag.raisedByStaffName} · ` : ''}
              sinjalizuar {formatRelative(flag.createdAt)}
            </p>
          </div>
        </div>

        <div className="row" style={{ gap: 8, flex: 'none' }}>
          <button className="btn btn-sm" disabled={busy} onClick={onDismiss}>
            Rast i rremë
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onAcknowledge}>
            Prano për ndjekje
          </button>
        </div>
      </header>

      {flag.relatedReport ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 0, alignItems: 'stretch' }}>
          <SideCard report={flag.report} caption="Raporti i sinjalizuar" />
          <div
            aria-hidden="true"
            style={{
              display: 'grid', placeItems: 'center', padding: '0 14px',
              borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
              color: 'var(--ink-3)', fontSize: 18,
            }}
          >
            ⧉
          </div>
          <SideCard report={flag.relatedReport} caption="Raporti tjetër" />
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <SideCard report={flag.report} caption="Raporti" />
        </div>
      )}
    </section>
  );
}

function SideCard({ report, caption }: { report: ReportListItemDto; caption: string }) {
  return (
    <div style={{ padding: '16px 20px' }}>
      <div className="label" style={{ marginBottom: 10 }}>{caption}</div>

      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        {report.thumbnailUrl && (
          <img
            src={mediaUrl(report.thumbnailUrl)}
            alt=""
            style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', flex: 'none' }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, marginBottom: 3 }}>
            <Link to={`/reports/${report.id}`} className="mono" style={{ fontSize: 11.5 }}>
              {report.publicRef}
            </Link>
            <StatusBadge status={report.status} />
          </div>
          <div style={{ fontWeight: 570, marginBottom: 4 }} className="clamp-2">{report.title}</div>
          {report.summarySq && (
            <p className="dim clamp-2" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>
              {report.summarySq}
            </p>
          )}
          <div className="row-wrap" style={{ gap: 8, marginBottom: 6 }}>
            <CategoryChip category={report.category} />
          </div>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {report.addressText ?? 'Pa adresë'}<br />
            {formatDateTime(report.createdAt)} · {formatRelative(report.createdAt)}
          </div>
        </div>
      </div>
    </div>
  );
}
