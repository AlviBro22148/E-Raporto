import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from '../api/client';
import type { PhotoReuseFlagDto, ReportListItemDto } from '../api/types';
import {
  CategoryChip, EmptyState, ErrorState, Spinner, StatusBadge, formatDateTime, formatRelative,
} from '../components/ui';

/**
 * The reused-photo review queue.
 *
 * Not an attempt at "is this photo AI-generated" — no model does that reliably, and this app doesn't
 * claim capabilities it doesn't have. Instead, a deterministic perceptual hash catches the far more
 * common version of photo fraud: the same picture, or a lightly edited copy of it, used on two
 * different reports — an old "before" photo reused to claim a fixed problem is still broken, or a
 * stock image recycled across unrelated complaints. Reusing a photo isn't proof on its own — a citizen
 * can legitimately resubmit their own photo — so nothing merges or changes on either report; a clerk
 * just gets the pairing surfaced for a look.
 */
export function PhotoReusePage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['photo-reuse'],
    queryFn: api.photoReuseFlags,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['photo-reuse'] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
  };

  const acknowledge = useMutation({ mutationFn: api.acknowledgePhotoReuseFlag, onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: api.dismissPhotoReuseFlag, onSuccess: invalidate });

  return (
    <div style={{ padding: '22px 26px 48px', maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 18 }}>
        <h1>Foto të ripërdorura</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 2, maxWidth: 680 }}>
          Kur e njëjta foto — ose një kopje lehtësisht e ndryshuar e saj — shfaqet në dy raporte të
          ndryshme, sistemi e sinjalizon për shqyrtim. Kjo nuk është provë mashtrimi vetvetiu: një
          qytetar mund të ridërgojë ligjërisht foton e vet. Asgjë nuk ndryshon në asnjë raport derisa
          një person të vendosë.
        </p>
      </header>

      {isLoading ? <Spinner />
        : isError ? <ErrorState error={error} onRetry={() => refetch()} />
        : !data || data.length === 0 ? (
          <div className="card">
            <EmptyState
              title="Asnjë foto e ripërdorur për shqyrtim"
              hint="Kur e njëjta foto shfaqet në dy raporte të ndryshme, do të shfaqet këtu."
            />
          </div>
        ) : (
          <div className="stack-16">
            {data.map(item => (
              <PhotoReusePair
                key={item.flagId}
                item={item}
                busy={acknowledge.isPending || dismiss.isPending}
                onAcknowledge={() => acknowledge.mutate(item.flagId)}
                onDismiss={() => dismiss.mutate(item.flagId)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

function PhotoReusePair({ item, busy, onAcknowledge, onDismiss }: {
  item: PhotoReuseFlagDto; busy: boolean; onAcknowledge: () => void; onDismiss: () => void;
}) {
  // Out of 64 bits — 0 is a pixel-identical match, up to the 6-bit threshold is a resize/recompress/crop
  // of the same photo. Shown as-is, same explainability principle as the duplicate score breakdown.
  const exact = item.hammingDistance === 0;

  return (
    <section className="card">
      <header className="card-head" style={{ alignItems: 'center' }}>
        <div className="row" style={{ gap: 12 }}>
          <div
            style={{
              display: 'grid', placeItems: 'center', width: 52, height: 52, borderRadius: 12, flex: 'none',
              background: exact
                ? 'color-mix(in srgb, var(--warning) 14%, transparent)'
                : 'var(--surface-3)',
              border: `1px solid ${exact ? 'color-mix(in srgb, var(--warning) 40%, transparent)' : 'var(--border)'}`,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: exact ? 'var(--warning)' : 'var(--ink-2)' }}>
              {item.hammingDistance}/64
            </span>
          </div>
          <div>
            <h2 style={{ fontSize: 15 }}>{exact ? 'Foto identike' : 'Foto e ngjashme'}</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>
              {item.hammingDistance} bit diferencë · sinjalizuar {formatRelative(item.createdAt)}
            </p>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" disabled={busy} onClick={onDismiss}>
            Rast i rremë
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={onAcknowledge}>
            Prano për ndjekje
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 0, alignItems: 'stretch' }}>
        <SideCard report={item.report} caption="Raporti i ri" />
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
        <SideCard report={item.matchedReport} caption="Raporti i mëparshëm" />
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
