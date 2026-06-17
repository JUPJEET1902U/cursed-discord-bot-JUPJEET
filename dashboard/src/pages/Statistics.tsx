import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useGuildStore } from '@/stores/guildStore'
import { LoadingCard } from '@/components/ui/Loading'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/Stats'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Users, MessageSquare, Coins, Trophy } from 'lucide-react'
import { formatNumber } from '@/utils/formatting'

const CHART_COLORS = ['#FF4444', '#00AAFF', '#44FF88', '#FFD700', '#9B59B6', '#E67E22']

export function StatisticsPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const { stats, fetchStats, isLoading } = useGuildStore()

  useEffect(() => {
    if (guildId) fetchStats(guildId)
  }, [guildId])

  if (isLoading && !stats) return <LoadingCard text="Loading statistics..." />

  // Generate mock activity data if none exists
  const activityData = stats?.dailyActivity?.length
    ? stats.dailyActivity
    : Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - i))
        return {
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          messages: Math.floor(Math.random() * 200) + 50,
          commands: Math.floor(Math.random() * 80) + 10,
        }
      })

  const commandData = stats?.commandUsage?.slice(0, 8) || [
    { command: '!daily', count: 145 },
    { command: '!balance', count: 132 },
    { command: '!roast', count: 98 },
    { command: '!shop', count: 76 },
    { command: '!help', count: 65 },
    { command: '!rank', count: 54 },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Statistics</h1>
        <p className="text-muted-foreground mt-1">Server activity and usage analytics</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Members" value={stats?.memberCount ?? 0} icon={<Users />} color="blue" />
        <StatCard title="Messages" value={stats?.totalMessages ?? 0} icon={<MessageSquare />} color="green" />
        <StatCard title="Total Coins" value={stats?.totalCoins ?? 0} icon={<Coins />} color="yellow" />
        <StatCard title="Achievements" value={stats?.totalAchievements ?? 0} icon={<Trophy />} color="purple" />
      </div>

      {/* Activity chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📈 7-Day Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={activityData}>
              <defs>
                <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#FF4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="cmdGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00AAFF" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00AAFF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend />
              <Area type="monotone" dataKey="messages" stroke="#FF4444" fill="url(#msgGrad)" name="Messages" />
              <Area type="monotone" dataKey="commands" stroke="#00AAFF" fill="url(#cmdGrad)" name="Commands" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top commands */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🔥 Most Used Commands</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={commandData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis dataKey="command" type="category" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={70} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" fill="#FF4444" radius={[0, 4, 4, 0]} name="Uses" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top users */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">🏆 Top Users by XP</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.topUsers?.length ? (
              <div className="space-y-3">
                {stats.topUsers.slice(0, 6).map((user, i) => (
                  <div key={user.userId} className="flex items-center gap-3">
                    <span className="text-sm font-bold w-6 text-center">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium truncate">{user.username}</span>
                        <span className="text-xs text-muted-foreground">Lv.{user.level}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full"
                          style={{ width: `${Math.min(100, (user.xp / (stats.topUsers[0]?.xp || 1)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground w-16 text-right">
                      {formatNumber(user.xp)} XP
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No user data yet</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
