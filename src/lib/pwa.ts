import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Phone / installed-app detection, shaped like Nucleus's hooks so they can be
 * swapped for its own at the merge. The phone shell renders when the app is
 * installed OR the window is phone-narrow, so a narrow browser tab behaves
 * exactly like the installed app.
 */

const MOBILE_QUERY = '(max-width: 767px)'
const STANDALONE_QUERY = '(display-mode: standalone)'

function subscribeQuery(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }
}

export const isIOS =
  typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

function readStandalone(): boolean {
  return window.matchMedia(STANDALONE_QUERY).matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

const subscribeStandalone = subscribeQuery(STANDALONE_QUERY)
const subscribeMobile = subscribeQuery(MOBILE_QUERY)
const readMobile = () => window.matchMedia(MOBILE_QUERY).matches

export function useIsStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, readStandalone, () => false)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, readMobile, () => false)
}

/**
 * True only while a text field has focus AND the visual viewport has shrunk —
 * a shrink alone (pinch zoom, URL bar collapsing) is not the keyboard.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const check = () => {
      const el = document.activeElement
      const typing = el instanceof HTMLElement
        && (el.isContentEditable
          || el.tagName === 'TEXTAREA'
          || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes((el as HTMLInputElement).type)))
      setOpen(typing && vv.height < window.innerHeight * 0.8)
    }
    // Focus has not moved to the next field yet when focusout fires.
    const later = () => window.setTimeout(check, 50)
    vv.addEventListener('resize', check)
    document.addEventListener('focusin', check)
    document.addEventListener('focusout', later)
    return () => {
      vv.removeEventListener('resize', check)
      document.removeEventListener('focusin', check)
      document.removeEventListener('focusout', later)
    }
  }, [])
  return open
}

/* ---------- install prompt ----------
   Chrome/Android fire beforeinstallprompt once, often before React mounts, so
   it is caught at module load and held here. iOS has no prompt: the shell
   shows an "Add to Home Screen" hint instead. */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

export function usePwaInstall() {
  const standalone = useIsStandalone()
  const canPrompt = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => deferred !== null,
    () => false,
  )
  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    deferred = null
    notify()
  }
  return {
    /** Chrome/Android: a real install prompt is waiting. */
    canPrompt: !standalone && canPrompt,
    /** iOS Safari: only the manual Share → Add to Home Screen route exists. */
    showIosHint: !standalone && isIOS,
    install,
  }
}

/**
 * A phone or tablet (or the installed app), never a laptop. Same test as the
 * inline script in index.html that adds the manifest.
 */
export function isPhoneDevice(): boolean {
  return window.matchMedia('(max-width: 767px), (pointer: coarse), (display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * Production phones only: laptops never get a worker, so desktop behaves
 * exactly as before. In dev a worker would cache Vite's modules and fight HMR.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !isPhoneDevice()) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is a nicety */ })
  })
}
