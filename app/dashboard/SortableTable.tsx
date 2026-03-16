'use client'

import { useState } from 'react'

export type TableColumn = {
  key: string
  label: string
  type?: 'text' | 'link'
}

type Props = {
  columns: TableColumn[]
  rows: Record<string, string>[]
  firstColStyle?: React.CSSProperties
  pageSize?: number
}

// Converte valores formatados em pt-BR para número comparável
function toNum(v: string): number {
  const n = parseFloat(
    v.replace(/R\$\s*/g, '').replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim()
  )
  return isNaN(n) ? -Infinity : n
}

function renderCellValue(column: TableColumn, value: string | undefined) {
  const cellValue = value ?? ''

  if (column.type === 'link') {
    if (!cellValue || cellValue === '—') return '—'
    return (
      <a href={cellValue} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd' }}>
        Abrir ↗
      </a>
    )
  }

  return cellValue
}

export function SortableTable({ columns, rows, firstColStyle, pageSize = 20 }: Props) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [page, setPage] = useState(0)

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    // Volta para primeira página ao mudar o sort
    setPage(0)
  }

  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = toNum(a[sortKey] ?? '')
        const bv = toNum(b[sortKey] ?? '')
        // fallback para sort alfabético na coluna de nome
        if (av === -Infinity && bv === -Infinity) {
          return sortDir === 'desc'
            ? (b[sortKey] ?? '').localeCompare(a[sortKey] ?? '')
            : (a[sortKey] ?? '').localeCompare(b[sortKey] ?? '')
        }
        return sortDir === 'desc' ? bv - av : av - bv
      })
    : rows

  const totalPages = Math.ceil(sorted.length / pageSize)
  const safePage = Math.min(page, Math.max(0, totalPages - 1))
  const pageStart = safePage * pageSize
  const pageEnd = Math.min(pageStart + pageSize, sorted.length)
  const visible = sorted.slice(pageStart, pageEnd)

  return (
    <div>
      <table>
        <thead>
          <tr>
            {columns.map((col) => {
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
          {visible.map((row, i) => (
            <tr key={pageStart + i}>
              {columns.map((col, j) => (
                <td key={col.key} style={j === 0 ? firstColStyle : undefined}>
                  {renderCellValue(col, row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="table-pagination">
          <button
            className="pagination-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            type="button"
          >
            ← Anterior
          </button>

          <span className="pagination-info">
            {pageStart + 1}–{pageEnd} de {sorted.length}
          </span>

          <button
            className="pagination-btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            type="button"
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  )
}
