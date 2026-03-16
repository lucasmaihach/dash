'use client'

import { useFormStatus } from 'react-dom'

type Props = {
  label: string
  pendingLabel?: string
  className?: string
  style?: React.CSSProperties
}

export function SubmitButton({ label, pendingLabel = 'Atualizando...', className = 'button-secondary', style }: Props) {
  const { pending } = useFormStatus()

  return (
    <button className={className} type="submit" style={style} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </button>
  )
}
