import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from '../api/client';
import type { DuplicateReviewItemDto, ReportListItemDto } from '../api/types';
import {
  CategoryChip, EmptyState, ErrorState, Spinner, StatusBadge, formatDateTime, formatRelative,
} from '../components/ui';

/**
 * The duplicate review queue.
 *
 * Two reports side by side, with the score broken into its parts — distance, text overlap, category
 * match — so the clerk can see *why* the system paired them and disagree with it. The system never
 * merges on its own; a false merge in front of a jury would cost far more than an extra ticket.
 */
export function DuplicatesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['duplicates'],
    queryFn: api.duplicates,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  };

  const confirm = useMutation({ mutationFn: api.confirmDuplicate, onSuccess: invalidate });
  const reject = useMutation({ mutationFn: api.rejectDuplicate, onSuccess: invalidate });

  return (
    <div style={{ padding: '22px 26px 48px', maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1>Radha e dublikimeve</h1>
      </header>

      {isLoading ? <Spinner />
        : isError ? <ErrorState error={error} onRetry={() => refetch()} />
        : !data || data.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Asnjë dublikim për shqyrtim"
              hint="Kur dy raporte të ngjashme mbërrijnë brenda 150 metrave nga njëri-tjetri, do të shfaqen këtu."
            />
          </div>
        ) : (
          <div className="stack-16">
            {data.map(item => (
              <DuplicatePair
                key={item.candidateId}
                item={item}
                busy={confirm.isPending || reject.isPending}
                onConfirm={() => confirm.mutate(item.candidateId)}
                onReject={() => reject.mutate(item.candidateId)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

function DuplicatePair({ item, busy, onConfirm, onReject }: {
  item: DuplicateReviewItemDto; busy: boolean; onConfirm: () => void; onReject: () => void;
}) {
  const scorePct = Math.round(item.score * 100);
  const strong = item.score >= 0.75;

  return (
    <section className="card">
      <header className="card-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 12 }}>
          <div
            style={{
              display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 12, flex: 'none',
              background: strong
                ? 'color-mix(in srgb, var(--warning) 14%, transparent)'
                : 'var(--surface-3)',
              border: `1px solid ${strong ? 'color-mix(in srgb, var(--warning) 40%, transparent)' : 'var(--border)'}`,
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: strong ? 'var(--warning)' : 'var(--ink-2)' }}>
              {scorePct}%
            </span>
          </div>
          <div>
            <h2 style={{ fontSize: 15 }}>Përputhje e mundshme</h2>
            {/* The score breakdown is the explainability: no black box, just three legible numbers. */}
            <p className="muted" style={{ fontSize: 12.5 }}>
              {item.distanceMeters.toFixed(0)} m distancë · ngjashmëri teksti{' '}
              {Math.round(item.textSimilarity * 100)}% ·{' '}
              {item.method.includes('same-category') ? 'e njëjta kategori' : 'kategori të ndryshme'}
            </p>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" disabled={busy} onClick={onReject}>
            Nuk janë të njëjta
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onConfirm}>
            Bashko raportet
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 0, alignItems: 'stretch' }}>
        <SideCard report={item.newReport} caption="Raporti i ri" />
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
        <SideCard report={item.existingReport} caption="Raporti ekzistues (do të mbetet)" />
      </div>
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
            {report.confirmationCount > 1 && (
              <span className="chip">{report.confirmationCount} konfirmime</span>
            )}
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
