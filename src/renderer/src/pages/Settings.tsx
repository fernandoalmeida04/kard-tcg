import { useEffect, useState } from 'react'
import { useApp } from '../store'
import { LANGUAGES, type ClaudeModel, type LangCode } from '@shared/types'
import { playmatImageUrl } from '@shared/api'
import { UI_LANGUAGES, t, type UiLang } from '@shared/i18n'
import {
  DEFAULT_BOARD_LAYOUT,
  MAT_ICON,
  MAT_LABEL,
  MAT_PRESETS,
  MAT_ZONES,
  MAX_BOARD_ROWS,
  ZONE_ICON,
  ZONE_LABEL,
  cloneMat,
  mainColumnOf,
  matAreas,
  moveMainColumn,
  matTracks,
  mirrorMat,
  normalizeBoardLayout,
  normalizeMatLayout,
  swapMatZones,
  type BoardLayout,
  type MatLayout,
  type MatZone
} from '@shared/board'

const MODELS: { id: ClaudeModel; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (mais preciso — padrão)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (equilíbrio)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (mais rápido e barato)' }
]

function MatLayoutEditor({ layout, onChange, image, dim }: { layout: MatLayout; onChange: (l: MatLayout) => void; image: string | null; dim: number }) {
  const [picked, setPicked] = useState<MatZone | null>(null)
  const [warn, setWarn] = useState('')
  const { cols, rows } = matTracks(layout)
  const click = (z: MatZone) => {
    setWarn('')
    if (!picked) return setPicked(z)
    if (picked !== z) {
      const next = swapMatZones(layout, picked, z)
      if (next) onChange(next)
      else setWarn(t('"{a}" e "{b}" não podem trocar de lugar sem mudar de tamanho. Para mudar a coluna do campo de batalha e dos terrenos, use "Coluna principal".', { a: t(MAT_LABEL[picked]), b: t(MAT_LABEL[z]) }))
    }
    setPicked(null)
  }
  const main = mainColumnOf(layout)
  const preset = MAT_PRESETS.find((p) => matAreas(p.layout) === matAreas(layout))?.id ?? ''
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={preset} onChange={(e) => { const p = MAT_PRESETS.find((x) => x.id === e.target.value); if (p) onChange(cloneMat(p.layout)) }}>
          {!preset && <option value="">{t('Personalizado')}</option>}
          {MAT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(p.name)}
            </option>
          ))}
        </select>
        <label className="row small" style={{ gap: 6 }}>
          {t('Coluna principal:')}
          <select value={main} onChange={(e) => onChange(moveMainColumn(layout, Number(e.target.value)))}>
            <option value={0}>{t('Esquerda')}</option>
            <option value={1}>{t('Centro')}</option>
            <option value={2}>{t('Direita')}</option>
          </select>
        </label>
        <button className="btn sm" onClick={() => onChange(mirrorMat(layout))}>
          ⇋ {t('Espelhar')}
        </button>
      </div>
      <div className={`small ${warn ? '' : 'muted'}`} style={warn ? { color: 'var(--warn)' } : undefined}>
        {warn ||
          (picked
            ? t('Agora clique na área que vai trocar de lugar com "{zone}".', { zone: t(MAT_LABEL[picked]) })
            : t('Clique numa área e depois em outra para trocá-las de lugar. Os tamanhos são fixos: só a posição muda.'))}
      </div>
      <div className="mat-editor" style={{ ...(image ? { backgroundImage: `linear-gradient(rgba(4,6,16,${dim}), rgba(4,6,16,${dim})), url("${playmatImageUrl(image)}")` } : {}), gridTemplateColumns: cols.replace(/var\(--mat-side-w\)/g, '90px'), gridTemplateRows: rows.replace(/var\(--mat-lands-h\)/g, '54px').replace(/minmax\(0, 0\.7fr\)/g, '44px').replace(/minmax\(0, 1fr\)/g, '1fr'), gridTemplateAreas: matAreas(layout) }}>
        {MAT_ZONES.map((z) => (
          <button key={z} className={`mat-editor-zone ${picked === z ? 'picked' : ''} ${picked && picked !== z ? 'swap-target' : ''}`} style={{ gridArea: z }} onClick={() => click(z)}>
            <span style={{ fontSize: 18 }}>{MAT_ICON[z]}</span>
            <span>{t(MAT_LABEL[z])}</span>
          </button>
        ))}
      </div>
      <div className="small muted">{t('Seu playmat fica na parte de baixo da mesa; o do oponente aparece espelhado em cima, com o campo de batalha voltado para o centro.')}</div>
    </div>
  )
}

