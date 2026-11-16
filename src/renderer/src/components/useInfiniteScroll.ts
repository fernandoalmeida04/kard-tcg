import { useCallback, useEffect, useRef } from 'react'

/**
 * Rolagem infinita para listas paginadas: chama `onMore` quando o usuário chega perto do fim
 * do contêiner (ou quando o conteúdo ainda não enche a tela e há mais itens).
 */
export function useInfiniteScroll({ count, total, loading, onMore, threshold = 400 }: { count: number; total: number; loading: boolean; onMore: () => void; threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasMore = count < total

  const check = useCallback(() => {
    const el = ref.current
    if (!el || loading || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) onMore()
  }, [loading, hasMore, onMore, threshold])

  // depois de cada carga: se a lista ainda não enche o contêiner, carrega mais
  useEffect(() => {
    check()
  }, [count, check])

  /** Volta ao topo (ao mudar a busca/filtros). */
  const reset = useCallback(() => {
    if (ref.current) ref.current.scrollTop = 0
  }, [])

  return { ref, onScroll: check, hasMore, reset }
}
