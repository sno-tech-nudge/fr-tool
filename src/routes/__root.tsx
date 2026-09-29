import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AuthProvider } from '../lib/auth'
import { ToastProvider } from '../components/ui'

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </AuthProvider>
  ),
})
