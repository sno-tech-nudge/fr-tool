import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { Download, LogOut, Menu, Share, X } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useAccess } from '../../lib/accessContext'
import { NAV, isNavActive } from '../../lib/nav'
import { useKeyboardOpen, usePwaInstall } from '../../lib/pwa'
import { MentionBell } from '../MentionBell'

/**
 * The phone / installed-app shell: sticky header, the page, a fixed bottom bar
 * of four tabs plus More. Pages are the same ones the desktop shell renders;
 * every phone-only rule lives in pwa.css under html[data-app-shell="pwa"],
 * the attribute Nucleus's own PwaShell sets, so it carries over at the merge.
 */
export function PwaShell({ children }: { children: React.ReactNode }) {
  const access = useAccess()
  const { email, signOut } = useAuth()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const keyboardOpen = useKeyboardOpen()
  const install = usePwaInstall()
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-app-shell', 'pwa')
    return () => root.removeAttribute('data-app-shell')
  }, [])

  // Any navigation closes the sheet.
  useEffect(() => { setMoreOpen(false) }, [pathname])

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const items = NAV.filter((i) => !i.managerOnly || access.isManager)
  const tabs = items.filter((i) => i.tab)
  const more = items.filter((i) => !i.tab)
  const current = items.find((i) => isNavActive(i, pathname))
  const moreActive = more.some((i) => isNavActive(i, pathname))

  return (
    <div className="fr-pwa">
      <header className="fr-pwa__header">
        <img className="fr-pwa__logo" src="/icons/icon-192.png" alt="The/Nudge" />
        <span className="fr-pwa__title">{current?.label ?? 'Fundraising'}</span>
        <div className="fr-pwa__actions"><MentionBell /></div>
      </header>

      <main className="fr-pwa__main">{children}</main>

      {keyboardOpen ? null : (
        <nav className="fr-pwa__tabbar" aria-label="Main">
          {tabs.map((t) => {
            const Icon = t.icon
            return (
              <Link key={t.to} to={t.to} className="fr-pwa__tab" data-active={isNavActive(t, pathname)}>
                <Icon size={20} strokeWidth={2} aria-hidden="true" />
                <span>{t.label}</span>
              </Link>
            )
          })}
          <button
            type="button"
            className="fr-pwa__tab"
            data-active={moreOpen || moreActive}
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <Menu size={20} strokeWidth={2} aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
      )}

      {moreOpen ? (
        <div className="fr-pwa__scrim" onClick={() => setMoreOpen(false)}>
          <div className="fr-pwa__sheet" role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()}>
            <div className="fr-pwa__sheethead">
              <div className="fr-pwa__user">
                <strong>{access.employeeName ?? email}</strong>
                <span>{access.erpRole}{access.frSubRole ? ` · fr ${access.frSubRole}` : ''}</span>
              </div>
              <button type="button" className="fr-pwa__close" aria-label="Close" onClick={() => setMoreOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {more.map((m) => {
              const Icon = m.icon
              return (
                <Link key={m.to} to={m.to} className="fr-pwa__sheetitem" data-active={isNavActive(m, pathname)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{m.label}</span>
                </Link>
              )
            })}
            {install.canPrompt ? (
              <button type="button" className="fr-pwa__sheetitem" onClick={() => void install.install()}>
                <Download size={18} aria-hidden="true" />
                <span>Install app</span>
              </button>
            ) : null}
            {install.showIosHint ? (
              <div className="fr-pwa__sheetitem fr-pwa__sheetitem--hint">
                <Share size={18} aria-hidden="true" />
                <span>To install, tap Share, then Add to Home Screen</span>
              </div>
            ) : null}
            <button type="button" className="fr-pwa__sheetitem" onClick={() => void signOut()}>
              <LogOut size={18} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
