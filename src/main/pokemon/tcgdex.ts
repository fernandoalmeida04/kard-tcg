// Download do banco de cartas do Pokémon TCG pelo TCGdex (API GraphQL aberta, sem chave).
// Uma consulta traz todas as cartas em inglês (regras); outra traz nomes, textos e imagens no idioma escolhido.
import { net } from 'electron'
import fs from 'fs'
import type { DownloadProgress } from '../../shared/types'
import { fmtNum, t } from '../../shared/i18n/index.ts'
import { pkmDb } from './pkmDb'
import { buildDatabase, type RawCard, type RawLocal, type RawSet } from './pkmBuild'

const ENDPOINT = 'https://api.tcgdex.net/v2/graphql'
const HEADERS = { 'User-Agent': 'KardTCGSimulator/0.1', 'Content-Type': 'application/json', Accept: 'application/json' }

const CARD_FIELDS =
  'id localId name image category hp types stage evolveFrom retreat regulationMark rarity illustrator trainerType energyType effect suffix dexId ' +
  'legal { standard expanded } variants { normal reverse holo firstEdition } set { id } ' +
  'attacks { name cost damage effect } abilities { type name effect } weaknesses { type value } resistances { type value }'
const LOCAL_FIELDS = 'id name image effect evolveFrom attacks { name effect } abilities { name effect }'

let abort: AbortController | null = null

export function cancelPkmDownload(): void {
  abort?.abort()
}

async function gql<T>(query: string, signal: AbortSignal): Promise<T> {
  const res = await net.fetch(ENDPOINT, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query }), signal })
  if (!res.ok) throw new Error(`TCGdex HTTP ${res.status}`)
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
  // o TCGdex devolve alguns erros parciais (campos nulos em cartas antigas) junto com os dados: só falha se não vier nada
  if (!json.data) throw new Error(json.errors?.[0]?.message ?? 'TCGdex: resposta vazia')
  return json.data
}

export async function downloadPokemonDatabase(lang: string, progress: (p: DownloadProgress) => void): Promise<void> {
  if (abort) throw new Error(t('Um download já está em andamento.'))
  abort = new AbortController()
  const signal = abort.signal
  try {
    progress({ phase: 'meta', current: 0, total: 3, message: t('Consultando o TCGdex...') })
    const { sets } = await gql<{ sets: (RawSet | null)[] }>('{ sets { id name releaseDate tcgOnline cardCount { official total } serie { id } } }', signal)

    progress({ phase: 'cards', current: 1, total: 3, message: t('Baixando cartas (dados de regras)...') })
    const { cards: rawCards } = await gql<{ cards: (RawCard | null)[] }>(`{ cards { ${CARD_FIELDS} } }`, signal)

    let local = new Map<string, RawLocal>()
    if (lang !== 'en') {
      progress({ phase: 'localized', current: 2, total: 3, message: t('Baixando nomes e textos traduzidos ({lang})...', { lang }) })
      const { cards: rawLocal } = await gql<{ cards: (RawLocal | null)[] }>(`{ cards @locale(lang:"${lang}") { ${LOCAL_FIELDS} } }`, signal)
      local = new Map(rawLocal.filter(Boolean).map((c) => [c!.id, c!]))
    }

    progress({ phase: 'saving', current: 3, total: 3, message: t('Montando e salvando o banco local...') })
    const data = buildDatabase(sets.filter(Boolean) as RawSet[], rawCards.filter(Boolean) as RawCard[], local, lang)
    await fs.promises.writeFile(pkmDb.file(), JSON.stringify(data), 'utf8')
    pkmDb.loadFromData(data)
    progress({
      phase: 'done',
      current: 1,
      total: 1,
      message: t('Pronto! {cards} cartas e {printings} impressões salvas.', { cards: fmtNum(data.cards.length), printings: fmtNum(data.printings.length) })
    })
  } catch (err) {
    if (signal.aborted) progress({ phase: 'cancelled', current: 0, total: 0, message: t('Download cancelado.') })
    else progress({ phase: 'error', current: 0, total: 0, message: t('Erro: {message}', { message: (err as Error).message }) })
    throw err
  } finally {
    abort = null
  }
}
