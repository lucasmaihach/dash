'use client'

import { useState, type CSSProperties } from 'react'

export type WeeklyDailyPoint = {
  date: string
  amount_spent: number
  link_clicks: number
  impressions: number
  view_forms: number
  form_starts: number
  form_submits: number
  leads: number
}

type MetricFormat = 'money' | 'pct'

type MetricTotals = {
  cpc: number
  ctr: number
  cost_per_view_form: number
  cost_per_form_start: number
  cost_per_form_submit: number
  cpl: number
}

type MetricKey = keyof MetricTotals

const METRIC_DEFS: Array<{ key: MetricKey; label: string; format: MetricFormat }> = [
  { key: 'cpc', label: 'CPC (Custo por Clique)', format: 'money' },
  { key: 'ctr', label: 'CTR', format: 'pct' },
  { key: 'cost_per_view_form', label: 'Custo por Viu Forms', format: 'money' },
  { key: 'cost_per_form_start', label: 'Custo por Iniciou Forms', format: 'money' },
  { key: 'cost_per_form_submit', label: 'Custo por Enviou Forms', format: 'money' },
  { key: 'cpl', label: 'Custo por Reunião Agendada', format: 'money' },
]

type Props = {
  dailySeries: WeeklyDailyPoint[]
  minDate: string
  maxDate: string
  defaultPrevStart: string
  defaultPrevEnd: string
  defaultCurrentStart: string
  defaultCurrentEnd: string
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0
}

function computeTotals(points: WeeklyDailyPoint[]): MetricTotals {
  let amount_spent = 0
  let link_clicks = 0
  let impressions = 0
  let view_forms = 0
  let form_starts = 0
  let form_submits = 0
  let leads = 0
  for (const p of points) {
    amount_spent += p.amount_spent
    link_clicks += p.link_clicks
    impressions += p.impressions
    view_forms += p.view_forms
    form_starts += p.form_starts
    form_submits += p.form_submits
    leads += p.leads
  }
  return {
    cpc: safeDiv(amount_spent, link_clicks),
    ctr: safeDiv(link_clicks, impressions),
    cost_per_view_form: safeDiv(amount_spent, view_forms),
    cost_per_form_start: safeDiv(amount_spent, form_starts),
    cost_per_form_submit: safeDiv(amount_spent, form_submits),
    cpl: safeDiv(amount_spent, leads),
  }
}

function metricForPoint(p: WeeklyDailyPoint, key: MetricKey): number {
  return computeTotals([p])[key]
}

