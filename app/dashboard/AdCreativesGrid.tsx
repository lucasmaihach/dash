'use client'

import { useState } from 'react'

export type CreativeCard = {
  ad_id: string
  ad_name: string | null
  creative_type: 'image' | 'video' | 'unknown'
  thumbnail_url: string | null
  video_id: string | null
  link_url: string | null
  ad_snapshot_url: string | null
  call_to_action_type: string | null
  // métricas
  amount_spent: string
  leads: string
  cpl: string
  impressions: string
  ctr: string
  cpc: string
}

type Props = {
  cards: CreativeCard[]
}

const TYPE_LABEL: Record<string, string> = {
  video: '🎬 Vídeo',
  image: '🖼 Imagem',
  unknown: '📄 Criativo',
}

export function AdCreativesGrid({ cards }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (cards.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
        Nenhum criativo encontrado. Execute{' '}
        <code style={{ fontSize: 12 }}>node scripts/ingest_meta_ad_creatives.mjs</code>{' '}
        para importar os criativos.
      </p>
    )
  }

  return (
    <div className="creatives-grid">
      {cards.map((card) => {
        const isExpanded = expanded === card.ad_id
        const label = TYPE_LABEL[card.creative_type] ?? TYPE_LABEL.unknown

        return (
          <div
            key={card.ad_id}
            className={`creative-card ${isExpanded ? 'expanded' : ''}`}
            onClick={() => setExpanded(isExpanded ? null : card.ad_id)}
          >
            {/* Thumbnail */}
            <div className="creative-thumb">
              {card.thumbnail_url ? (
                <img
                  src={card.thumbnail_url}
                  alt={card.ad_name ?? 'Criativo'}
                  className="creative-thumb-img"
                  loading="lazy"
                />
              ) : (
                <div className="creative-thumb-placeholder">
                  <span>{card.creative_type === 'video' ? '🎬' : '🖼'}</span>
                </div>
              )}

              {/* Badge de tipo */}
              <span className="creative-type-badge">{label}</span>

              {/* Ícone de vídeo play */}
              {card.creative_type === 'video' && (
                <div className="creative-play-icon">▶</div>
              )}
            </div>

            {/* Nome */}
            <div className="creative-name">
              {card.ad_name || '(sem nome)'}
            </div>

            {/* Métricas principais sempre visíveis */}
            <div className="creative-metrics-row">
              <div className="creative-metric">
                <span className="creative-metric-label">Leads</span>
                <span className="creative-metric-value">{card.leads}</span>
              </div>
              <div className="creative-metric">
                <span className="creative-metric-label">CPL</span>
                <span className="creative-metric-value">{card.cpl}</span>
              </div>
              <div className="creative-metric">
                <span className="creative-metric-label">Invest.</span>
                <span className="creative-metric-value">{card.amount_spent}</span>
              </div>
            </div>

            {/* Métricas expandidas */}
            {isExpanded && (
              <div className="creative-metrics-expanded">
                <div className="creative-metric">
                  <span className="creative-metric-label">Impressões</span>
                  <span className="creative-metric-value">{card.impressions}</span>
                </div>
                <div className="creative-metric">
                  <span className="creative-metric-label">CTR</span>
                  <span className="creative-metric-value">{card.ctr}</span>
                </div>
                <div className="creative-metric">
                  <span className="creative-metric-label">CPC</span>
                  <span className="creative-metric-value">{card.cpc}</span>
                </div>

                {(card.ad_snapshot_url || card.link_url) && (
                  <a
                    href={card.ad_snapshot_url || card.link_url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="creative-link-btn"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Ver anúncio ↗
                  </a>
                )}
              </div>
            )}

            <div className="creative-expand-hint">
              {isExpanded ? '▲ menos' : '▼ mais'}
            </div>
          </div>
        )
      })}
    </div>
  )
}
