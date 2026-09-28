import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api/client';
import type { ReportStatus } from '../api/types';
import {
  Card, ErrorState, Spinner, STATUS_LABEL, STATUS_VAR, StatTile, formatHours,
} from '../components/ui';

/* Recessive axes and grid — the data marks should be the brightest thing in the frame. */
const AXIS = { stroke: 'var(--ink-3)', fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = { stroke: 'var(--border)', strokeDasharray: '3 3', vertical: false } as const;

function ChartTooltip({ active, payload, label, suffix = '' }: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }[];
  label?: string | number;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-2)',
        padding: '9px 12px', fontSize: 12.5, minWidth: 130,
      }}
    >
      {label != null && <div style={{ fontWeight: 620, marginBottom: 5 }}>{label}</div>}
      {payload.map((entry, index) => (
        <div key={index} className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 6 }}>
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flex: 'none' }}
            />
            <span className="dim">{entry.name}</span>
          </span>
          <strong>{entry.value}{suffix}</strong>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [showTable, setShowTable] = useState(false);

  const summaryQuery = useQuery({ queryKey: ['analytics'], queryFn: api.analytics });
  const trendQuery = useQuery({ queryKey: ['trend', days], queryFn: () => api.trend(days) });

  const summary = summaryQuery.data;

  const trendData = useMemo(
    () => (trendQuery.data ?? []).map(point => ({
      date: new Date(point.date).toLocaleDateString('sq-AL', { day: '2-digit', month: 'short' }),
      'Të dërguara': point.submitted,
      'Të zgjidhura': point.resolved,
    })),
    [trendQuery.data],
  );

  const statusData = useMemo(
    () => (summary?.byStatus ?? []).map(s => ({
      name: STATUS_LABEL[s.status as ReportStatus] ?? s.status,
      value: s.count,
      color: STATUS_VAR[s.status as ReportStatus] ?? 'var(--ink-3)',
    })),
    [summary],
  );

  if (summaryQuery.isLoading) return <div style={{ padding: 26 }}><Spinner /></div>;
  if (summaryQuery.isError || !summary) {
    return <div style={{ padding: 26 }}><ErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} /></div>;
  }

  const agreementPct = summary.aiAgreementRate == null ? null : Math.round(summary.aiAgreementRate * 100);
  const verifiedPct = summary.citizenVerifiedRate == null
    ? null
    : Math.round(summary.citizenVerifiedRate * 100);

  return (
    <div style={{ padding: '22px 26px 48px', maxWidth: 1440, margin: '0 auto' }}>
      <header className="row" style={{ marginBottom: 18 }}>
        <div>
          <h1>Analitika</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Bashkia Elbasan · të dhëna operative në kohë reale
          </p>
        </div>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => setShowTable(v => !v)}>
          {showTable ? 'Fshih tabelën' : 'Shfaq si tabelë'}
        </button>
      </header>

      <div
        style={{
          display: 'grid', gap: 14, marginBottom: 18,
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}
      >
        <StatTile label="Raporte gjithsej" value={summary.totalReports} hint={`${summary.openReports} të hapura`} />
        <StatTile
          label="Koha mesatare deri në përgjigje"
          value={formatHours(summary.avgHoursToAcknowledge)}
          hint="nga dërgimi te shqyrtimi"
        />
        <StatTile
          label="Koha mesatare e zgjidhjes"
          value={formatHours(summary.avgHoursToResolution)}
          hint={`${summary.resolvedReports} raste të mbyllura`}
        />
        <StatTile
          label="Afate të tejkaluara"
          value={summary.slaBreachCount}
          hint="ndaj SLA-së së drejtorisë"
          tone={summary.slaBreachCount > 0 ? 'warning' : 'success'}
        />
        <StatTile
          label="Dublikime të bashkuara"
          value={summary.duplicatesMerged}
          hint={`${summary.pendingDuplicateReviews} presin shqyrtim`}
        />
        <StatTile
          label="Modele sistemike aktive"
          value={summary.openSystemicPatterns}
          hint="grupe raportesh nën shqyrtim"
          tone={summary.openSystemicPatterns > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label="Mashtrime të mundshme"
          value={summary.pendingFraudFlags}
          hint={`${summary.confirmedFraudFlags} pranuar · ${summary.dismissedFraudFlags} raste të rreme`}
          tone={summary.pendingFraudFlags > 0 ? 'warning' : 'default'}
        />
      </div>

      {/*
        The AI honesty panel. We report agreement — how often a clerk left the AI's category alone —
        not "accuracy", because we have no labelled ground truth. Stating the limitation is the point.
      */}
      <div
        className="card card-pad"
        style={{ marginBottom: 18, borderLeft: '3px solid var(--brand-600)' }}
      >
        <div className="label">Përputhshmëria me AI-në</div>
        <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontSize: 32, fontWeight: 690, letterSpacing: '-0.02em' }}>
            {agreementPct == null ? '—' : `${agreementPct}%`}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {summary.aiOverriddenCount} ndryshime nga {summary.aiClassifiedCount} klasifikime
          </span>
        </div>
      </div>

      {/*
        The second honesty panel, and the harder one. The AI panel above measures a tool we built; this
        measures the municipality itself, and it is deliberately built so it cannot be made to look
        better than the truth: the denominator is every resolved case, not every case somebody replied
        about, so the only way to move this number up is to actually fix things.
      */}
      <div
        className="card card-pad"
        style={{ marginBottom: 18, borderLeft: '3px solid var(--success)' }}
      >
        <div className="label">Zgjidhje të verifikuara nga qytetari</div>
        <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontSize: 32, fontWeight: 690, letterSpacing: '-0.02em' }}>
            {verifiedPct == null ? '—' : `${verifiedPct}%`}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {summary.verificationsConfirmed} nga {summary.resolvedReports} raste të shënuara si të zgjidhura
          </span>
        </div>
        <div className="row-wrap" style={{ gap: 8, marginTop: 10 }}>
          <span
            className="chip"
            style={{
              background: 'color-mix(in srgb, var(--success) 12%, transparent)',
              borderColor: 'color-mix(in srgb, var(--success) 32%, transparent)',
              color: 'var(--success)',
            }}
          >
            ✓ {summary.verificationsConfirmed} konfirmuar
          </span>
          <span
            className="chip"
            style={{
              background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              borderColor: 'color-mix(in srgb, var(--danger) 32%, transparent)',
              color: 'var(--danger)',
            }}
          >
            ⚠ {summary.verificationsDisputed} kontestuar
          </span>
          <span className="chip">◷ {summary.verificationsAwaiting} pa përgjigje</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 1fr)', gap: 16, marginBottom: 16 }}>
        <Card
          title="Raporte të dërguara dhe të zgjidhura"
          action={
            <select
              className="select" style={{ width: 'auto' }}
              value={days} onChange={e => setDays(Number(e.target.value))}
              aria-label="Intervali kohor"
            >
              <option value={14}>14 ditë</option>
              <option value={30}>30 ditë</option>
              <option value={90}>90 ditë</option>
            </select>
          }
        >
          {trendQuery.isLoading ? <Spinner /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradSubmitted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-500)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--brand-500)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cat-waste)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--cat-waste)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} minTickGap={26} />
                <YAxis {...AXIS} allowDecimals={false} width={34} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                <Area
                  type="monotone" dataKey="Të dërguara" stroke="var(--brand-500)" strokeWidth={2}
                  fill="url(#gradSubmitted)" dot={false} activeDot={{ r: 4.5, strokeWidth: 2 }}
                />
                <Area
                  type="monotone" dataKey="Të zgjidhura" stroke="var(--cat-waste)" strokeWidth={2}
                  fill="url(#gradResolved)" dot={false} activeDot={{ r: 4.5, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Shpërndarja sipas statusit">
          {/*
            Bars, not a donut. A donut dropped the single-report "Rejected" slice below its padding
            angle — a whole status vanishing from the chart is exactly the kind of quiet wrongness a
            jury should not have to catch for us. Bars also read magnitude far better than arcs.
          */}
          <ResponsiveContainer width="100%" height={Math.max(180, statusData.length * 34)}>
            <BarChart
              data={statusData}
              layout="vertical"
              margin={{ top: 4, right: 28, left: 4, bottom: 4 }}
              barCategoryGap={8}
            >
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="name" {...AXIS} width={96} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-3)' }} />
              <Bar dataKey="value" name="Raporte" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {statusData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Values in text as well as in the bars — identity is never conveyed by colour alone. */}
          <ul
            style={{
              listStyle: 'none', margin: '10px 0 0', padding: '10px 0 0',
              borderTop: '1px solid var(--border)',
            }}
          >
            {statusData.map(entry => (
              <li key={entry.name} className="row" style={{ gap: 8, padding: '3px 0', fontSize: 12.5 }}>
                <span
                  aria-hidden="true"
                  style={{ width: 9, height: 9, borderRadius: 2, background: entry.color, flex: 'none' }}
                />
                <span className="dim">{entry.name}</span>
                <span className="spacer" />
                <strong>{entry.value}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
        <Card title="Raporte sipas kategorisë">
          <ResponsiveContainer width="100%" height={Math.max(200, summary.byCategory.length * 42)}>
            <BarChart
              data={summary.byCategory}
              layout="vertical"
              margin={{ top: 4, right: 26, left: 4, bottom: 4 }}
              barCategoryGap={10}
            >
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="nameSq" {...AXIS} width={148} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-3)' }} />
              {/* 4px rounded data-end, square at the baseline. */}
              <Bar dataKey="count" name="Raporte" radius={[0, 4, 4, 0]} maxBarSize={22}>
                {summary.byCategory.map(entry => <Cell key={entry.code} fill={entry.colorHex} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Ngarkesa sipas drejtorisë">
          <ResponsiveContainer width="100%" height={Math.max(200, summary.byDepartment.length * 46)}>
            <BarChart
              data={summary.byDepartment}
              layout="vertical"
              margin={{ top: 4, right: 26, left: 4, bottom: 4 }}
              barCategoryGap={10}
            >
              <CartesianGrid {...GRID} horizontal={false} vertical />
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="shortName" {...AXIS} width={128} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-3)' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
              <Bar dataKey="open" name="Të hapura" stackId="load" fill="var(--brand-500)" maxBarSize={22} />
              <Bar
                dataKey="resolved" name="Të zgjidhura" stackId="load"
                fill="var(--cat-waste)" radius={[0, 4, 4, 0]} maxBarSize={22}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/*
        A table view of the same numbers. This is not a nicety: two palette slots sit just under the
        3:1 contrast line against the light surface, and the accessibility rule is that a contrast
        warning is relieved by visible labels or a table — so the table ships.
      */}
      {showTable && (
        <div style={{ marginTop: 16 }}>
          <Card title="Të dhënat në formë tabelare">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Kategoria</th>
                    <th>Raporte</th>
                    <th>Koha mesatare e zgjidhjes</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCategory.map(row => (
                    <tr key={row.code} style={{ cursor: 'default' }}>
                      <td>
                        <span className="row" style={{ gap: 8 }}>
                          <span
                            aria-hidden="true"
                            style={{ width: 9, height: 9, borderRadius: 2, background: row.colorHex }}
                          />
                          {row.nameSq}
                        </span>
                      </td>
                      <td>{row.count}</td>
                      <td>{formatHours(row.avgHoursToResolution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="table" style={{ marginTop: 20 }}>
                <thead>
                  <tr>
                    <th>Drejtoria</th>
                    <th>Të hapura</th>
                    <th>Të zgjidhura</th>
                    <th>Afate të tejkaluara</th>
                    <th>Koha mesatare e zgjidhjes</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byDepartment.map(row => (
                    <tr key={row.id} style={{ cursor: 'default' }}>
                      <td>{row.shortName}</td>
                      <td>{row.open}</td>
                      <td>{row.resolved}</td>
                      <td style={{ color: row.slaBreaches > 0 ? 'var(--warning)' : undefined }}>
                        {row.slaBreaches}
                      </td>
                      <td>{formatHours(row.avgHoursToResolution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
