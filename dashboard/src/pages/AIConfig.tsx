import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useGuildStore } from '@/stores/guildStore'
import { useUIStore } from '@/stores/uiStore'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Toggle } from '@/components/ui/Toggle'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { LoadingCard } from '@/components/ui/Loading'
import { PERSONALITIES, TOKEN_OPTIONS } from '@/utils/constants'
import { Save, Sparkles, Brain, Sliders } from 'lucide-react'

export function AIConfigPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const { config, fetchConfig, updateConfig, isLoading, isSaving } = useGuildStore()
  const { addToast } = useUIStore()

  const [form, setForm] = useState({
    aiEnabled: true,
    aiPersonality: 'cursed',
    aiMaxTokens: 500,
    aiMemoryEnabled: true,
  })

  useEffect(() => {
    if (guildId) fetchConfig(guildId)
  }, [guildId])

  useEffect(() => {
    if (config) {
      setForm({
        aiEnabled: config.aiEnabled ?? true,
        aiPersonality: config.aiPersonality || 'cursed',
        aiMaxTokens: config.aiMaxTokens || 500,
        aiMemoryEnabled: config.aiMemoryEnabled ?? true,
      })
    }
  }, [config])

  async function handleSave() {
    if (!guildId) return
    try {
      await updateConfig(guildId, form)
      addToast({ type: 'success', title: 'AI settings saved!' })
    } catch {
      addToast({ type: 'error', title: 'Save failed' })
    }
  }

  const selectedPersonality = PERSONALITIES.find((p) => p.value === form.aiPersonality)

  if (isLoading && !config) return <LoadingCard text="Loading AI configuration..." />

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Configuration</h1>
          <p className="text-muted-foreground mt-1">Configure CURSED's AI behavior and personality</p>
        </div>
        <Button onClick={handleSave} isLoading={isSaving} leftIcon={<Save className="h-4 w-4" />}>
          Save Changes
        </Button>
      </div>

      {/* AI Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Responses
          </CardTitle>
          <CardDescription>
            Control whether CURSED responds to messages with AI
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Toggle
            checked={form.aiEnabled}
            onChange={(v) => setForm((f) => ({ ...f, aiEnabled: v }))}
            label="Enable AI Responses"
            description="When enabled, CURSED will respond to messages in allowed channels using AI"
          />
        </CardContent>
      </Card>

      {/* Personality */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-400" />
            Personality Mode
          </CardTitle>
          <CardDescription>
            Choose how CURSED talks to your server members
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Default Personality"
            value={form.aiPersonality}
            onChange={(v) => setForm((f) => ({ ...f, aiPersonality: v }))}
            options={PERSONALITIES.map((p) => ({ value: p.value, label: p.label }))}
          />
          {selectedPersonality && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <strong className="text-foreground">{selectedPersonality.label}</strong>
              <p className="mt-0.5">{selectedPersonality.description}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            💡 Users can override this with <code className="bg-muted px-1 rounded">!setpersonality</code> for their own conversations
          </p>
        </CardContent>
      </Card>

      {/* Response Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-blue-400" />
            Response Settings
          </CardTitle>
          <CardDescription>
            Fine-tune AI response length and memory
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Maximum Response Length"
            value={String(form.aiMaxTokens)}
            onChange={(v) => setForm((f) => ({ ...f, aiMaxTokens: parseInt(v) }))}
            options={TOKEN_OPTIONS.map((t) => ({ value: String(t.value), label: t.label }))}
            hint="Longer responses use more AI tokens and may be slower"
          />
          <hr className="border-border" />
          <Toggle
            checked={form.aiMemoryEnabled}
            onChange={(v) => setForm((f) => ({ ...f, aiMemoryEnabled: v }))}
            label="Conversation Memory"
            description="CURSED remembers recent messages for context-aware responses"
          />
        </CardContent>
      </Card>

      {/* Safety info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">🛡️ Safety Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>✅ All AI responses are sanitized to prevent @everyone and @here mentions</p>
            <p>✅ Prompt injection attempts are automatically detected and blocked</p>
            <p>✅ Responses are truncated to Discord's 2000 character limit</p>
            <p>✅ Rate limiting prevents AI abuse (8 messages per minute per user)</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
