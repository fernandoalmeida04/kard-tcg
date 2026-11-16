import type { KardApi } from '../shared/api'

declare global {
  interface Window {
    kard: KardApi
  }
}

export {}
