import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { DISCORD_OAUTH_URL } from '@/utils/constants'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'

export function LoginPage() {
  const { login, isAuthenticated, isLoading, error } = useAuthStore()
  const { addToast } = useUIStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // Handle OAuth callback
  useEffect(() => {
    const code = searchParams.get('code')
    if (code) {
      login(code)
        .then(() => navigate('/dashboard', { replace: true }))
        .catch(() => {
          addToast({ type: 'error', title: 'Login failed', message: 'Could not authenticate with Discord.' })
        })
    }
  }, [searchParams])

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated])

  if (isLoading) {
    return <Loading fullPage text="Authenticating with Discord..." />
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">👹</div>
          <h1 className="text-3xl font-bold gradient-text">CURSED Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Manage your Discord bot with ease
          </p>
        </div>

        {/* Login card */}
        <div className="glass rounded-2xl p-8 space-y-6">
          <div className="space-y-2 text-center">
            <h2 className="text-xl font-semibold">Welcome back</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with Discord to access your server dashboard
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            className="w-full h-11 text-base"
            onClick={() => window.location.href = DISCORD_OAUTH_URL}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.1.132 18.11a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
            </svg>
            Continue with Discord
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            By signing in, you agree to our Terms of Service.
            We only request the permissions needed to manage your servers.
          </p>
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          {[
            { icon: '⚙️', label: 'Full Config' },
            { icon: '📊', label: 'Statistics' },
            { icon: '🛡️', label: 'Moderation' },
          ].map((f) => (
            <div key={f.label} className="glass rounded-xl p-3">
              <div className="text-2xl mb-1">{f.icon}</div>
              <p className="text-xs text-muted-foreground">{f.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
