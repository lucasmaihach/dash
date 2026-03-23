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
  const text = pending ? pendingLabel : label
  const isCustom = className.includes('button-custom')

  return (
    <button className={className} type="submit" style={style} disabled={pending} aria-busy={pending}>
      {isCustom ? (
        <>
          <div className="points_wrapper" aria-hidden="true">
            <i className="point" />
            <i className="point" />
            <i className="point" />
            <i className="point" />
          </div>
          <span className="inner">{text}</span>
        </>
      ) : (
        text
      )}
    </button>
  )
}
