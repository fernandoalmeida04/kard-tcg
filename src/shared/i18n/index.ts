// Internacionalização no estilo gettext: o texto em português é a própria chave.
// Uso: t('Seu cemitério'), t('{name} se transforma em {other}.', { name, other }).
// Sem tradução para o idioma atual, o texto em português aparece (nada quebra).
//
// Regras:
// - Chame t() na hora de usar o texto (render, log, mensagem), nunca no topo do módulo:
//   tabelas constantes guardam o texto em português e a tradução é feita ao exibir.
// - Este módulo é TS puro com imports `.ts` para rodar também em scripts `node --experimental-strip-types`.
import enGame from './en/game.ts'
import enPages from './en/pages.ts'
import enComponents from './en/components.ts'
import enShared from './en/shared.ts'
import enMain from './en/main.ts'
import enEngine from './en/engine.ts'
import enParser from './en/parser.ts'
import enPokemon from './en/pokemon.ts'
import enPokemonPages from './en/pokemonPages.ts'
import enPokemonEditor from './en/pokemonEditor.ts'
import enGames from './en/games.ts'
import enGamesUi from './en/gamesUi.ts'
import enYgo from './en/ygo.ts'
import enAuth from './en/auth.ts'
import enOnline from './en/online.ts'
import enIssues from './en/issues.ts'
import enSocial from './en/social.ts'
import enPkmGame from './en/pkmGame.ts'
import enSandbox from './en/sandbox.ts'
import enAdmin from './en/admin.ts'

export type UiLang = 'pt' | 'en'

export const UI_LANGUAGES: { code: UiLang; label: string; locale: string }[] = [
  { code: 'pt', label: 'Português (Brasil)', locale: 'pt-BR' },
  { code: 'en', label: 'English', locale: 'en-US' }
]

const DICTS: Record<UiLang, Record<string, string> | null> = {
  pt: null,
  en: { ...enShared, ...enMain, ...enEngine, ...enParser, ...enComponents, ...enPages, ...enGame, ...enPokemon, ...enPokemonPages, ...enPokemonEditor, ...enGames, ...enGamesUi, ...enYgo, ...enAuth, ...enOnline, ...enIssues, ...enSocial, ...enPkmGame, ...enSandbox, ...enAdmin }
}

let current: UiLang = 'pt'

export function setUiLang(lang: string | undefined | null): void {
  current = lang && lang in DICTS ? (lang as UiLang) : 'pt'
}

export function getUiLang(): UiLang {
  return current
}

/** Locale para números e datas (ex.: 'pt-BR'). */
export function uiLocale(): string {
  return UI_LANGUAGES.find((l) => l.code === current)?.locale ?? 'pt-BR'
}

/** Traduz um texto (em português) para o idioma atual, preenchendo {variáveis}. */
export function t(src: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current]
  let s = (dict && dict[src]) || src
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
  return s
}

/** Número formatado no idioma atual (separador de milhar etc.). */
export function fmtNum(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString(uiLocale())
}

export function fmtDate(d: string | number | Date): string {
  return new Date(d).toLocaleDateString(uiLocale())
}

export function fmtDateTime(d: string | number | Date): string {
  return new Date(d).toLocaleString(uiLocale())
}
