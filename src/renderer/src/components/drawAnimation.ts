// Animação da compra do início do turno: a carta nova "voa" do deck até a mão.
// Usada pelas mesas de Magic e de Pokémon. Requisitos no DOM:
//   - cada carta da mão tem `data-hand-id="<id>"`
//   - o deck do jogador tem `data-my-deck`
// Usa a Web Animations API (el.animate) e não classes CSS: assim a animação não é cortada quando o
// React re-renderiza a mão e troca o className (ex.: a carta vira "jogável" logo depois da compra).
import { useLayoutEffect, useRef } from 'react'

/**
 * @param handIds ids das cartas da minha mão (na ordem exibida)
 * @param turnKey identifica o MEU turno atual (null fora do meu turno): a primeira carta nova que
 *                aparecer na mão durante esse turno é a compra do início do turno
 * @param enabled configuração "animação ao comprar"
 */
export function useDrawAnimation(handIds: string[], turnKey: string | null, enabled: boolean): void {
  const prev = useRef<Set<string> | null>(null)
  const animatedTurn = useRef<string | null>(null)

  useLayoutEffect(() => {
    const before = prev.current
    prev.current = new Set(handIds)
    // primeira renderização (mão inicial) não anima
    if (!before || !enabled || turnKey === null || animatedTurn.current === turnKey) return
    const fresh = handIds.filter((id) => !before.has(id))
    if (!fresh.length) return
    animatedTurn.current = turnKey
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const deck = document.querySelector('[data-my-deck]') as HTMLElement | null
    const from = deck?.getBoundingClientRect()
    fresh.forEach((id, i) => {
      const el = document.querySelector(`[data-hand-id="${CSS.escape(id)}"]`) as HTMLElement | null
      if (!el || typeof el.animate !== 'function') return
      const to = el.getBoundingClientRect()
      // sem o deck na tela, a carta sobe de baixo
      const dx = Math.round(from ? from.left + from.width / 2 - (to.left + to.width / 2) : 0)
      const dy = Math.round(from ? from.top + from.height / 2 - (to.top + to.height / 2) : 160)
      // posição normal da carta na mão (no Magic as cartas ficam meio escondidas embaixo)
      const rest = getComputedStyle(el).transform
      const restTransform = rest && rest !== 'none' ? rest : 'none'
      const glow = 'drop-shadow(0 0 14px rgba(255, 214, 90, 0.85))'
      el.dataset.drawing = '1'
      const prevZ = el.style.zIndex
      el.style.zIndex = '60'
      const anim = el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(0.45) rotate(-12deg)`, opacity: 0.15, filter: 'brightness(1.7)' },
          { offset: 0.55, transform: 'translate(0, -46px) scale(1.18) rotate(2deg)', opacity: 1, filter: `brightness(1.15) ${glow}` },
          { offset: 0.8, transform: 'translate(0, -38px) scale(1.14) rotate(0deg)', opacity: 1, filter: glow },
          { transform: restTransform, opacity: 1, filter: 'none' }
        ],
        { duration: 850, delay: i * 120, easing: 'cubic-bezier(0.2, 0.8, 0.25, 1)', fill: 'backwards' }
      )
      const done = () => {
        delete el.dataset.drawing
        el.style.zIndex = prevZ
      }
      anim.onfinish = done
      anim.oncancel = done
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handIds.join('|'), turnKey, enabled])
}
