import { NavLink, useParams } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { useUIStore } from '@/stores/uiStore'
import {
  LayoutDashboard,
  BarChart3,
  Settings,
  Bot,
  Sparkles,
  UserPlus,
  MessageSquare,
  Users,
  ChevronLeft,
  Server,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

function getNavItems(guildId: string): NavItem[] {
  const base = `/dashboard/${guildId}`
  return [
    { label: 'Overview',       href: `${base}/overview`,       icon: <LayoutDashboard className="h-4 w-4" /> },
    { label: 'Statistics',     href: `${base}/statistics`,     icon: <BarChart3 className="h-4 w-4" /> },
    { label: 'Bot Config',     href: `${base}/bot-config`,     icon: <Settings className="h-4 w-4" /> },
    { label: 'AI Config',      href: `${base}/ai-config`,      icon: <Sparkles className="h-4 w-4" /> },
    { label: 'Welcome',        href: `${base}/welcome`,        icon: <UserPlus className="h-4 w-4" /> },
    { label: 'Moderation',     href: `${base}/moderation`,     icon: <Bot className="h-4 w-4" /> },
    { label: 'Community',      href: `${base}/community`,      icon: <Users className="h-4 w-4" /> },
  ]
}

export function Sidebar() {
  const { guildId } = useParams<{ guildId: string }>()
  const { sidebarOpen, setSidebarOpen } = useUIStore()

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-14 bottom-0 z-30 flex flex-col border-r border-border bg-card transition-all duration-200',
          sidebarOpen ? 'w-56' : 'w-0 overflow-hidden',
          'lg:relative lg:top-0',
        )}
      >
        <div className="flex flex-col h-full p-3 gap-1 min-w-[224px]">
          {/* Server selector link */}
          <NavLink
            to="/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all text-sm font-medium mb-2"
          >
            <Server className="h-4 w-4" />
            <span>All Servers</span>
          </NavLink>

          <hr className="border-border mb-2" />

          {guildId ? (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
                Server Settings
              </p>
              {getNavItems(guildId).map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    cn('nav-item', isActive && 'active')
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs text-muted-foreground text-center px-4">
                Select a server to manage its settings
              </p>
            </div>
          )}

          <div className="flex-1" />

          {/* Collapse button */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-all text-sm"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Collapse</span>
          </button>
        </div>
      </aside>
    </>
  )
}
