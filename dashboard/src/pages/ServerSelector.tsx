import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGuildStore } from '@/stores/guildStore'
import { useAuthStore } from '@/stores/authStore'
import { getGuildIconUrl } from '@/utils/formatting'
import { LoadingCard } from '@/components/ui/Loading'
import { Button } from '@/components/ui/Button'
import { ExternalLink, CheckCircle, XCircle, Search } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/utils/cn'

export function ServerSelectorPage() {
  const { guilds, fetchGuilds, selectGuild, isLoading } = useGuildStore()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchGuilds()
  }, [])

  const filtered = guilds.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  )

  const botGuilds = filtered.filter((g) => g.botPresent)
  const otherGuilds = filtered.filter((g) => !g.botPresent)

  function handleSelect(guildId: string) {
    selectGuild(guildId)
    navigate(`/dashboard/${guildId}/overview`)
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Select a Server</h1>
          <p className="text-muted-foreground mt-1">
            Choose a server to manage. CURSED must be in the server to configure it.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search servers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg border border-input bg-card text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {isLoading ? (
          <LoadingCard text="Loading your servers..." />
        ) : (
          <div className="space-y-6">
            {/* Servers with bot */}
            {botGuilds.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  ✅ CURSED is in these servers ({botGuilds.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {botGuilds.map((guild) => (
                    <GuildCard
                      key={guild.id}
                      guild={guild}
                      onSelect={() => handleSelect(guild.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Servers without bot */}
            {otherGuilds.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  ➕ Add CURSED to these servers ({otherGuilds.length})
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {otherGuilds.map((guild) => (
                    <GuildCard
                      key={guild.id}
                      guild={guild}
                      onInvite={() => {
                        const url = `https://discord.com/oauth2/authorize?client_id=${import.meta.env.VITE_DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands&guild_id=${guild.id}`
                        window.open(url, '_blank')
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-4xl mb-3">🔍</p>
                <p>No servers found matching "{search}"</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface GuildCardProps {
  guild: {
    id: string
    name: string
    icon: string | null
    botPresent?: boolean
    memberCount?: number
  }
  onSelect?: () => void
  onInvite?: () => void
}

function GuildCard({ guild, onSelect, onInvite }: GuildCardProps) {
  return (
    <div className={cn(
      'glass rounded-xl p-4 flex items-center gap-3 transition-all duration-150',
      onSelect && 'hover:border-primary/30 cursor-pointer',
    )}
      onClick={onSelect}
    >
      <img
        src={getGuildIconUrl(guild.id, guild.icon, 64)}
        alt={guild.name}
        className="h-12 w-12 rounded-full shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).src = 'https://cdn.discordapp.com/embed/avatars/0.png'
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{guild.name}</p>
        <div className="flex items-center gap-1 mt-0.5">
          {guild.botPresent ? (
            <CheckCircle className="h-3 w-3 text-green-400" />
          ) : (
            <XCircle className="h-3 w-3 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {guild.botPresent ? 'Bot active' : 'Bot not added'}
          </span>
        </div>
      </div>
      {onInvite && (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => { e.stopPropagation(); onInvite() }}
        >
          <ExternalLink className="h-3 w-3" />
          Add
        </Button>
      )}
    </div>
  )
}
