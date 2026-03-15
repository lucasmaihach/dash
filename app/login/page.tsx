import { loginAction } from './actions'

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <main className="auth-wrap">
      <section className="auth-card reveal d2">
        <div className="ds-nav reveal d3">
          <div className="ds-nav-logo">
            <span className="ds-nav-logo-dot" />
            <span>Cliente Hub</span>
          </div>
          <span className="ds-pill">Login</span>
        </div>

        <header className="reveal d4">
          <h1>Acesse seu Dashboard</h1>
          <p className="auth-subtext">Insira suas credenciais para acessar o painel de campanhas.</p>
        </header>

        {params.error ? <p className="error reveal d4">{params.error}</p> : null}

        <form action={loginAction} className="field reveal d5" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required placeholder="cliente@empresa.com" />
          </div>

          <div className="field">
            <label htmlFor="password">Senha</label>
            <input id="password" name="password" type="password" required placeholder="********" />
          </div>

          <button className="button-custom" type="submit">
            <div className="points_wrapper" aria-hidden="true">
              <i className="point" />
              <i className="point" />
              <i className="point" />
              <i className="point" />
            </div>
            <span className="inner">Entrar</span>
          </button>
        </form>
      </section>
    </main>
  )
}
