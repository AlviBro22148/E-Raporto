import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mediaUrl } from '../api/client';
import type { ReportPriority, ReportStatus } from '../api/types';
import {
  CONNECTION_COLOR, CONNECTION_HINT, CONNECTION_LABEL, Card, CategoryChip, ErrorState, HISTORY_KIND_LABEL,
  PRIORITY_LABEL, PriorityBadge, SOURCE_LABEL, SlaBadge, Spinner, STATUS_LABEL, STATUS_VAR, StatusBadge,
  formatDateTime, formatRelative, historyEntryKind,
} from '../components/ui';

const PRIORITIES: ReportPriority[] = ['Low', 'Normal', 'High', 'Urgent'];

export function ReportDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['report', id],
    queryFn: () => api.report(id),
    enabled: Boolean(id),
  });

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: api.departments });
  const { data: staff } = useQuery({ queryKey: ['staffUsers'], queryFn: api.staffUsers });

  const [note, setNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['report', id] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
    queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    setNote('');
    setActionError(null);
  };
  const onError = (err: unknown) =>
    setActionError(err instanceof Error ? err.message : 'Veprimi dështoi.');

  const statusMutation = useMutation({
    mutationFn: (status: ReportStatus) => api.changeStatus(id, status, note || undefined),
    onSuccess: invalidate, onError,
  });
  const assignMutation = useMutation({
    mutationFn: (body: { departmentId?: string; staffUserId?: string }) =>
      api.assign(id, { ...body, note: note || undefined }),
    onSuccess: invalidate, onError,
  });
  const categoryMutation = useMutation({
    mutationFn: (body: { categoryId: string; priority?: ReportPriority }) =>
      api.overrideCategory(id, { ...body, reason: overrideReason || undefined }),
    onSuccess: () => { setOverrideReason(''); invalidate(); }, onError,
  });
  const dossierMutation = useMutation({
    mutationFn: (publicRef: string) => api.downloadDossier(id, publicRef),
    onError,
  });

  if (isLoading) return <div style={{ padding: 26 }}><Spinner /></div>;
  if (isError || !data) return <div style={{ padding: 26 }}><ErrorState error={error} onRetry={() => refetch()} /></div>;

  const { report, statusHistory, duplicateCandidates, allowedNextStatuses, pattern } = data;
  const ai = report.ai;
  const busy = statusMutation.isPending || assignMutation.isPending || categoryMutation.isPending;

  return (
    <div style={{ padding: '22px 26px 48px', maxWidth: 1360, margin: '0 auto' }}>
      <button className="btn btn-sm btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 12 }}>
        ← Kthehu
      </button>

      <header className="row-wrap" style={{ marginBottom: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div className="row-wrap" style={{ gap: 8, marginBottom: 6 }}>
            <span className="mono muted" style={{ fontSize: 12 }}>{report.publicRef}</span>
            <StatusBadge status={report.status} />
            <PriorityBadge priority={report.priority} />
            <SlaBadge breached={report.isSlaBreached} dueAt={report.slaDueAt} />
          </div>
          <h1 style={{ marginBottom: 6 }}>{report.title}</h1>
          <p className="muted" style={{ fontSize: 13 }}>
            {report.addressText ?? 'Pa adresë'} · Raportuar {formatRelative(report.createdAt)}
            {report.confirmationCount > 1 && ` · ${report.confirmationCount} qytetarë e konfirmuan`}
          </p>
        </div>
      </header>

      {report.mergedIntoPublicRef && (
        <div
          className="card card-pad"
          style={{ marginBottom: 16, borderColor: 'var(--st-merged)', fontSize: 13 }}
        >
          Ky raport u bashkua me{' '}
          <Link to={`/reports/${report.mergedIntoReportId}`} className="mono">{report.mergedIntoPublicRef}</Link>.
          Qytetari që e dërgoi ndjek tani atë raport.
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="card card-pad"
          style={{
            marginBottom: 16, fontSize: 13, color: 'var(--danger)',
            borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)',
            background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))',
          }}
        >
          {actionError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(320px, 1fr)', gap: 18, alignItems: 'start' }}>
        {/* ── Left: the case itself ────────────────────────────────────────── */}
        <div className="stack-16">
          <Card title="Raporti i qytetarit">
            <p style={{ fontSize: 14, lineHeight: 1.65, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
              {report.description}
            </p>

            {report.photos.length > 0 && (
              <div className="row-wrap" style={{ marginBottom: 16 }}>
                {report.photos.map(photo => (
                  <a key={photo.url} href={mediaUrl(photo.url)} target="_blank" rel="noreferrer">
                    <img
                      src={mediaUrl(photo.url)}
                      alt="Foto e raportuar nga qytetari"
                      style={{
                        width: 168, height: 128, objectFit: 'cover',
                        borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                      }}
                    />
                  </a>
                ))}
              </div>
            )}

            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px', margin: 0, fontSize: 13 }}>
              <dt className="muted">Kategoria</dt>
              <dd style={{ margin: 0 }}><CategoryChip category={report.category} /></dd>
              <dt className="muted">Drejtoria</dt>
              <dd style={{ margin: 0 }}>{report.department?.name ?? '—'}</dd>
              <dt className="muted">Përgjegjësi</dt>
              <dd style={{ margin: 0 }}>{report.assignedTo?.fullName ?? 'I pacaktuar'}</dd>
              <dt className="muted">Koordinatat</dt>
              <dd style={{ margin: 0 }} className="mono">
                {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
              </dd>
              {/* A registered account, never a person. The name, email and telephone that used to sit
                  here are no longer served by the API at all — see ReportDetailDto. A clerk deciding
                  how to handle a pothole has no legitimate use for the identity of whoever reported
                  it, and every illegitimate use is the reason people stop reporting. */}
              <dt className="muted">Raportuesi</dt>
              <dd style={{ margin: 0 }}>
                Qytetar i regjistruar
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  Identiteti nuk i shfaqet asnjë punonjësi
                </div>
              </dd>
            </dl>
          </Card>

          {/*
            The AI panel is deliberately prominent and deliberately honest: it shows what the model
            said, how sure it was, WHICH engine ran, and it puts the override control right next to
            the suggestion rather than hiding it in a settings menu.
          */}
          <Card title="Vlerësimi i AI-së">
            <div className="row-wrap" style={{ gap: 10, marginBottom: 14 }}>
              <span className="chip">{SOURCE_LABEL[ai.source]}</span>
              {ai.model && <span className="chip mono">{ai.model}</span>}
              {ai.isOverridden && (
                <span
                  className="chip"
                  style={{
                    background: 'color-mix(in srgb, var(--st-assigned) 14%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--st-assigned) 35%, transparent)',
                    color: 'var(--st-assigned)',
                  }}
                >
                  ✎ Ndryshuar nga stafi
                </span>
              )}
            </div>

            {ai.confidence != null && (
              <div style={{ marginBottom: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="label" style={{ margin: 0 }}>Siguria e klasifikimit</span>
                  <strong style={{ fontSize: 15 }}>{Math.round(ai.confidence * 100)}%</strong>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.round(ai.confidence * 100)}%`, height: '100%',
                      background: ai.isLowConfidence ? 'var(--warning)'
                        : ai.confidence < 0.85 ? 'var(--st-inreview)' : 'var(--success)',
                    }}
                  />
                </div>
                {ai.isLowConfidence && (
                  <p style={{ fontSize: 12.5, color: 'var(--warning)', marginTop: 8, lineHeight: 1.55 }}>
                    Nën pragun 65%. Ky raport nuk u drejtua automatikisht — pret vendimin tuaj.
                  </p>
                )}
              </div>
            )}

            {ai.suggestedCategoryNameSq && (
              <p className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
                Sugjerimi fillestar: <strong>{ai.suggestedCategoryNameSq}</strong>
                {ai.suggestedPriority && ` · prioritet ${PRIORITY_LABEL[ai.suggestedPriority]}`}
              </p>
            )}

            {ai.reasoning && (
              <blockquote
                style={{
                  margin: '0 0 14px', padding: '10px 14px',
                  borderLeft: '3px solid var(--border-strong)',
                  background: 'var(--surface-2)', borderRadius: '0 6px 6px 0',
                  fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)',
                }}
              >
                {ai.reasoning}
              </blockquote>
            )}

            {ai.overrideReason && (
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
                Arsyeja e ndryshimit: {ai.overrideReason}
              </p>
            )}

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <span className="label">Korrigjo kategorinë</span>
              <div className="row-wrap" style={{ gap: 8, marginBottom: 10 }}>
                {categories?.map(category => {
                  const active = report.category?.id === category.id;
                  return (
                    <button
                      key={category.id}
                      className="chip"
                      disabled={busy}
                      aria-pressed={active}
                      style={{
                        cursor: busy ? 'wait' : 'pointer',
                        background: active ? `color-mix(in srgb, ${category.colorHex} 16%, transparent)` : 'var(--surface-3)',
                        borderColor: active ? category.colorHex : 'var(--border)',
                        color: active ? 'var(--ink)' : 'var(--ink-2)',
                      }}
                      onClick={() => !active && categoryMutation.mutate({ categoryId: category.id })}
                    >
                      <span className="swatch" style={{ background: category.colorHex }} aria-hidden="true" />
                      {category.nameSq}
                    </button>
                  );
                })}
              </div>
              <input
                className="input"
                placeholder="Arsyeja e ndryshimit (opsionale, ruhet në historik)"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
              />

              <span className="label" style={{ marginTop: 14 }}>Prioriteti</span>
              <div className="row-wrap" style={{ gap: 8 }}>
                {PRIORITIES.map(priority => (
                  <button
                    key={priority}
                    className="chip"
                    disabled={busy || !report.category}
                    aria-pressed={report.priority === priority}
                    style={{
                      cursor: 'pointer',
                      background: report.priority === priority ? 'var(--brand-100)' : 'var(--surface-3)',
                      borderColor: report.priority === priority ? 'var(--brand-600)' : 'var(--border)',
                    }}
                    onClick={() => report.category &&
                      categoryMutation.mutate({ categoryId: report.category.id, priority })}
                  >
                    {PRIORITY_LABEL[priority]}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/*
            The root-cause counterpart to the duplicate card below: where a duplicate says "this is the
            SAME physical problem", a pattern says "these are DIFFERENT problems that may share a cause
            or point at a wider condition". Nothing here changes this report — acting on the pattern
            itself happens on its own page.
          */}
          {pattern && (
            <Card title="Model sistemik i mundshëm">
              <div className="row-wrap" style={{ gap: 10, marginBottom: 12 }}>
                <span
                  className="chip"
                  style={{
                    background: pattern.connectionType
                      ? `color-mix(in srgb, ${CONNECTION_COLOR[pattern.connectionType]} 14%, transparent)`
                      : 'var(--surface-3)',
                    borderColor: pattern.connectionType
                      ? `color-mix(in srgb, ${CONNECTION_COLOR[pattern.connectionType]} 40%, transparent)`
                      : 'var(--border)',
                    color: pattern.connectionType ? CONNECTION_COLOR[pattern.connectionType] : 'var(--ink-2)',
                  }}
                >
                  {pattern.connectionType ? CONNECTION_LABEL[pattern.connectionType] : 'Pa sintezë nga AI'}
                </span>
                <span className="chip">{pattern.memberCount} raporte</span>
                {pattern.confidence != null && (
                  <span className="chip">{Math.round(pattern.confidence * 100)}% siguri</span>
                )}
              </div>

              {pattern.connectionType && (
                <p className="dim" style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.5 }}>
                  {CONNECTION_HINT[pattern.connectionType]}
                </p>
              )}

              {pattern.summarySq && (
                <blockquote
                  style={{
                    margin: '0 0 14px', padding: '10px 14px',
                    borderLeft: '3px solid var(--border-strong)',
                    background: 'var(--surface-2)', borderRadius: '0 6px 6px 0',
                    fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)',
                  }}
                >
                  {pattern.summarySq}
                </blockquote>
              )}

              <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Shqyrtojeni te <Link to="/patterns">modelet sistemike</Link>.
              </p>
            </Card>
          )}

          {duplicateCandidates.length > 0 && (
            <Card title={`Dublikime të mundshme (${duplicateCandidates.length})`}>
              <div className="stack-8">
                {duplicateCandidates.map(candidate => (
                  <Link
                    key={candidate.candidateId}
                    to={`/reports/${candidate.reportId}`}
                    className="row"
                    style={{
                      gap: 12, padding: 12, borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', background: 'var(--surface-2)',
                      textDecoration: 'none', color: 'inherit',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono muted" style={{ fontSize: 11 }}>{candidate.publicRef}</div>
                      <div className="truncate" style={{ fontWeight: 550 }}>{candidate.title}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {candidate.distanceMeters.toFixed(0)} m larg · ngjashmëri teksti{' '}
                        {Math.round(candidate.textSimilarity * 100)}%
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 17, fontWeight: 680 }}>{Math.round(candidate.score * 100)}%</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>përputhje</div>
                    </div>
                  </Link>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                Shqyrtojini dhe vendosni te <Link to="/duplicates">radha e dublikimeve</Link>.
              </p>
            </Card>
          )}
        </div>

        {/* ── Right: the actions and the audit trail ───────────────────────── */}
        <div className="stack-16">
          {/*
            The reporter's verdict, first on the page for a resolved case — above the dossier, above the
            actions. A dispute is the only thing in this dashboard that says the municipality's own
            record of what happened is wrong, and it earns the top of the column: a clerk who has to
            scroll to find out that a closure was rejected will not find out.
          */}
          {report.verification ? (
            <Card title="Verifikimi i qytetarit">
              <div
                className="row"
                style={{
                  gap: 10, padding: '10px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12,
                  background: report.verification.outcome === 'Confirmed'
                    ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                    : 'color-mix(in srgb, var(--danger) 10%, transparent)',
                  border: `1px solid color-mix(in srgb, ${
                    report.verification.outcome === 'Confirmed' ? 'var(--success)' : 'var(--danger)'
                  } 30%, transparent)`,
                }}
              >
                <span style={{ fontSize: 17 }} aria-hidden="true">
                  {report.verification.outcome === 'Confirmed' ? '✓' : '⚠'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {report.verification.outcome === 'Confirmed'
                      ? 'Konfirmuar se u rregullua'
                      : 'Kontestuar — sipas raportuesit problemi vazhdon'}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    Raportuesi · {formatRelative(report.verification.createdAt)}
                  </div>
                </div>
              </div>

              {report.verification.comment && (
                <p style={{ fontSize: 13, margin: '0 0 12px', lineHeight: 1.55 }}>
                  “{report.verification.comment}”
                </p>
              )}

              {report.verification.photoUrl && (
                <>
                  <img
                    src={mediaUrl(report.verification.photoUrl)}
                    alt="Fotografia e verifikimit, dërguar nga raportuesi pas zgjidhjes"
                    style={{
                      width: '100%', borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)', display: 'block',
                    }}
                  />
                  <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                    Gjendja pas ndërhyrjes, sipas raportuesit
                    {report.verification.distanceMeters != null && (
                      report.verification.isNearOriginalPin
                        ? ` · ${Math.round(report.verification.distanceMeters)} m nga pika e raportuar`
                        : ` · ${Math.round(report.verification.distanceMeters)} m nga pika e raportuar — jashtë rrezes së pritur`
                    )}
                  </p>
                </>
              )}

              {report.verification.photoUrl == null && report.verification.distanceMeters != null && (
                <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
                  Përgjigje pa foto · {Math.round(report.verification.distanceMeters)} m nga pika e raportuar
                </p>
              )}

              {report.verification.outcome === 'Disputed' && (
                <p className="muted" style={{ fontSize: 12, margin: '12px 0 0', lineHeight: 1.5 }}>
                  Kontestimi nuk e rihap automatikisht rastin — vendimi është i juaji. Ai qëndron
                  përgjithmonë në historikun e rastit dhe zbret nga norma e zgjidhjeve të verifikuara.
                </p>
              )}
            </Card>
          ) : report.status === 'Resolved' ? (
            <Card title="Verifikimi i qytetarit">
              <p className="muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
                Raportuesi është pyetur nëse problemi është rregulluar dhe nuk është përgjigjur
                ende. Deri atëherë ky rast numërohet si i pazgjidhur nga qytetari në statistika.
              </p>
            </Card>
          ) : null}

          {/* A closed case is also a record that has to leave the system — on paper, in an archive,
              or attached to a work order. That is why this sits first once the case is resolved. */}
          {report.status === 'Resolved' && (
            <Card title="Dosja e rastit">
              <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.5 }}>
                Dokument Word me të gjitha të dhënat e rastit: përshkrimin, fotografitë, kronologjinë dhe
                afatet, vlerësimin e AI-së, të dhënat e raportuesit dhe historikun e plotë — gati për
                printim, arkivim dhe firmë.
              </p>
              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={dossierMutation.isPending}
                onClick={() => dossierMutation.mutate(report.publicRef)}
              >
                {dossierMutation.isPending ? 'Po gjenerohet…' : '⬇  Shkarko dosjen (.docx)'}
              </button>
            </Card>
          )}

          {/* A closed case gets one action, not a control panel. Reassigning a department or flipping
              a status on a finished record is noise at best and a silent edit of an archived file at
              worst — the one thing still legitimately needed is reopening it, so that is all that
              shows, under its real name rather than the generic "I caktuar" the status list produces. */}
          {report.status === 'Resolved' ? (
            <Card title="Veprime">
              {allowedNextStatuses.includes('Assigned') ? (
                <>
                  <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.5 }}>
                    Rasti është i mbyllur. Rihapeni vetëm nëse problemi vazhdon ose puna nuk u krye siç
                    duhet — raporti i kthehet të njëjtës drejtori dhe qytetari njoftohet.
                  </p>
                  <span className="label">Arsyeja e rihapjes (shihet nga qytetari)</span>
                  <textarea
                    className="textarea"
                    placeholder="p.sh. Qytetari raportoi se gropa është ende aty."
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    style={{ marginBottom: 14 }}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => statusMutation.mutate('Assigned')}
                  >
                    ↩  Rihap rastin
                  </button>
                </>
              ) : (
                <span className="muted" style={{ fontSize: 12.5 }}>Ky raport është në gjendje përfundimtare.</span>
              )}
            </Card>
          ) : (
          <Card title="Veprime">
            <span className="label">Shënim publik (shihet nga qytetari)</span>
            <textarea
              className="textarea"
              placeholder="p.sh. Ekipi është në terren dhe puna nis nesër."
              value={note}
              onChange={e => setNote(e.target.value)}
              style={{ marginBottom: 14 }}
            />

            <span className="label">Ndrysho statusin</span>
            <div className="row-wrap" style={{ gap: 8, marginBottom: 16 }}>
              {allowedNextStatuses.length === 0 && (
                <span className="muted" style={{ fontSize: 12.5 }}>Ky raport është në gjendje përfundimtare.</span>
              )}
              {allowedNextStatuses.map(status => (
                <button
                  key={status}
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => statusMutation.mutate(status)}
                  style={{
                    borderColor: `color-mix(in srgb, ${STATUS_VAR[status]} 45%, var(--border))`,
                    color: STATUS_VAR[status],
                  }}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>

            <span className="label">Cakto drejtorinë</span>
            <select
              className="select"
              value={report.department?.id ?? ''}
              disabled={busy}
              onChange={e => e.target.value && assignMutation.mutate({ departmentId: e.target.value })}
              style={{ marginBottom: 14 }}
            >
              <option value="">Zgjidh drejtorinë…</option>
              {departments?.map(d => (
                <option key={d.id} value={d.id}>{d.shortName} · SLA {d.slaHours}h</option>
              ))}
            </select>

            <span className="label">Cakto përgjegjësin</span>
            <select
              className="select"
              value={report.assignedTo?.id ?? ''}
              disabled={busy}
              onChange={e => e.target.value && assignMutation.mutate({ staffUserId: e.target.value })}
            >
              <option value="">Zgjidh punonjësin…</option>
              {staff?.map(u => (
                <option key={u.id} value={u.id}>{u.fullName}{u.departmentName ? ` · ${u.departmentName}` : ''}</option>
              ))}
            </select>
          </Card>
          )}

          <Card title="Historiku">
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {statusHistory.map((entry, index) => {
                const kind = historyEntryKind(entry);
                const dotColor = kind === 'confirmed' ? 'var(--success)' : kind === 'disputed' ? 'var(--danger)' : STATUS_VAR[entry.toStatus];
                return (
                <li key={entry.id} style={{ display: 'flex', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 9, height: 9, borderRadius: '50%', marginTop: 5,
                        background: dotColor, flex: 'none',
                      }}
                    />
                    {index < statusHistory.length - 1 && (
                      <span aria-hidden="true" style={{ width: 1, flex: 1, background: 'var(--border)', minHeight: 22 }} />
                    )}
                  </div>
                  <div style={{ paddingBottom: 16, flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 570 }}>
                      {kind ? HISTORY_KIND_LABEL[kind] : STATUS_LABEL[entry.toStatus]}
                    </div>
                    {entry.note && (
                      <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 2 }}>{entry.note}</div>
                    )}
                    <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                      {entry.changedByLabel} · {formatDateTime(entry.createdAt)}
                    </div>
                  </div>
                </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
