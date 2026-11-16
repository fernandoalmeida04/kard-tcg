import { parseEffectText } from '../src/shared/engine/parser.ts'
const t = process.argv.slice(2).join(' ')
console.log(JSON.stringify(parseEffectText(t), null, 1))
