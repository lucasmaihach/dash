type Props = {
  date: string
  href: string
  isSelected: boolean
  cells: string[]
}

export function DailyTableRow({ date, href, isSelected, cells }: Props) {
  return (
    <tr
      style={{
        background: isSelected ? 'rgba(249,115,22,0.12)' : undefined,
        borderLeft: isSelected ? '3px solid rgba(249,115,22,0.8)' : '3px solid transparent',
        transition: 'background 0.15s ease'
      }}
    >
      <td style={{ fontWeight: isSelected ? 600 : undefined }}>
        <a
          href={href}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'inherit', textDecoration: 'none' }}
        >
          <span style={{ fontSize: 9, opacity: 0.6 }}>{isSelected ? '▼' : '▶'}</span>
          {date}
        </a>
      </td>
      {cells.map((cell, i) => (
        <td key={i}>
          <a href={href} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
            {cell}
          </a>
        </td>
      ))}
    </tr>
  )
}
