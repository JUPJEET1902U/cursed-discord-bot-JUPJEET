import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useGuildStore } from '@/stores/guildStore'
import { StatCard } from '@/components/ui/Stats'
import { LoadingCard } from '@/components/ui/Loading'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Users, MessageSquare, Coins, Trophy, Zap, Shield } from 'lucide-react'
import { formatNumber } from '@/utils/formatting'

export function OverviewPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const { config, stats, fetchConfig, fetchStats, isLoading } = useGuildStore()

  useEffect(() => {
    if (guildId) {
      fetchConfig(guildId)
      fetchStats(guildId)
    }
  }, [guildId])

  if (isLoading && !config) {
    return <LoadingCard text="Loading server overview..." />
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Server Overview</h1>
        <p className="text-muted-foreground mt-1">
          Quick stats and status for your server
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Total Members"
          value={stats?.memberCount ?? 0}
          icon={<Users />}
          color="blue"
          description="Server members"
        />
        <StatCard
          title="Total Messages"
          value={stats?.totalMessages ?? 0}
          icon={<MessageSquare />}
          color="green"
          description="All-time messages"
        />
        <StatCard
          title="Coins in Circulation"
          value={stats?.totalCoins ?? 0}
          icon={<Coins />}
          color="yellow"
          description="Economy total"
        />
        <StatCard
          title="Total XP Earned"
          value={stats?.totalXP ?? 0}
          icon={<Zap />}
          color="purple"
          description="All users combined"
        />
        <StatCard
          title="Achievements Earned"
          value={stats?.totalAchievements ?? 0}
          icon={<Trophy />}
          color="yellow"
          description="Across all users"
        />
        <StatCard
          title="Active Users"
          value={stats?.activeUsers ?? 0}
          icon={<Shield />}
          color="green"
          description="Last 7 days"
        />
      </div>

      {/* Bot status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">⚙️ Bot Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {config ? (
              <>
                <ConfigRow label="AI Responses" value={config.aiEnabled ? '✅ Enabled' : '❌ Disabled'} />
                <ConfigRow label="AI Personality" value={config.aiPersonality || 'cursed'} />
                <ConfigRow label="Anti-Spam" value={config.antiSpam ? '✅ On' : '❌ Off'} />
                <ConfigRow label="Anti-Link" value={config.antiLink ? '✅ On' : '❌ Off'} />
                <ConfigRow label="Anti-Invite" value={config.antiInvite ? '✅ On' : '❌ Off'} />
                <ConfigRow
                  label="Active Channels"
                  value={config.allowedChannels.length === 0 ? 'All channels' : `${config.allowedChannels.length} channel(s)`}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No configuration loaded</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">🏆 Top Users</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.topUsers?.length ? (
              <div className="space-y-2">
                {stats.topUsers.slice(0, 5).map((user, i) => (
                  <div key={user.userId} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-muted-foreground w-5">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{user.username}</p>
                      <p className="text-xs text-muted-foreground">Level {user.level} • {formatNumber(user.xp)} XP</p>
                    </div>
                    <span className="text-sm font-medium text-yellow-400">
                      🪙 {formatNumber(user.coins)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No user data yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
