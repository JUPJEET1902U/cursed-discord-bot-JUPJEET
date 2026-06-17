import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useGuildStore } from '@/stores/guildStore'
import { useUIStore } from '@/stores/uiStore'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { Button } from '@/components/ui/Button'
import { LoadingCard } from '@/components/ui/Loading'
import { Save, Shield, Link, UserX } from 'lucide-react'
import type { GuildConfig } from '@/types'

export function BotConfigPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const { config, fetchConfig, updateConfig, isLoading, isSaving } = useGuildStore()
  const { addToast } = useUIStore()

  const [form, setForm] = useState({
    antiSpam: false,
    antiLink: false,
    antiInvite: false,
  })

  useEffect(() => {
    if (guildId) fetchConfig(guildId)
  }, [guildId])

  useEffect(() => {
    if (config) {
      setForm({
        antiSpam: config.antiSpam,
        antiLink: config.antiLink,
        antiInvite: config.antiInvite,
      })
    }
  }, [config])

  async function handleSave() {
    if (!guildId) return
    try {
      await updateConfig(guildId, form)
      addToast({ type: 'success', title: 'Settings saved!', message: 'Bot configuration updated.' })
    } catch {
      addToast({ type: 'error', title: 'Save failed', message: 'Could not update configuration.' })
    }
  }

  if (isLoading && !config) return <LoadingCard text="Loading bot configuration..." />

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bot Configuration</h1>
          <p className="text-muted-foreground mt-1">Manage auto-moderation and bot behavior</p>
        </div>
        <Button onClick={handleSave} isLoading={isSaving} leftIcon={<Save className="h-4 w-4" />}>
          Save Changes
        </Button>
      </div>

      {/* Auto-Moderation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Auto-Moderation
          </CardTitle>
          <CardDescription>
            Automatically moderate messages to keep your server clean
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={form.antiSpam}
            onChange={(v) => setForm((f) => ({ ...f, antiSpam: v }))}
            label="Anti-Spam"
            description="Mute users who send too many messages too quickly (5 messages in 5 seconds)"
          />
          <hr className="border-border" />
          <Toggle
            checked={form.antiLink}
            onChange={(v) => setForm((f) => ({ ...f, antiLink: v }))}
            label="Anti-Link"
            description="Delete messages containing links (use !whitelist to allow specific domains)"
          />
          <hr className="border-border" />
          <Toggle
            checked={form.antiInvite}
            onChange={(v) => setForm((f) => ({ ...f, antiInvite: v }))}
            label="Anti-Invite"
            description="Delete Discord server invite links automatically"
          />
        </CardContent>
      </Card>

      {/* Channel Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link className="h-5 w-5 text-blue-400" />
            Channel Management
          </CardTitle>
          <CardDescription>
            Control which channels CURSED responds in
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">📢 Channel Commands</p>
            <p>Use these commands in Discord to manage channels:</p>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              <li><code className="bg-muted px-1 rounded">!addchannel</code> — Allow CURSED in this channel</li>
              <li><code className="bg-muted px-1 rounded">!removechannel</code> — Remove CURSED from this channel</li>
              <li><code className="bg-muted px-1 rounded">!channels</code> — List active channels</li>
            </ul>
            {config?.allowedChannels?.length ? (
              <p className="mt-3 text-foreground">
                Currently active in <strong>{config.allowedChannels.length}</strong> channel(s)
              </p>
            ) : (
              <p className="mt-3 text-foreground">
                Currently responding in <strong>all channels</strong>
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Moderation Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserX className="h-5 w-5 text-orange-400" />
            Moderation Log
          </CardTitle>
          <CardDescription>
            Configure where moderation actions are logged
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <p>Run <code className="bg-muted px-1 rounded font-mono text-xs">!setmodlog</code> in the channel you want to use as your mod log.</p>
            {config?.modLogChannelId ? (
              <p className="mt-2 text-green-400">✅ Mod log is configured</p>
            ) : (
              <p className="mt-2 text-yellow-400">⚠️ No mod log channel set</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
