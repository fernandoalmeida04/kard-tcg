import assert from 'node:assert/strict'
import { db } from '../src/main/cardDb.ts'

db.loadFromData({
  version: 1,
  lang: 'en',
  updatedAt: '2026-11-15T00:00:00Z',
  cards: [
    {
      oracleId: 'bolt',
      name: 'Lightning Bolt',
      localName: 'Relâmpago',
      manaCost: '{R}',
      cmc: 1,
      typeLine: 'Instant',
      oracleText: 'Lightning Bolt deals 3 damage to any target.',
      colors: ['R'],
      colorIdentity: ['R'],
      keywords: [],
      legalities: { standard: 'legal', modern: 'legal', commander: 'legal' },
      layout: 'normal',
      defaultPrintingId: 'war-bolt',
      rarity: 'common',
      edhrecRank: 1
    },
    {
      oracleId: 'forest',
      name: 'Forest',
      localName: 'Floresta',
      manaCost: '',
      cmc: 0,
      typeLine: 'Basic Land — Forest',
      oracleText: '{T}: Add {G}.',
      colors: [],
      colorIdentity: ['G'],
      keywords: [],
      legalities: { standard: 'legal', modern: 'legal', commander: 'legal' },
      layout: 'normal',
      defaultPrintingId: 'mkm-forest',
      rarity: 'common',
      edhrecRank: 2
    }
  ],
  printings: [
    {
      id: 'war-bolt',
      oracleId: 'bolt',
      lang: 'en',
      set: 'war',
      setName: 'War of the Spark',
      collectorNumber: '123',
      rarity: 'common',
      releasedAt: '2019-05-03',
      img: {},
      tags: []
    },
    {
      id: 'mkm-forest',
      oracleId: 'forest',
      lang: 'en',
      set: 'mkm',
      setName: 'Modern Horizons 3',
      collectorNumber: '250',
      rarity: 'common',
      releasedAt: '2024-01-01',
      img: {},
      tags: []
    }
  ]
})

const war = db.search({ sets: ['war'], limit: 20 })
assert.equal(war.total, 1)
assert.equal(war.cards[0]?.name, 'Lightning Bolt')

const all = db.search({ limit: 20 })
assert.equal(all.total, 2)

console.log('collection-filter-smoke: ok')
