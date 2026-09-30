import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { timeAgo } from '../../lib/format'
import { NEWS_CATEGORY, type NewsItem } from '../../lib/news'

/** How long a card is left before the strip moves on by one. */
const AUTO_MS = 5000

/**
 * A row of news cards that scrolls sideways: by trackpad or touch (it is a
 * plain scrolling row), by the arrow buttons, and — only when there are more
 * cards than fit — on its own, one card every few seconds. The self-movement
 * stops while the pointer or focus is inside, and never runs for people who
 * have asked their system for less motion.
 */
export function NewsCarousel({ items }: { items: NewsItem[] }) {
  const track = useRef<HTMLDivElement>(null)
  const paused = useRef(false)
  const [edge, setEdge] = useState({ start: true, end: true })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 })
  }, [])

  useEffect(() => {
    measure()
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, items])

  /** One card's width plus the gap after it. */
  const move = useCallback((dir: 1 | -1) => {
    const el = track.current
    const first = el?.children[0] as HTMLElement | undefined
    if (!el || !first) return
    const second = el.children[1] as HTMLElement | undefined
    const stride = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth
    el.scrollBy({ left: dir * stride, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => {
      const el = track.current
      if (!el || paused.current || document.hidden) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 2) return // everything fits, so there is nowhere to go
      if (el.scrollLeft >= max - 2) el.scrollTo({ left: 0, behavior: 'smooth' })
      else move(1)
    }, AUTO_MS)
    return () => window.clearInterval(id)
  }, [move])

  const hold = () => { paused.current = true }
  const release = () => { paused.current = false }

  return (
    <div
      className="newsrail"
      onMouseEnter={hold}
      onMouseLeave={release}
      onFocus={hold}
      onBlur={release}
      onTouchStart={hold}
      onTouchEnd={() => window.setTimeout(release, 4000)}
    >
      <div className="newsrail__track" ref={track} onScroll={measure}>
        {items.map((n) => (
          <article key={n.id} className="newscard">
            <div className="newscard__meta">
              {n.org_name ? (
                <Link to="/organisations/$id" params={{ id: n.organisation_id }} className="newscard__chip">
                  {n.org_name}
                </Link>
              ) : null}
              <span className="newscard__when tn-num">{timeAgo(n.published_at)}</span>
            </div>
            <a className="newscard__title" href={n.url} target="_blank" rel="noopener noreferrer">
              {n.title}
            </a>
            {n.why ? <p className="newscard__why">{n.why}</p> : null}
            <div className="newscard__foot">
              {[n.category ? NEWS_CATEGORY[n.category] ?? n.category : null, n.source].filter(Boolean).join(' · ')}
            </div>
          </article>
        ))}
      </div>

      {!edge.start ? (
        <button type="button" className="newsrail__nav newsrail__nav--prev" aria-label="Earlier news" onClick={() => move(-1)}>
          <ChevronLeft size={16} />
        </button>
      ) : null}
      {!edge.end ? (
        <button type="button" className="newsrail__nav newsrail__nav--next" aria-label="Later news" onClick={() => move(1)}>
          <ChevronRight size={16} />
        </button>
      ) : null}
    </div>
  )
}
