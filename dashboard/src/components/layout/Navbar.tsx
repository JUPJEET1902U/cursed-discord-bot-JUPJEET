import { Menu, Bell, LogOut, ChevronDown } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { getAvatarUrl } from '@/utils/formatting'
import { Button } from '@/components/ui/Button'
import { useState } from 'react'
import { cn } from '@/utils/cn'

export function Navbar() {
  const { user, logout } = useAuthStore()
  const { toggleSidebar } = useUIStore()
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  return (
    <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center px-4 gap-4 sticky top-0 z-40">
      <button
        onClick={toggleSidebar}
        className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2">
        <span className="text-lg font-bold gradient-text">👹 CURSED</span>
        <span className="text-xs text-muted-foreground font-medium px-1.5 py-0.5 rounded bg-muted">Dashboard</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <button className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground relative">
          <Bell className="h-5 w-5" />
        </button>

        {user && (
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent transition-colors"
            >
              <img
                src={getAvatarUrl(user.id, user.avatar, 32)}
                alt={user.username}
                className="h-7 w-7 rounded-full"
              />
              <span className="text-sm font-medium hidden sm:block">{user.username}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden sm:block" />
            </button>

            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setUserMenuOpen(false)}
                />
                <div className={cn(
                  'absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-card shadow-lg z-20',
                  'animate-fade-in',
                )}>
                  <div className="p-2">
                    <div className="px-2 py-1.5 mb-1">
                      <p className="text-sm font-medium">{user.username}</p>
                      <p className="text-xs text-muted-foreground">#{user.discriminator}</p>
                    </div>
                    <hr className="border-border mb-1" />
                    <button
                      onClick={() => { logout(); setUserMenuOpen(false) }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
