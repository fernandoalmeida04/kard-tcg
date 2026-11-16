// Coleção de cartas: explorar todas as cartas do jogo selecionado (página inteira).
import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { t } from '@shared/i18n'
import { isGameId } from '@shared/games/registry'
import type { GameId } from '@shared/games/types'
import SearchPanel from '../components/SearchPanel'
import CardDetail from '../components/CardDetail'
import PkmSearchPanel from '../pokemon/PkmSearchPanel'
import PkmCardDetail from '../pokemon/PkmCardDetail'
import GameSearchPanel from '../games/GameSearchPanel'
import GameCardDetail from '../games/GameCardDetail'

export default function CollectionPage() {
  const tcg = useApp((s) => s.settings?.tcg ?? 'mtg')
  const mtgReady = useApp((s) => s.db?.ready ?? false)
  const go = useApp((s) => s.go)
  const [ready, setReady] = useState<boolean | null>(tcg === 'mtg' ? mtgReady : null)
  const [detail, setDetail] = useState<string | null>(null)

  // Situação do banco do jogo atual (Magic vem da store; os outros perguntam ao processo principal)
  useEffect(() => {
    if (tcg === 'mtg') {
      setReady(mtgReady)
      return
    }
    const check = () => {
      const st = tcg === 'pokemon' ? window.kard.pkm.status() : isGameId(tcg) ? window.kard.games.status(tcg) : Promise.resolve({ ready: false })
      st.then((s) => setReady(s.ready))
    }
    check()
    // o banco pode terminar de carregar depois que a página abriu
    const off = tcg === 'pokemon' ? window.kard.pkm.onProgress(check) : isGameId(tcg) ? window.kard.games.onProgress((g) => g === tcg && check()) : () => undefined
    return off
  }, [tcg, mtgReady])

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column' }}>
      <h1>{t('Coleção de cartas')}</h1>
      {ready === false && (
        <div className="panel">
          <div className="muted" style={{ marginBottom: 10 }}>
            {t('O banco de cartas deste jogo ainda não foi baixado.')}
          </div>
          <button className="btn primary" onClick={() => go('database')}>
            ⬇ {t('Ir para Download de cartas')}
          </button>
        </div>
      )}
      {ready && (
        <div className="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {tcg === 'mtg' && <SearchPanel onPick={(c) => setDetail(c.oracleId)} pageSize={90} />}
          {tcg === 'pokemon' && <PkmSearchPanel onPick={(c) => setDetail(c.id)} pageSize={90} />}
          {isGameId(tcg) && <GameSearchPanel game={tcg as GameId} onPick={(c) => setDetail(c.id)} pageSize={90} />}
        </div>
      )}
      {detail && tcg === 'mtg' && <CardDetail oracleId={detail} onClose={() => setDetail(null)} />}
      {detail && tcg === 'pokemon' && <PkmCardDetail cardId={detail} onClose={() => setDetail(null)} />}
      {detail && isGameId(tcg) && <GameCardDetail game={tcg as GameId} cardId={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
