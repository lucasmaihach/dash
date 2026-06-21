'use client'

import { useState } from 'react'

export type TableColumn = {
  key: string
  label: string
  type?: 'text' | 'link'
}

type Props = {
  columns: TableColumn[]
  rows: Record<string, string | number | null | undefined>[]
  firstColStyle?: React.CSSProperties
  pageSize?: number
}

function toCellString(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

// Converte valores formatados em pt-BR para número comparável
function toNum(value: string | number | null | undefined): number {
  const v = toCellString(value)
  const n = parseFloat(
    v.replace(/R\$\s*/g, '').replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim()
  )
  return isNaN(n) ? -Infinity : n
}

function renderCellValue(column: TableColumn, value: string | number | null | undefined) {
  const cellValue = toCellString(value)

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
        const av = toNum(a[sortKey])
        const bv = toNum(b[sortKey])
        // fallback para sort alfabético na coluna de nome
        if (av === -Infinity && bv === -Infinity) {
          const aValue = toCellString(a[sortKey])
          const bValue = toCellString(b[sortKey])
          return sortDir === 'desc'
            ? bValue.localeCompare(aValue)
            : aValue.localeCompare(bValue)
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