function BoardLayoutEditor({ layout, onChange }: { layout: BoardLayout; onChange: (l: BoardLayout) => void }) {
  const clone = () => layout.map((r) => [...r])
  const moveH = (ri: number, zi: number, d: -1 | 1) => {
    const l = clone()
    const row = l[ri]
    const j = zi + d
    if (j < 0 || j >= row.length) return
    ;[row[zi], row[j]] = [row[j], row[zi]]
    onChange(l)
  }
  const moveV = (ri: number, zi: number, d: -1 | 1) => {
    const l = clone()
    const [z] = l[ri].splice(zi, 1)
    const target = ri + d
    if (target < 0) l.unshift([z])
    else if (target >= l.length) l.push([z])
    else l[target].push(z)
    onChange(normalizeBoardLayout(l))
  }
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="board-layout-editor">
        <div className="ble-center small muted">▲ {t('centro da mesa (oponente)')}</div>
        {layout.map((row, ri) => (
          <div key={ri} className="ble-row">
            <span className="ble-num small muted">{t('Linha {n}', { n: ri + 1 })}</span>
            {row.map((z, zi) => (
              <span key={z} className="ble-zone">
                <span>
                  {ZONE_ICON[z]} {t(ZONE_LABEL[z])}
                </span>
                <span className="ble-acts">
                  <button className="icon-btn" title={t('Para a esquerda')} disabled={zi === 0} onClick={() => moveH(ri, zi, -1)}>
                    ◀
                  </button>
                  <button className="icon-btn" title={t('Para a direita')} disabled={zi === row.length - 1} onClick={() => moveH(ri, zi, 1)}>
                    ▶
                  </button>
                  <button className="icon-btn" title={t('Linha de cima (mais perto do centro)')} disabled={ri === 0 && (row.length === 1 || layout.length >= MAX_BOARD_ROWS)} onClick={() => moveV(ri, zi, -1)}>
                    ▲
                  </button>
                  <button className="icon-btn" title={t('Linha de baixo')} disabled={ri === layout.length - 1 && (row.length === 1 || layout.length >= MAX_BOARD_ROWS)} onClick={() => moveV(ri, zi, 1)}>
                    ▼
                  </button>
                </span>
              </span>
            ))}
          </div>
        ))}
        <div className="ble-center small muted">▼ {t('sua mão')}</div>
      </div>
      <div>
        <button className="btn sm" onClick={() => onChange(DEFAULT_BOARD_LAYOUT.map((r) => [...r]))}>
          ⟲ {t('Restaurar padrão')}
        </button>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const settings = useApp((s) => s.settings)
  const save = useApp((s) => s.saveSettings)
  const toast = useApp((s) => s.toast)
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.kard.app.version().then(setVersion)
  }, [])

  if (!settings) return <div className="page">{t('Carregando...')}</div>

  const playmatAction = async (fn: 'choosePlaymat' | 'clearPlaymat') => {
    const call = window.kard.settings[fn] as (() => Promise<typeof settings>) | undefined
    if (typeof call !== 'function') {
      toast(t('O app precisa ser reiniciado para usar a imagem de playmat (feche e abra o Kard de novo).'), 'error')
      return
    }
    try {
      useApp.setState({ settings: await call() })
    } catch (err) {
      toast(
        fn === 'choosePlaymat'
          ? t('Não foi possível carregar a imagem: {error}', { error: (err as Error).message })
          : t('Não foi possível remover a imagem: {error}', { error: (err as Error).message }),
        'error'
      )
    }
  }

  const test = async () => {
    setTesting(true)
    const r = await window.kard.judge.test()
    setTesting(false)
    toast(r.ok ? `✓ ${r.answer}` : t('Falha: {error}', { error: r.error ?? '' }), r.ok ? 'success' : 'error')
  }

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h1>{t('Configurações')}</h1>
      <div className="sub">{t('Preferências do Kard.')}</div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('Idioma do programa')}</h3>
        <label className="field" style={{ maxWidth: 320 }}>
          {t('Idioma da interface (menus, mensagens e registro da partida)')}
          <select value={settings.uiLanguage ?? 'pt'} onChange={(e) => save({ uiLanguage: e.target.value as UiLang })}>
            {UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('Cartas')}</h3>
        <label className="field" style={{ maxWidth: 320 }}>
          {t('Idioma preferido das cartas')}
          <select value={settings.cardLanguage} onChange={(e) => save({ cardLanguage: e.target.value as LangCode })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <div className="small muted" style={{ marginTop: 8 }}>
          {t('O idioma é aplicado ao baixar/atualizar o banco de cartas (página Banco de cartas).')}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>⚖ {t('Juiz IA (Claude)')}</h3>
        <div className="small muted" style={{ marginBottom: 12, lineHeight: 1.5 }}>
          {t('Toda partida passa pelo juiz de regras local do Kard, que valida cada jogada, as etapas do turno, a pilha, o combate e as ações baseadas em estado. Com o Juiz IA ativado, o Claude também interpreta textos de cartas que o motor não reconhece automaticamente e responde dúvidas de regras durante o jogo. Requer uma chave de API da Anthropic (cobrança por uso na sua conta).')}
        </div>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={settings.aiJudgeEnabled} onChange={(e) => save({ aiJudgeEnabled: e.target.checked })} />
          {t('Ativar Juiz IA nas partidas')}
        </label>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">
            {t('Chave da API da Anthropic')} {settings.hasApiKey && <span className="badge ok">{t('configurada')}</span>}
            <input type="password" placeholder={settings.hasApiKey ? `•••••••• ${t('(deixe em branco para manter)')}` : 'sk-ant-...'} value={key} onChange={(e) => setKey(e.target.value)} />
          </label>
          <button
            className="btn primary"
            disabled={!key.trim()}
            onClick={async () => {
              await save({ apiKey: key.trim() })
              setKey('')
              toast(t('Chave salva (criptografada neste computador).'), 'success')
            }}
          >
            {t('Salvar chave')}
          </button>
          {settings.hasApiKey && (
            <button
              className="btn danger"
              onClick={async () => {
                await save({ apiKey: null })
                toast(t('Chave removida.'))
              }}
            >
              {t('Remover')}
            </button>
          )}
        </div>
        <div className="row wrap" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ minWidth: 340 }}>
            {t('Modelo')}
            <select value={settings.aiModel} onChange={(e) => save({ aiModel: e.target.value as ClaudeModel })}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.label)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={!settings.hasApiKey || testing} onClick={test}>
            {testing ? t('Testando...') : t('Testar conexão')}
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>
          {t('A chave também pode vir da variável de ambiente ANTHROPIC_API_KEY. As requisições usam fallback automático do servidor caso o modelo recuse um pedido.')}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('Partida')}</h3>
        <div className="col">
          <label className="check">
            <input type="checkbox" checked={settings.autoPass} onChange={(e) => save({ autoPass: e.target.checked })} />
            {t('Passar prioridade automaticamente quando não houver jogadas possíveis')}
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.stopAtEveryStep} onChange={(e) => save({ stopAtEveryStep: e.target.checked })} />
            {t('Parar em todas as etapas (modo detalhado)')}
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.showCardText} onChange={(e) => save({ showCardText: e.target.checked })} />
            {t('Mostrar texto da carta na pré-visualização')}
          </label>
          <label className="field" style={{ maxWidth: 360 }}>
            {t('Velocidade do bot: {ms} ms por ação', { ms: settings.botDelayMs })}
            <input type="range" min={150} max={2000} step={50} value={settings.botDelayMs} onChange={(e) => save({ botDelayMs: Number(e.target.value) })} />
          </label>
          <label className="field" style={{ maxWidth: 420 }}>
            {t('Como jogar cartas da mão')}
            <select value={settings.playMode ?? 'click'} onChange={(e) => save({ playMode: e.target.value as 'click' | 'drag' })}>
              <option value="click">{t('Clicar — a carta vai direto para o campo')}</option>
              <option value="drag">{t('Arrastar — leve a carta até a zona dela')}</option>
            </select>
            <span className="small muted">
              {t('No modo arrastar, ao pressionar uma carta as zonas onde ela pode ser colocada brilham. Também dá para clicar na carta e depois clicar na zona.')}
            </span>
          </label>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>Playmat</h3>
        <div className="small muted" style={{ marginBottom: 10 }}>
          {t('Escolha onde fica cada área do seu lado da mesa.')}
        </div>
        <MatLayoutEditor
          layout={normalizeMatLayout(settings.matLayout)}
          onChange={(matLayout) => save({ matLayout })}
          image={settings.playmatImage}
          dim={settings.playmatDim ?? 0.35}
        />
        <h4 style={{ margin: '16px 0 6px' }}>{t('Imagem do playmat')}</h4>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => playmatAction('choosePlaymat')}>
            🖼 {settings.playmatImage ? t('Trocar imagem…') : t('Escolher imagem…')}
          </button>
          {settings.playmatImage && (
            <button className="btn danger" onClick={() => playmatAction('clearPlaymat')}>
              {t('Remover imagem')}
            </button>
          )}
          <span className="small muted">{t('JPG, PNG ou WebP. Ideal: formato de playmat (cerca de 2:1), como 2400×1200.')}</span>
        </div>
        {settings.playmatImage && (
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            <label className="field" style={{ maxWidth: 360 }}>
              {t('Escurecer imagem: {pct}%', { pct: Math.round((settings.playmatDim ?? 0.35) * 100) })}
              <input type="range" min={0} max={0.85} step={0.05} value={settings.playmatDim ?? 0.35} onChange={(e) => save({ playmatDim: Number(e.target.value) })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.playmatBoth ?? false} onChange={(e) => save({ playmatBoth: e.target.checked })} />
              {t('Usar a mesma imagem no lado do oponente')}
            </label>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>{t('Organização do campo de batalha')}</h3>
        <div className="small muted" style={{ marginBottom: 10 }}>
          {t('Onde cada tipo de permanente fica dentro da área Campo de batalha (terrenos ficam na área própria). A linha 1 é a mais próxima do centro da mesa. Use as setas para mudar a ordem ou a linha.')}
        </div>
        <BoardLayoutEditor layout={normalizeBoardLayout(settings.boardLayout)} onChange={(boardLayout) => save({ boardLayout })} />
      </div>

      <div className="panel">
        <h3>{t('Sobre')}</h3>
        <div className="small muted" style={{ lineHeight: 1.6 }}>
          Kard - TCG Simulator {version && `v${version}`}
          <br />
          {t('Dados e imagens de cartas fornecidos pelo Scryfall (scryfall.com). Magic: The Gathering, seus símbolos e textos de cartas são propriedade da Wizards of the Coast. O Kard é um projeto não oficial, não afiliado nem endossado pela Wizards of the Coast, e é distribuído sob a Política de Conteúdo de Fãs da Wizards.')}
        </div>
      </div>
    </div>
  )
}
