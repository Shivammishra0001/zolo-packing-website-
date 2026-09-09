import { useEffect, useRef, useState } from 'react'

/**
 * Animates a number from 0 to `value` once the element is on screen.
 *
 * Three things this has to survive, because the figure is content rather than
 * decoration and must never be wrong:
 *
 * * `prefers-reduced-motion` — snap straight to the value;
 * * a value that arrives late. Dashboard figures come from an API, so a card
 *   mounts showing 0 and learns the real number a moment later. The animation
 *   therefore targets whatever the value is *now*, read from a ref rather than
 *   captured in the effect's closure, and a change after the intro has played
 *   snaps instead of replaying it;
 * * a hidden document. Neither `requestAnimationFrame` nor
 *   `IntersectionObserver` fires in a background tab, so a dashboard opened in
 *   one would otherwise sit at 0 indefinitely. If the animation has not started
 *   shortly after mount, the value is shown without it.
 */
const START_TIMEOUT_MS = 400

export function useCountUp(value: number, { duration = 1100, decimals = 0 } = {}) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLElement | null>(null)
  const played = useRef(false)

  // Always readable at its latest, so a frame mid-animation targets the current
  // figure instead of the one the effect closed over.
  const target = useRef(value)
  target.current = value

  useEffect(() => {
    // Once the entrance has played, later changes are data updates, not an
    // entrance — snap straight to them.
    if (played.current) {
      setDisplay(value)
      return
    }

    const node = ref.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced || !node || typeof IntersectionObserver === 'undefined') {
      setDisplay(value)
      return
    }

    let frame = 0
    let cancelled = false

    const run = () => {
      if (played.current || cancelled) return
      played.current = true
      const start = performance.now()

      const tick = (now: number) => {
        if (cancelled) return
        const t = Math.min(1, (now - start) / duration)
        // easeOutExpo — fast, confident settle
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
        const next = target.current * eased
        setDisplay(decimals ? Number(next.toFixed(decimals)) : Math.round(next))
        if (t < 1) {
          frame = requestAnimationFrame(tick)
        } else {
          // Land exactly on the figure, whatever it became during the run.
          setDisplay(target.current)
        }
      }
      frame = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run()
          observer.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    observer.observe(node)

    // The animation is a nicety; the number is not. If nothing has started it —
    // a hidden tab, a browser that throttles observers — show the figure.
    const fallback = window.setTimeout(() => {
      if (!played.current && !cancelled) {
        played.current = true
        setDisplay(target.current)
      }
    }, START_TIMEOUT_MS)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.clearTimeout(fallback)
    }
  }, [value, duration, decimals])

  return { ref, display }
}
