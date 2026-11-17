// Isola erros de renderização: se uma parte da tela quebrar, só ela some (ou mostra o aviso),
// em vez de o React desmontar o app inteiro e deixar a janela escura.
import { Component, type ReactNode } from 'react'
import { t } from '@shared/i18n'

interface Props {
  /** Nome da área (aparece no console). */
  name: string
  children: ReactNode
  /** Sem aviso: a área simplesmente some se der erro (widgets flutuantes). */
  silent?: boolean
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[${this.props.name}] erro de renderização:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.silent) return null
    return (
      <div className="page">
        <div className="panel">
          <h3>{t('Algo deu errado nesta tela')}</h3>
          <div className="small muted" style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>
            {error.message}
          </div>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            {t('Tentar de novo')}
          </button>
        </div>
      </div>
    )
  }
}
