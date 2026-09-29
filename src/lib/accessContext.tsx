import { createContext, useContext } from 'react'
import type { FrAccess } from '../hooks/useFrAccess'

/**
 * Resolved once in the protected layout and shared downward, so the three
 * access RPCs are called once per session rather than once per component.
 */
const FrAccessContext = createContext<FrAccess | null>(null)

export function FrAccessProvider({
  value, children,
}: {
  value: FrAccess
  children: React.ReactNode
}) {
  return <FrAccessContext.Provider value={value}>{children}</FrAccessContext.Provider>
}

export function useAccess(): FrAccess {
  const ctx = useContext(FrAccessContext)
  if (!ctx) throw new Error('useAccess must be used inside <FrAccessProvider>')
  return ctx
}
