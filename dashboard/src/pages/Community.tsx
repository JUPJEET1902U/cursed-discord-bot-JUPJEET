import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { MessageSquare, HelpCircle, BarChart2 } from 'lucide-react'

export function CommunityPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Community Features</h1>
        <p className="text-muted-foreground mt-1">
          Engage your community with interactive features
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-5 w-5 text-purple-400" />
              Confessions
            </CardTitle>
            <CardDescription>Anonymous confession system</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p>Coming soon! Configure an anonymous confession channel where members can share thoughts safely.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HelpCircle className="h-5 w-5 text-blue-400" />
              Question of the Day
            </CardTitle>
            <CardDescription>Daily discussion prompts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p>Coming soon! Automatically post daily questions to spark conversation in your community.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart2 className="h-5 w-5 text-green-400" />
              Polls
            </CardTitle>
            <CardDescription>Community voting system</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p>Coming soon! Create polls and let your community vote on decisions.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">🎮 Available Now</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>✅ <strong className="text-foreground">Trivia</strong> — Use <code className="bg-muted px-1 rounded">!trivia</code> to start a trivia game</p>
            <p>✅ <strong className="text-foreground">Roast Battles</strong> — Use <code className="bg-muted px-1 rounded">!roast @user</code> for AI roasts</p>
            <p>✅ <strong className="text-foreground">Leaderboards</strong> — Use <code className="bg-muted px-1 rounded">!richlist</code> and <code className="bg-muted px-1 rounded">!levels</code></p>
            <p>✅ <strong className="text-foreground">Daily Quests</strong> — Use <code className="bg-muted px-1 rounded">!quests</code> to see daily challenges</p>
            <p>✅ <strong className="text-foreground">Achievements</strong> — Use <code className="bg-muted px-1 rounded">!achievements</code> to view earned badges</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
