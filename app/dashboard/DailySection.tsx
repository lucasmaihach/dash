'use client'

import { useState, useRef } from 'react'
import { DayDetailModal, type CampaignRow, type DayTotals } from './DayDetailModal'

export type DayRow = {
  date: string
  totals: DayTotals
  amount_spent: string
  reach: string
  impressions: string
  link_clicks: string
  landing_page_views: string
  leads: string
  cpc: string
  cpl: string
  ctr: string
  cpm: string
  connect_rate: string
}

type SortKey = keyof Omit<DayRow, 'totals'>
type SortDir = 'desc' | 'asc'

function toNum(v: string): number {
  const n = parseFloat(
    v.replace(/R\$\s*/g, '').replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim()
  )
  return isNaN(n) ? -Infinity : n
}

type Props = {
  days: DayRow[]
  clientId: string
  tag: string
  campaignFilter: string
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'date', label: 'Data' },
  { key: 'amount_spent', label: 'Investimento' },
  { key: 'reach', label: 'Alcance' },
  { key: 'impressions', label: 'Impressões' },
  { key: 'link_clicks', label: 'Cliques' },
  { key: 'landing_page_views', label: 'LP Views' },
  { key: 'leads', label: 'Leads' },
  { key: 'cpc', label: 'CPC' },
  { key: 'cpl', label: 'CPL' },
  { key: 'ctr', label: 'CTR' },
  { key: 'cpm', label: 'CPM' },
  { key: 'connect_rate', label: 'Connect Rate' },
]

export function DailySection({ days, clientId, tag, campaignFilter }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const cache = useRef<Map<string, CampaignRow[]>>(new Map())

  const selectedDayTotals = selectedDay
    ? (days.find((d) => d.date === selectedDay)?.totals ?? null)
    : null

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...days].sort((a, b) => {
    const av = toNum(a[sortKey] ?? '')
    const bv = toNum(b[sortKey] ?? '')
    if (av === -Infinity && bv === -Infinity) {
      return sortDir === 'desc'
        ? (b[sortKey] ?? '').localeCompare(a[sortKey] ?? '')
        : (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '')
    }
    return sortDir === 'desc' ? bv - av : av - bv
  })

  async function handleDayClick(date: string) {
    if (selectedDay === date) {
      setSelectedDay(null)
      return
    }

    setSelectedDay(date)
    setFetchError(null)

    // Cache local: não rebusca se já carregou
    if (cache.current.has(date)) {
      setCampaigns(cache.current.get(date)!)
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams({ clientId, date, tag, campaign: campaignFilter })
      const res = await fetch(`/api/day-detail?${params}`)
      const json = await res.json()

      if (!res.ok) {
        const msg =
          res.status === 401 ? 'Sessão expirada. Recarregue a página.' :
          res.status === 403 ? 'Acesso negado a este cliente.' :
          res.status === 500 ? 'Erro interno ao buscar campanhas. Tente novamente.' :
          `Erro inesperado (${res.status}).`
        setFetchError(msg)
        setCampaigns([])
        return
      }

      cache.current.set(date, json.campaigns ?? [])
      setCampaigns(json.campaigns ?? [])
    } catch {
      setFetchError('Falha de conexão. Verifique sua internet e tente novamente.')
      setCampaigns([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = sortKey === col.key
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    {col.label}
                    <span style={{ marginLeft: 5, fontSize: 10, opacity: active ? 0.9 : 0.28 }}>
                      {active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((day) => {
              const isSelected = selectedDay === day.date
              return (
                <tr
                  key={day.date}
                  onClick={() => handleDayClick(day.date)}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(249,115,22,0.12)' : undefined,
                    borderLeft: isSelected
                      ? '3px solid rgba(249,115,22,0.8)'
                      : '3px solid transparent',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <td style={{ fontWeight: isSelected ? 600 : undefined }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, opacity: 0.6 }}>
                        {isSelected ? '▼' : '▶'}
                      </span>
                      {day.date}
                    </span>
                  </td>
                  <td>{day.amount_spent}</td>
                  <td>{day.reach}</td>
                  <td>{day.impressions}</td>
                  <td>{day.link_clicks}</td>
                  <td>{day.landing_page_views}</td>
                  <td>{day.leads}</td>
                  <td>{day.cpc}</td>
                  <td>{day.cpl}</td>
                  <td>{day.ctr}</td>
                  <td>{day.cpm}</td>
                  <td>{day.connect_rate}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedDay && selectedDayTotals ? (
        <DayDetailModal
          selectedDay={selectedDay}
          totals={selectedDayTotals}
          campaigns={campaigns}
          loading={loading}
          error={fetchError}
          onClose={() => setSelectedDay(null)}
        />
      ) : null}
    </>
  )
}
