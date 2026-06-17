import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useGuildStore } from '@/stores/guildStore'
import { useUIStore } from '@/stores/uiStore'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { LoadingCard } from '@/components/ui/Loading'
import { Save, UserPlus, UserMinus, Eye } from 'lucide-react'

const PLACEHOLDERS = [
  '{user} — The new member\'s username',
  '{server} — The server name',
  '{count} — Current member count',
]

export function WelcomeGoodbyePage() {
  const { guildId } = useParams<{ guildId: string }>()
  const { config, fetchConfig, updateConfig, isLoading, isSaving } = useGuildStore()
  const { addToast } = useUIStore()

  const [form, setForm] = useState({
    welcomeEnabled: false,
    welcomeChannelId: '',
    welcomeMessage: '👋 Welcome to the server, {user}! We\'re glad you\'re here.',
    goodbyeEnabled: false,
    goodbyeChannelId: '',
    goodbyeMessage: '👋 {user} has left the server. Goodbye!',
  })

  const [preview, setPreview] = useState<'welcome' | 'goodbye' | null>(null)

  useEffect(() => {
    if (guildId) fetchConfig(guildId)
  }, [guildId])

  useEffect(() => {
    if (config) {
      setForm({
        welcomeEnabled: config.welcomeEnabled ?? false,
        welcomeChannelId: config.welcomeChannelId || '',
        welcomeMessage: config.welcomeMessage || '👋 Welcome to the server, {user}!',
        goodbyeEnabled: config.goodbyeEnabled ?? false,
        goodbyeChannelId: config.goodbyeChannelId || '',
        goodbyeMessage: config.goodbyeMessage || '👋 {user} has left the server.',
      })
    }
  }, [config])

  function getPreviewText(template: string) {
    return template
      .replace(/{user}/g, 'ExampleUser')
      .replace(/{server}/g, 'My Awesome Server')
      .replace(/{count}/g, '1,234')
  }

  async function handleSave() {
    if (!guildId) return
    try {
      await updateConfig(guildId, form)
      addToast({ type: 'success', title: 'Welcome settings saved!' })
    } catch {
      addToast({ type: 'error', title: 'Save failed' })
    }
  }

  if (isLoading && !config) return <LoadingCard text="Loading welcome configuration..." />

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Welcome & Goodbye</h1>
          <p className="text-muted-foreground mt-1">Configure member join and leave messages</p>
        </div>
        <Button onClick={handleSave} isLoading={isSaving} leftIcon={<Save className="h-4 w-4" />}>
          Save Changes
        </Button>
      </div>

      {/* Placeholders reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📝 Available Placeholders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
                {p}
              </code>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Welcome */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-green-400" />
            Welcome Message
          </CardTitle>
          <CardDescription>Sent when a new member joins the server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={form.welcomeEnabled}
            onChange={(v) => setForm((f) => ({ ...f, welcomeEnabled: v }))}
            label="Enable Welcome Messages"
          />
          {form.welcomeEnabled && (
            <>
              <Input
                label="Welcome Channel ID"
                value={form.welcomeChannelId}
                onChange={(e) => setForm((f) => ({ ...f, welcomeChannelId: e.target.value }))}
                placeholder="Channel ID (right-click channel → Copy ID)"
                hint="Enable Developer Mode in Discord settings to copy channel IDs"
              />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Welcome Message</label>
                <textarea
                  value={form.welcomeMessage}
                  onChange={(e) => setForm((f) => ({ ...f, welcomeMessage: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
                <p className="text-xs text-muted-foreground text-right">
                  {form.welcomeMessage.length}/2000
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreview(preview === 'welcome' ? null : 'welcome')}
                leftIcon={<Eye className="h-4 w-4" />}
              >
                {preview === 'welcome' ? 'Hide Preview' : 'Preview'}
              </Button>
              {preview === 'welcome' && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                  <p>{getPreviewText(form.welcomeMessage)}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Goodbye */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserMinus className="h-5 w-5 text-red-400" />
            Goodbye Message
          </CardTitle>
          <CardDescription>Sent when a member leaves the server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={form.goodbyeEnabled}
            onChange={(v) => setForm((f) => ({ ...f, goodbyeEnabled: v }))}
            label="Enable Goodbye Messages"
          />
          {form.goodbyeEnabled && (
            <>
              <Input
                label="Goodbye Channel ID"
                value={form.goodbyeChannelId}
                onChange={(e) => setForm((f) => ({ ...f, goodbyeChannelId: e.target.value }))}
                placeholder="Channel ID"
              />
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Goodbye Message</label>
                <textarea
                  value={form.goodbyeMessage}
                  onChange={(e) => setForm((f) => ({ ...f, goodbyeMessage: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreview(preview === 'goodbye' ? null : 'goodbye')}
                leftIcon={<Eye className="h-4 w-4" />}
              >
                {preview === 'goodbye' ? 'Hide Preview' : 'Preview'}
              </Button>
              {preview === 'goodbye' && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <p className="text-xs text-muted-foreground mb-2">Preview:</p>
                  <p>{getPreviewText(form.goodbyeMessage)}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
