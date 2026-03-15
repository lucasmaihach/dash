export default function DashboardLoading() {
  return (
    <main className="app-shell">
      {/* Nav */}
      <div className="ds-nav reveal d1">
        <div className="ds-nav-logo">
          <span className="ds-nav-logo-dot" />
          <span>Dashboard de Anúncios</span>
        </div>
        <span className="ds-pill">Dashboard</span>
      </div>

      <div className="page-wrap">
        {/* Hero skeleton */}
        <section className="hero reveal d2">
          <div style={{ width: 180, height: 36, borderRadius: 8, background: 'var(--skeleton)' }} />
          <div style={{ width: 240, height: 16, borderRadius: 6, background: 'var(--skeleton)', marginTop: 10 }} />
        </section>

        {/* Panel skeleton */}
        <section className="panel reveal d3" style={{ gap: 12 }}>
          <div style={{ width: 140, height: 18, borderRadius: 6, background: 'var(--skeleton)' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ width: 100, height: 32, borderRadius: 8, background: 'var(--skeleton)' }} />
            ))}
          </div>
        </section>

        {/* Metrics skeleton */}
        <section className="panel reveal d4">
          <div style={{ width: 160, height: 18, borderRadius: 6, background: 'var(--skeleton)', marginBottom: 20 }} />
          <div className="metrics-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="metric" style={{ opacity: 0.5 }}>
                <div style={{ width: '60%', height: 12, borderRadius: 4, background: 'var(--skeleton)' }} />
                <div style={{ width: '80%', height: 22, borderRadius: 6, background: 'var(--skeleton)', marginTop: 8 }} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
