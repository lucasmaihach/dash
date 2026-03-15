'use client'

import { createPortal } from 'react-dom'
import { SortableTable } from './SortableTable'

export type CampaignRow = {
  name: string
  amount_spent: string
  leads: string
  cpl: string
  impressions: string
  reach: string
  link_clicks: string
  cpc: string
  ctr: string
  landing_page_views: string
  connect_rate: string
}

export type DayTotals = {
  amount_spent: string
  leads: string
  cpl: string
  impressions: string
  reach: string
  link_clicks: string
  cpc: string
  ctr: string
}

type Props = {
  selectedDay: string
  totals: DayTotals
  campaigns: CampaignRow[]
  loading?: boolean
  error?: string | null
  onClose: () => void
}

const CAMPAIGN_COLUMNS = [
  { key: 'name', label: 'Campanha' },
  { key: 'amount_spent', label: 'Investimento' },
  { key: 'leads', label: 'Leads' },
  { key: 'cpl', label: 'CPL' },
  { key: 'impressions', label: 'Impressões' },
  { key: 'reach', label: 'Alcance' },
  { key: 'link_clicks', label: 'Cliques' },
  { key: 'cpc', label: 'CPC' },
  { key: 'ctr', label: 'CTR' },
  { key: 'landing_page_views', label: 'LP Views' },
  { key: 'connect_rate', label: 'Connect Rate' },
]

export function DayDetailModal({ selectedDay, totals, campaigns, loading, error, onClose }: Props) {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        className="modal-card"
        style={{
          background: 'rgba(5, 5, 5, 0.82)',
          backdropFilter: 'blur(20px)',
          borderRadius: 16,
          padding: '28px 32px',
          width: '92vw',
          maxWidth: 980,
          maxHeight: '88vh',
          overflowY: 'auto',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botão fechar — canto superior direito */}
        <button
          onClick={onClose}
          aria-label="Fechar"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            minHeight: 28,
            height: 28,
            padding: 0,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '50%',
            color: 'rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: 11,
            lineHeight: 1,
            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(239,68,68,0.2)'
            e.currentTarget.style.borderColor = 'rgba(252,165,165,0.3)'
            e.currentTarget.style.color = '#fca5a5'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
            e.currentTarget.style.color = 'rgba(255,255,255,0.5)'
          }}
        >
          ✕
        </button>

        {/* Header */}
        <div style={{ marginBottom: 22, paddingRight: 32 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Campanhas do Dia</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3, display: 'block' }}>
            {selectedDay}
          </span>
        </div>

        {/* Totals do dia */}
        <div className="metrics-grid" style={{ marginBottom: 22 }}>
          <div className="metric">
            <div className="label">Investimento</div>
            <div className="value">{totals.amount_spent}</div>
          </div>
          <div className="metric">
            <div className="label">Leads</div>
            <div className="value">{totals.leads}</div>
          </div>
          <div className="metric">
            <div className="label">CPL</div>
            <div className="value">{totals.cpl}</div>
          </div>
          <div className="metric">
            <div className="label">Impressões</div>
            <div className="value">{totals.impressions}</div>
          </div>
          <div className="metric">
            <div className="label">Alcance</div>
            <div className="value">{totals.reach}</div>
          </div>
          <div className="metric">
            <div className="label">Cliques</div>
            <div className="value">{totals.link_clicks}</div>
          </div>
          <div className="metric">
            <div className="label">CPC</div>
            <div className="value">{totals.cpc}</div>
          </div>
          <div className="metric">
            <div className="label">CTR</div>
            <div className="value">{totals.ctr}</div>
          </div>
        </div>

        {/* Tabela de campanhas */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Carregando campanhas...</p>
            <div className="day-detail-skeleton">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-row" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="day-detail-error">
            <span className="day-detail-error-icon">&#9888;</span>
            <p>{error}</p>
            <button
              onClick={onClose}
              style={{
                marginTop: 12,
                width: 'auto',
                minHeight: 32,
                padding: '0 16px',
                fontSize: 12,
                borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              Fechar
            </button>
          </div>
        ) : campaigns.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            Nenhuma campanha encontrada para este dia com os filtros atuais.
          </p>
        ) : (
          <div className="table-wrap">
            <SortableTable
              columns={CAMPAIGN_COLUMNS}
              rows={campaigns as unknown as Record<string, string>[]}
              firstColStyle={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
