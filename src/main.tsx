import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import './styles/app.css'

const router = createRouter({ routeTree })

// Number fields: the mouse wheel scrolls the page, never the value. A focused
// number input changes on wheel by default, so it is let go before the wheel
// lands; typing is the only way to change a number.
document.addEventListener('wheel', (e) => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number' && el === e.target) el.blur()
}, { capture: true, passive: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
