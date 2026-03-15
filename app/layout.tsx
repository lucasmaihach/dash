import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cliente Hub',
  description: 'Painel de desempenho de campanhas Meta Ads'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="lumina-bg" />
        <div className="lumina-grid" aria-hidden="true">
          <div className="lumina-grid-col">
            <span className="beam beam-4" />
          </div>
          <div className="lumina-grid-col">
            <span className="beam beam-1" />
            <span className="beam-wide beam-wide-1" />
          </div>
          <div className="lumina-grid-col">
            <span className="beam beam-2" />
            <span className="beam-wide beam-wide-2" />
          </div>
          <div className="lumina-grid-col">
            <span className="beam beam-3" />
            <span className="beam-wide beam-wide-3" />
          </div>
          <div className="lumina-grid-col">
            <span className="beam beam-5" />
          </div>
        </div>
        {children}
      </body>
    </html>
  )
}