function fmt(value: number, format: MetricFormat): string {
  if (format === 'money') {
    return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function fmtCompact(value: number, format: MetricFormat): string {
  if (format === 'money') {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return `${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

function deltaPct(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? '+∞%' : '—'
  const d = ((current - prev) / prev) * 100
  const sign = d >= 0 ? '+' : ''
  return `${sign}${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function deltaColor(current: number, prev: number): string {
  if (prev === 0) return 'var(--text-muted)'
  const better = current < prev
  return better ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)'
}

function shortLabel(d: string): string {
  const parts = d.split('-')
  return `${parts[2]}/${parts[1]}`
}

function BarComparison({
  label,
  format,
  current,
  prev,
  prevLabel,
  currentLabel,
}: {
  label: string
  format: MetricFormat
  current: number
  prev: number
  prevLabel: string
  currentLabel: string
}) {
  const max = Math.max(current, prev, 0.0001)
  const prevPct = (prev / max) * 100
  const currentPct = (current / max) * 100
  const delta = deltaPct(current, prev)
  const color = deltaColor(current, prev)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span style={{ fontSize: 12, color, fontWeight: 600 }}>{delta}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{prevLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--bg-muted, rgba(255,255,255,0.08))', borderRadius: 4, height: 20 }}>
              <div style={{ width: `${prevPct}%`, height: '100%', background: 'var(--text-muted)', borderRadius: 4, opacity: 0.6 }} />
            </div>
            <span style={{ fontSize: 12, minWidth: 90, textAlign: 'right' }}>{fmt(prev, format)}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{currentLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--bg-muted, rgba(255,255,255,0.08))', borderRadius: 4, height: 20 }}>
              <div style={{ width: `${currentPct}%`, height: '100%', background: 'var(--accent, #6366f1)', borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 12, minWidth: 90, textAlign: 'right' }}>{fmt(current, format)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrendChartForMetric({
  label,
  format,
  metricKey,
  prevPoints,
  currPoints,
  prevLabel,
  currentLabel,
}: {
  label: string
  format: MetricFormat
  metricKey: MetricKey
  prevPoints: WeeklyDailyPoint[]
  currPoints: WeeklyDailyPoint[]
  prevLabel: string
  currentLabel: string
}) {
  const prevData = prevPoints.map((p) => ({ date: p.date, value: metricForPoint(p, metricKey) }))
  const currData = currPoints.map((p) => ({ date: p.date, value: metricForPoint(p, metricKey) }))
  const allPoints = [...prevData, ...currData]
  const values = allPoints.map((p) => p.value)
  const minVal = Math.min(...values, 0)
  const maxVal = Math.max(...values, 0.0001)
  const range = maxVal - minVal || 1

  const W = 360
  const H = 110
  const PAD_X = 6
  const PAD_TOP = 26
  const PAD_BOTTOM = 18
  const showLabels = allPoints.length > 0 && allPoints.length <= 16

  function toX(index: number, total: number) {
    if (total <= 1) return PAD_X
    return PAD_X + (index / (total - 1)) * (W - PAD_X * 2)
  }
  function toY(value: number) {
    return PAD_TOP + ((maxVal - value) / range) * (H - PAD_TOP - PAD_BOTTOM)
  }

  function makePath(points: Array<{ date: string; value: number }>) {
    if (points.length === 0) return ''
    return points
      .map((p, i) => {
        const x = toX(i, points.length)
        const y = toY(p.value)
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }

  const prevPath = makePath(prevData)
  const currPath = makePath(currData)

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 300, display: 'block' }}>
          {prevPath && (
            <path d={prevPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.7" />
          )}
          {currPath && <path d={currPath} fill="none" stroke="var(--accent, #6366f1)" strokeWidth="2" />}

          {prevData.map((p, i) => {
            const x = toX(i, prevData.length)
            const y = toY(p.value)
            return (
              <g key={`prev-${i}`}>
                <circle cx={x} cy={y} r="3" fill="var(--text-muted)" opacity="0.8" />
                <title>{`${p.date}: ${fmt(p.value, format)}`}</title>
                {showLabels && (
                  <text x={x} y={y - 7} textAnchor="middle" fontSize="7.5" fill="var(--text-muted)">
                    {fmtCompact(p.value, format)}
                  </text>
                )}
              </g>
            )
          })}
          {currData.map((p, i) => {
            const x = toX(i, currData.length)
            const y = toY(p.value)
            return (
              <g key={`curr-${i}`}>
                <circle cx={x} cy={y} r="3" fill="var(--accent, #6366f1)" />
                <title>{`${p.date}: ${fmt(p.value, format)}`}</title>
                {showLabels && (
                  <text x={x} y={y - 7} textAnchor="middle" fontSize="7.5" fill="var(--accent, #6366f1)" fontWeight="600">
                    {fmtCompact(p.value, format)}
                  </text>
                )}
              </g>
            )
          })}

          {prevData.map((p, i) => (
            <text key={`lblp-${i}`} x={toX(i, prevData.length)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
              {shortLabel(p.date)}
            </text>
          ))}
          {currData.map((p, i) => (
            <text key={`lblc-${i}`} x={toX(i, currData.length)} y={H - 4} textAnchor="middle" fontSize="8" fill="var(--text-muted)">
              {shortLabel(p.date)}
            </text>
          ))}
        </svg>
      </div>
      {!showLabels && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          Passe o mouse sobre os pontos para ver os valores (período com muitos dias).
        </p>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
          {prevLabel}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="20" height="4"><line x1="0" y1="2" x2="20" y2="2" stroke="var(--accent,#6366f1)" strokeWidth="2" /></svg>
          {currentLabel}
        </span>
      </div>
    </div>
  )
}

function fmtRangeLabel(start: string, end: string): string {
  const fa = start.split('-').reverse().slice(0, 2).join('/')
  const fb = end.split('-').reverse().slice(0, 2).join('/')
  return start === end ? fa : `${fa} – ${fb}`
}

export function WeeklyComparisonSection({
  dailySeries,
  minDate,
  maxDate,
  defaultPrevStart,
  defaultPrevEnd,
  defaultCurrentStart,
  defaultCurrentEnd,
}: Props) {
  const [prevStart, setPrevStart] = useState(defaultPrevStart)
  const [prevEnd, setPrevEnd] = useState(defaultPrevEnd)
  const [currentStart, setCurrentStart] = useState(defaultCurrentStart)
  const [currentEnd, setCurrentEnd] = useState(defaultCurrentEnd)

  const prevPoints = dailySeries.filter((p) => p.date >= prevStart && p.date <= prevEnd)
  const currPoints = dailySeries.filter((p) => p.date >= currentStart && p.date <= currentEnd)
  const prevTotals = computeTotals(prevPoints)
  const currTotals = computeTotals(currPoints)

  const prevLabel = fmtRangeLabel(prevStart, prevEnd)
  const currentLabel = fmtRangeLabel(currentStart, currentEnd)

  function resetDefaults() {
    setPrevStart(defaultPrevStart)
    setPrevEnd(defaultPrevEnd)
    setCurrentStart(defaultCurrentStart)
    setCurrentEnd(defaultCurrentEnd)
  }

  const inputStyle = {
    background: 'var(--bg-muted, rgba(255,255,255,0.06))',
    border: '1px solid var(--border, rgba(255,255,255,0.15))',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 12,
    color: 'inherit',
    colorScheme: 'dark',
  } satisfies CSSProperties

  return (
    <>
      <section className="panel reveal d5b">
        <h2>B) Comparação Semanal</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Período anterior</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={prevStart} min={minDate} max={maxDate} onChange={(e) => setPrevStart(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>até</span>
              <input type="date" value={prevEnd} min={minDate} max={maxDate} onChange={(e) => setPrevEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Período atual</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" value={currentStart} min={minDate} max={maxDate} onChange={(e) => setCurrentStart(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>até</span>
              <input type="date" value={currentEnd} min={minDate} max={maxDate} onChange={(e) => setCurrentEnd(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <button
            type="button"
            onClick={resetDefaults}
            className="button-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
          >
            Restaurar semana atual/anterior
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0 32px' }}>
          {METRIC_DEFS.map((m) => (
            <BarComparison
              key={m.key}
              label={m.label}
              format={m.format}
              current={currTotals[m.key]}
              prev={prevTotals[m.key]}
              prevLabel={prevLabel}
              currentLabel={currentLabel}
            />
          ))}
        </div>
      </section>

      <section className="panel reveal d5c">
        <h2>C) Tendência Semanal</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          Evolução diária — {prevLabel} (tracejado) vs {currentLabel} (sólido)
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '0 32px' }}>
          {METRIC_DEFS.map((m) => (
            <TrendChartForMetric
              key={m.key}
              label={m.label}
              format={m.format}
              metricKey={m.key}
              prevPoints={prevPoints}
              currPoints={currPoints}
              prevLabel={prevLabel}
              currentLabel={currentLabel}
            />
          ))}
        </div>
      </section>
    </>
  )
}
