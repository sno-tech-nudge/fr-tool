import { useEffect } from 'react'

/**
 * Phone-only touch-ups that need a little behaviour, not just CSS. Runs only
 * while PwaShell is mounted, so the desktop shell never sees any of it, and
 * undoes every change on unmount. Shared components are not edited: this
 * reads the DOM they render and adds classes/attributes the phone CSS keys on.
 *
 * 1. Long-named buttons with an icon show only the icon; pressing and holding
 *    one shows its name.
 * 2. Filter bars fold behind a Filters button; the search box stays out.
 */

/** Labels longer than this many characters fold to their icon. */
const LONG_LABEL = 10
const ICON_CLASS = 'fr-pwa-iconbtn'
const TOGGLE_CLASS = 'fr-pwa-filtertoggle'
const HOLD_MS = 450

const FILTER_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>'

function foldButtons() {
  document.querySelectorAll<HTMLElement>(`.btn:not(.${TOGGLE_CLASS})`).forEach((b) => {
    const label = b.querySelector(':scope > span')?.textContent?.trim() ?? ''
    const fold = !!b.querySelector(':scope > svg') && label.length > LONG_LABEL
    if (fold) {
      if (!b.classList.contains(ICON_CLASS)) b.classList.add(ICON_CLASS)
      // Name it for screen readers, unless the page already did.
      if (b.dataset.frLabel !== label && (!b.hasAttribute('aria-label') || b.dataset.frLabel !== undefined)) {
        b.setAttribute('aria-label', label)
        b.dataset.frLabel = label
      }
    } else if (b.classList.contains(ICON_CLASS)) {
      unfold(b)
    }
  })
}

function unfold(b: HTMLElement) {
  b.classList.remove(ICON_CLASS)
  if (b.dataset.frLabel !== undefined) {
    b.removeAttribute('aria-label')
    delete b.dataset.frLabel
  }
}

function wireFilterBars() {
  // .filterbar: list pages (search + dropdowns). .filterpanel: dashboards (pill groups).
  document.querySelectorAll<HTMLElement>('.fr-pwa__main :is(.filterbar, .filterpanel)').forEach((bar) => {
    if (bar.querySelector(`:scope > .${TOGGLE_CLASS}`)) return
    if (!bar.querySelector(':scope > :is(.field, .filtergroup)')) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `btn btn--secondary ${TOGGLE_CLASS}`
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-label', 'Filters')
    btn.innerHTML = FILTER_ICON
    btn.addEventListener('click', () => {
      const open = bar.toggleAttribute('data-fr-open')
      btn.setAttribute('aria-expanded', String(open))
    })
    // Appended last: React only ever inserts or removes its own nodes, and
    // CSS `order` puts the button beside the search box whatever the DOM order.
    bar.appendChild(btn)
  })
}

/** Record overviews go two fields to a row; a long value keeps the full width. */
const WIDE_CLASS = 'fr-pwa-wide'
const WIDE_VALUE = 28
function markWideDetails() {
  document.querySelectorAll<HTMLElement>('.fr-pwa__main .detaillist__row').forEach((row) => {
    const wide = (row.querySelector('dd')?.textContent?.trim().length ?? 0) > WIDE_VALUE
    if (row.classList.contains(WIDE_CLASS) !== wide) row.classList.toggle(WIDE_CLASS, wide)
  })
}

export function usePwaEnhancements() {
  useEffect(() => {
    let frame = 0
    const run = () => {
      frame = 0
      foldButtons()
      wireFilterBars()
      markWideDetails()
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run) }
    run()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] })

    /* ---------- press and hold shows a folded button's name ---------- */
    let timer = 0
    let tip: HTMLDivElement | null = null
    let swallowClick = false

    const hideTip = () => { tip?.remove(); tip = null }
    const showTip = (b: HTMLElement) => {
      hideTip()
      const label = b.dataset.frLabel ?? b.getAttribute('aria-label') ?? ''
      if (!label) return
      tip = document.createElement('div')
      tip.className = 'fr-pwa-tip'
      tip.textContent = label
      document.body.appendChild(tip)
      const r = b.getBoundingClientRect()
      const w = tip.offsetWidth
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
      tip.style.left = `${left}px`
      tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`
    }

    const onStart = (e: TouchEvent) => {
      const b = (e.target as Element | null)?.closest?.(`.${ICON_CLASS}`) as HTMLElement | null
      window.clearTimeout(timer)
      swallowClick = false
      if (!b) return
      timer = window.setTimeout(() => { swallowClick = true; showTip(b) }, HOLD_MS)
    }
    const onEnd = () => {
      window.clearTimeout(timer)
      if (tip) window.setTimeout(hideTip, 1200)
    }
    const onMove = () => window.clearTimeout(timer)
    // A hold that showed the name is not also a tap.
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.preventDefault()
      e.stopPropagation()
    }
    const onMenu = (e: Event) => {
      if ((e.target as Element | null)?.closest?.(`.${ICON_CLASS}`)) e.preventDefault()
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('click', onClick, true)
    document.addEventListener('contextmenu', onMenu)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.clearTimeout(timer)
      hideTip()
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('contextmenu', onMenu)
      document.querySelectorAll<HTMLElement>(`.${ICON_CLASS}`).forEach(unfold)
      document.querySelectorAll(`.${TOGGLE_CLASS}`).forEach((t) => t.remove())
      document.querySelectorAll('[data-fr-open]').forEach((f) => f.removeAttribute('data-fr-open'))
      document.querySelectorAll(`.${WIDE_CLASS}`).forEach((r) => r.classList.remove(WIDE_CLASS))
    }
  }, [])
}
