import fs from 'fs'
import { parseCardFaces } from '../src/shared/engine/index.ts'
const data = JSON.parse(fs.readFileSync('database/cards.json', 'utf8')) as { cards: any[] }
for (const name of process.argv.slice(2)) {
  const c = data.cards.find((x) => x.name === name)
  if (!c) { console.log('?', name); continue }
  for (const p of parseCardFaces(c)) {
    const frags = [...p.unsupported, ...(p.spell?.unsupported ?? []), ...(p.spell?.modes ?? []).flatMap((m: any) => m.unsupported), ...p.triggers.flatMap((t: any) => t.modes ? t.modes.flatMap((m: any) => m.unsupported) : t.unsupported), ...p.activated.flatMap((a: any) => a.unsupported)]
    console.log(name, '=>', JSON.stringify(frags))
  }
}
