import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, mediaUrl } from '../api/client';
import type { ReportFilters, ReportStatus } from '../api/types';
import { ReportMap } from '../components/ReportMap';
import {
  CategoryChip, ConfidenceMeter, EmptyState, ErrorState, PriorityBadge, SlaBadge,
  Spinner, STATUS_LABEL, StatusBadge, formatRelative,
} from '../components/ui';

const STATUSES: ReportStatus[] = ['Submitted', 'InReview', 'Assigned', 'InProgress', 'Resolved', 'Rejected'];

export function ReportsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ReportFilters>({ page: 1, pageSize: 25, sort: 'newest' });
  const [searchDraft, setSearchDraft] = useState('');
  const [showMap, setShowMap] = useState(true);

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: api.departments });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['reports', filters],
    queryFn: () => api.reports(filters),
    // Keeps the previous page rendered while the next one loads, so the table doesn't flash empty
    // every time a clerk toggles a filter.
    placeholderData: keepPreviousData,
  });

  const patch = (next: Partial<ReportFilters>) => setFilters(f => ({ ...f, page: 1, ...next }));

  const toggleStatus = (status: ReportStatus) => {
    const current = filters.status ?? [];
    const next = current.includes(status) ? current.filter(s => s !== status) : [...current, status];
    patch({ status: next.length ? next : undefined });
  };

  const items = data?.items ?? [];
  const activeFilterCount = useMemo(
    () => [filters.status?.length, filters.categoryCode?.length, filters.departmentId,
      filters.needsReview, filters.hasPendingDuplicates, filters.disputed,
      filters.search].filter(Boolean).length,
    [filters],
  );

  return (
    <div style={{ padding: '22px 26px 40px', maxWidth: 1500, margin: '0 auto' }}>
      <header className="row" style={{ marginBottom: 18 }}>
        <div>
          <h1>Raportet</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {data ? `${data.total} raporte` : 'Duke ngarkuar…'}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filtra aktivë`}
          </p>
        </div>
        <div className="spacer" />
        {isFetching && <span className="spinner" aria-label="Duke rifreskuar" />}
        <button className="btn btn-sm" onClick={() => setShowMap(v => !v)}>
          {showMap ? 'Fshih hartën' : 'Shfaq hartën'}
        </button>
      </header>

      {/* Filters sit in one row above the content — never buried in a drawer a clerk has to hunt for. */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row-wrap" style={{ marginBottom: 12 }}>
          <form
            onSubmit={e => { e.preventDefault(); patch({ search: searchDraft }); }}
            style={{ flex: '1 1 260px', maxWidth: 380 }}
          >
            <input
              className="input"
              placeholder="Kërko sipas titullit, përshkrimit, adresës ose ELB-…"
              value={searchDraft}
              onChange={e => setSearchDraft(e.target.value)}
              aria-label="Kërko raporte"
            />
          </form>

          <select
            className="select" style={{ width: 'auto' }}
            value={filters.departmentId ?? ''}
            onChange={e => patch({ departmentId: e.target.value || undefined })}
            aria-label="Filtro sipas drejtorisë"
          >
            <option value="">Të gjitha drejtoritë</option>
            {departments?.map(d => <option key={d.id} value={d.id}>{d.shortName}</option>)}
          </select>

          <select
            className="select" style={{ width: 'auto' }}
            value={filters.sort ?? 'newest'}
            onChange={e => patch({ sort: e.target.value as ReportFilters['sort'] })}
            aria-label="Renditja"
          >
            <option value="newest">Më të rejat</option>
            <option value="oldest">Më të vjetrat</option>
            <option value="priority">Prioriteti</option>
            <option value="confirmations">Më të konfirmuarat</option>
          </select>

          <div className="spacer" />

          {/* The filters that turn honesty into actual work for a human — one for the AI's mistakes,
              one for the municipality's own. */}
          <button
            className={`btn btn-sm ${filters.needsReview ? 'btn-primary' : ''}`}
            onClick={() => patch({ needsReview: filters.needsReview ? undefined : true })}
            title="Raporte ku AI kishte siguri nën 65% — duan një sy njerëzor"
          >
            AI e pasigurt
          </button>
          <button
            className={`btn btn-sm ${filters.disputed ? 'btn-primary' : ''}`}
            onClick={() => patch({ disputed: filters.disputed ? undefined : true })}
            title="Raste të shënuara si të zgjidhura, por që raportuesi thotë se nuk janë rregulluar"
          >
            Të kontestuara
          </button>
          <button
            className={`btn btn-sm ${filters.hasPendingDuplicates ? 'btn-primary' : ''}`}
            onClick={() => patch({ hasPendingDuplicates: filters.hasPendingDuplicates ? undefined : true })}
          >
            Me dublikime
          </button>
          {activeFilterCount > 0 && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { setFilters({ page: 1, pageSize: 25, sort: 'newest' }); setSearchDraft(''); }}
            >
              Pastro
            </button>
          )}
        </div>

        <div className="row-wrap" style={{ gap: 6 }}>
          {STATUSES.map(status => {
            const active = filters.status?.includes(status);
            return (
              <button
                key={status}
                onClick={() => toggleStatus(status)}
                aria-pressed={active}
                className="chip"
                style={{
                  cursor: 'pointer',
                  background: active ? 'var(--brand-100)' : 'var(--surface-3)',
                  borderColor: active ? 'var(--brand-600)' : 'var(--border)',
                  color: active ? 'var(--brand-700)' : 'var(--ink-2)',
                }}
              >
                {STATUS_LABEL[status]}
              </button>
            );
          })}
          <span style={{ width: 12 }} />
          {categories?.map(category => {
            const active = filters.categoryCode?.includes(category.code);
            const current = filters.categoryCode ?? [];
            return (
              <button
                key={category.id}
                aria-pressed={active}
                className="chip"
                style={{
                  cursor: 'pointer',
                  background: active ? `color-mix(in srgb, ${category.colorHex} 14%, transparent)` : 'var(--surface-3)',
                  borderColor: active ? category.colorHex : 'var(--border)',
                  color: active ? 'var(--ink)' : 'var(--ink-2)',
                }}
                onClick={() => {
                  const next = active ? current.filter(c => c !== category.code) : [...current, category.code];
                  patch({ categoryCode: next.length ? next : undefined });
                }}
              >
                <span className="swatch" style={{ background: category.colorHex }} aria-hidden="true" />
                {category.nameSq}
              </button>
            );
          })}
        </div>
      </div>

      {showMap && items.length > 0 && (
        <div className="card" style={{ marginBottom: 16, overflow: 'hidden' }}>
          <ReportMap reports={items} height={340} onSelect={id => navigate(`/reports/${id}`)} />
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {isLoading ? <Spinner />
          : isError ? <ErrorState error={error} onRetry={() => refetch()} />
          : items.length === 0 ? (
            <EmptyState
              title="Asnjë raport nuk përputhet me filtrat"
              hint="Provoni të hiqni disa filtra ose zgjeroni intervalin e kërkimit."
              action={
                <button className="btn" onClick={() => { setFilters({ page: 1, pageSize: 25, sort: 'newest' }); setSearchDraft(''); }}>
                  Pastro filtrat
                </button>
              }
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 52 }}><span className="sr-only">Fotoja</span></th>
                    <th>Raporti</th>
                    <th style={{ width: 170 }}>Kategoria</th>
                    <th style={{ width: 130 }}>Statusi</th>
                    <th style={{ width: 120 }}>Prioriteti</th>
                    <th style={{ width: 150 }}>Siguria e AI</th>
                    <th style={{ width: 150 }}>Drejtoria</th>
                    <th style={{ width: 150 }}>Afati</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(report => (
                    <tr
                      key={report.id}
                      onClick={() => navigate(`/reports/${report.id}`)}
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') navigate(`/reports/${report.id}`); }}
                    >
                      <td>
                        {report.thumbnailUrl ? (
                          <img
                            src={mediaUrl(report.thumbnailUrl)}
                            alt=""
                            style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            aria-hidden="true"
                            style={{
                              width: 36, height: 36, borderRadius: 6,
                              background: 'var(--surface-3)', display: 'grid', placeItems: 'center',
                              color: 'var(--ink-3)', fontSize: 14,
                            }}
                          >
                            ▢
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8, marginBottom: 2 }}>
                          <span className="mono muted" style={{ fontSize: 11 }}>{report.publicRef}</span>
                          {report.confirmationCount > 1 && (
                            <span className="chip" style={{ padding: '1px 7px', fontSize: 10.5 }}>
                              {report.confirmationCount} konfirmime
                            </span>
                          )}
                          {report.pendingDuplicateCount > 0 && (
                            <span
                              className="chip"
                              style={{
                                padding: '1px 7px', fontSize: 10.5,
                                background: 'color-mix(in srgb, var(--warning) 14%, transparent)',
                                borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
                                color: 'var(--warning)',
                              }}
                            >
                              ⧉ {report.pendingDuplicateCount}
                            </span>
                          )}
                          {/* The reporter's verdict, in the queue rather than only in the case file:
                              a disputed closure that a clerk has to open a report to discover is a
                              disputed closure nobody sees. */}
                          {report.verificationOutcome && (
                            <span
                              className="chip"
                              style={{
                                padding: '1px 7px', fontSize: 10.5,
                                background: report.verificationOutcome === 'Confirmed'
                                  ? 'color-mix(in srgb, var(--success) 14%, transparent)'
                                  : 'color-mix(in srgb, var(--danger) 14%, transparent)',
                                borderColor: report.verificationOutcome === 'Confirmed'
                                  ? 'color-mix(in srgb, var(--success) 35%, transparent)'
                                  : 'color-mix(in srgb, var(--danger) 35%, transparent)',
                                color: report.verificationOutcome === 'Confirmed'
                                  ? 'var(--success)' : 'var(--danger)',
                              }}
                              title={report.verificationOutcome === 'Confirmed'
                                ? 'Raportuesi konfirmoi se problemi u rregullua'
                                : 'Raportuesi thotë se problemi vazhdon'}
                            >
                              {report.verificationOutcome === 'Confirmed'
                                ? '✓ verifikuar' : '⚠ kontestuar'}
                            </span>
                          )}
                        </div>
                        <div style={{ fontWeight: 570, maxWidth: 380 }} className="truncate">{report.title}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {report.addressText ?? '—'} · {formatRelative(report.createdAt)}
                        </div>
                      </td>
                      <td>
                        <CategoryChip category={report.category} />
                        {report.isCategoryOverridden && (
                          <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                            ✎ ndryshuar nga stafi
                          </div>
                        )}
                      </td>
                      <td><StatusBadge status={report.status} /></td>
                      <td><PriorityBadge priority={report.priority} /></td>
                      <td>
                        <ConfidenceMeter
                          confidence={report.aiConfidence}
                          source={report.classificationSource}
                          compact
                        />
                      </td>
                      <td className="dim" style={{ fontSize: 12.5 }}>{report.department?.shortName ?? '—'}</td>
                      <td><SlaBadge breached={report.isSlaBreached} dueAt={report.slaDueAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="row" style={{ marginTop: 14, justifyContent: 'center', gap: 12 }}>
          <button
            className="btn btn-sm"
            disabled={data.page <= 1}
            onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) - 1 }))}
          >
            ← E mëparshme
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            Faqja {data.page} nga {data.totalPages}
          </span>
          <button
            className="btn btn-sm"
            disabled={data.page >= data.totalPages}
            onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) + 1 }))}
          >
            Tjetra →
          </button>
        </div>
      )}
    </div>
  );
}
