'use client'

export type WeeklyMetric = {
  label: string
  current: number
  prev: number
  format: 'money' | 'pct'
}

export type WeeklyDayPoint = {
  date: string
  value: number
}

export type WeeklyTrendSeries = {
  label: string
  format: 'money' | 'pct'
  prevWeek: WeeklyDayPoint[]
  currentWeek: WeeklyDayPoint[]
}

type Props = {
  currentWeekLabel: string
  prevWeekLabel: string
  comparison: WeeklyMetric[]
  trends: WeeklyTrendSeries[]
}

function fmt(value: number, format: 'money' | 'pct'): string {
  if (format === 'money') {
    return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  return `${(value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

function deltaPct(current: number, prev: number): string {
  if (prev === 0) return current > 0 ? '+∞%' : '—'
  const d = ((current - prev) / prev) * 100
  const sign = d >= 0 ? '+' : ''
  return `${sign}${d.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function deltaColor(current: number, prev: number, lowerIsBetter: boolean): string {
  if (prev === 0) return 'var(--text-muted)'
  const better = lowerIsBetter ? current < prev : current > prev
  return better ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)'
}

function BarComparison({ metric, prevLabel, currentLabel }: { metric: WeeklyMetric; prevLabel: string; currentLabel: string }) {
  const max = Math.max(metric.current, metric.prev, 0.0001)
  const prevPct = (metric.prev / max) * 100
  const currentPct = (metric.current / max) * 100
  const delta = deltaPct(metric.current, metric.prev)
  const color = deltaColor(metric.current, metric.prev, true)

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{metric.label}</span>
        <span style={{ fontSize: 12, color, fontWeight: 600 }}>{delta}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{prevLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--bg-muted, rgba(255,255,255,0.08))', borderRadius: 4, height: 20 }}>
              <div style={{ width: `${prevPct}%`, height: '100%', background: 'var(--text-muted)', borderRadius: 4, opacity: 0.6 }} />
            </div>
            <span style={{ fontSize: 12, minWidth: 90, textAlign: 'right' }}>{fmt(metric.prev, metric.format)}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{currentLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--bg-muted, rgba(255,255,255,0.08))', borderRadius: 4, height: 20 }}>
              <div style={{ width: `${currentPct}%`, height: '100%', background: 'var(--accent, #6366f1)', borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 12, minWidth: 90, textAlign: 'right' }}>{fmt(metric.current, metric.format)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrendChart({ series, prevLabel, currentLabel }: { series: WeeklyTrendSeries; prevLabel: string; currentLabel: string }) {
  const allPoints = [...series.prevWeek, ...series.currentWeek]
  const values = allPoints.map((p) => p.value)
  const minVal = Math.min(...values, 0)
  const maxVal = Math.max(...values, 0.0001)
  const range = maxVal - minVal || 1

  const W = 340
  const H = 80
  const PAD_X = 4
  const PAD_Y = 8

  function toX(index: number, total: number) {
    if (total <= 1) return PAD_X
    return PAD_X + (index / (total - 1)) * (W - PAD_X * 2)
  }
  function toY(value: number) {
    return PAD_Y + ((maxVal - value) / range) * (H - PAD_Y * 2)
  }

  function makePath(points: WeeklyDayPoint[]) {
    if (points.length === 0) return ''
    return points
      .map((p, i) => {
        const x = toX(i, points.length)
        const y = toY(p.value)
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }

  const prevPath = makePath(series.prevWeek)
  const currPath = makePath(series.currentWeek)

  const shortLabel = (d: string) => {
    const parts = d.split('-')
    return `${parts[2]}/${parts[1]}`
  }

  const allDays = [...series.prevWeek, ...series.currentWeek]

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{series.label}</div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H + 20}`} style={{ width: '100%', minWidth: 280, display: 'block' }}>
          {prevPath && (
            <path d={prevPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 2" opacity="0.7" />
          )}
          {currPath && (
            <path d={currPath} fill="none" stroke="var(--accent, #6366f1)" strokeWidth="2" />
          )}
          {series.prevWeek.map((p, i) => (
            <circle
              key={`prev-${i}`}
              cx={toX(i, series.prevWeek.length)}
              cy={toY(p.value)}
              r="3"
              fill="var(--text-muted)"
              opacity="0.7"
            />
          ))}
          {series.currentWeek.map((p, i) => (
            <circle
              key={`curr-${i}`}
              cx={toX(i, series.currentWeek.length)}
              cy={toY(p.value)}
              r="3"
              fill="var(--accent, #6366f1)"
            />
          ))}
          {allDays.length > 0 && allDays.length <= 14 && allDays.map((p, i) => {
            const isPrev = i < series.prevWeek.length
            const localIdx = isPrev ? i : i - series.prevWeek.length
            const total = isPrev ? series.prevWeek.length : series.currentWeek.length
            const x = toX(localIdx, total)
            return (
              <text
                key={`lbl-${i}`}
                x={x}
                y={H + 14}
                textAnchor="middle"
                fontSize="8"
                fill="var(--text-muted)"
              >
                {shortLabel(p.date)}
              </text>
            )
          })}
        </svg>
      </div>
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

export function WeeklyComparisonSection({ currentWeekLabel, prevWeekLabel, comparison, trends }: Props) {
  return (
    <>
      <section className="panel reveal d5b">
        <h2>B) Comparação Semanal</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          {prevWeekLabel} vs {currentWeekLabel}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0 32px' }}>
          {comparison.map((metric) => (
            <BarComparison
              key={metric.label}
              metric={metric}
              prevLabel={prevWeekLabel}
              currentLabel={currentWeekLabel}
            />
          ))}
        </div>
      </section>

      <section className="panel reveal d5c">
        <h2>C) Tendência Semanal</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          Evolução diária — {prevWeekLabel} (tracejado) vs {currentWeekLabel} (sólido)
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0 32px' }}>
          {trends.map((series) => (
            <TrendChart
              key={series.label}
              series={series}
              prevLabel={prevWeekLabel}
              currentLabel={currentWeekLabel}
            />
          ))}
        </div>
      </section>
    </>
  )
}
