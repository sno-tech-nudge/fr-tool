import { useState } from 'react'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { Button, Input, Skeleton } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useIsMobile, useIsStandalone } from '../lib/pwa'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const { session, loading, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Outside both shells, so no phone stylesheet reaches it: iOS zooms into
  // any field under 16px on focus.
  const isMobile = useIsMobile()
  const isStandalone = useIsStandalone()
  const fieldStyle = isMobile || isStandalone ? { fontSize: 16 } : undefined

  if (session) return <Navigate to="/" />

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await signIn(email.trim(), password)
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <div className="login">
      <div className="login__brand-panel">
        <img src="/design-system/logos/thenudge-wordmark-cream.png" alt="The/Nudge" />
        <span className="login__tag">Fundraising</span>
      </div>

      <div className="login__form-panel">
        {loading ? (
          <div className="login__form-inner">
            <Skeleton height={28} width="60%" />
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        ) : (
          <form className="login__form-inner" onSubmit={onSubmit}>
            <div role="heading" aria-level={1} style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--weight-light)',
              fontSize: 'var(--text-xl)',
              lineHeight: 'var(--leading-tight)',
              color: 'var(--ink)',
            }}>
              Sign in
            </div>

            <Input
              label="Email"
              type="email"
              autoComplete="username"
              style={fieldStyle}
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              style={fieldStyle}
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={error}
            />
            <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        )}
      </div>
    </div>
  )
}
