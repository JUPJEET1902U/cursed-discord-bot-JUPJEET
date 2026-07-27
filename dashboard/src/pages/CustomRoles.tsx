import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { customRolesAPI, APIError } from '@/services/api'
import { useUIStore } from '@/stores/uiStore'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { LoadingCard } from '@/components/ui/Loading'
import {
  BadgePlus,
  History,
  KeyRound,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UsersRound,
} from 'lucide-react'
import type {
  CustomRoleCommandConfig,
  CustomRoleConfig,
  CustomRoleDashboardData,
} from '@/types/customRoles'

function cloneConfig(config: CustomRoleConfig): CustomRoleConfig {
  return JSON.parse(JSON.stringify(config)) as CustomRoleConfig
}

export function CustomRolesPage() {
  const { guildId } = useParams<{ guildId: string }>()
  const { addToast } = useUIStore()
  const [data, setData] = useState<CustomRoleDashboardData | null>(null)
  const [form, setForm] = useState<CustomRoleConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!guildId) return
    let active = true
    setIsLoading(true)
    customRolesAPI.get(guildId)
      .then((result) => {
        if (!active) return
        setData(result)
        setForm(cloneConfig(result.config))
      })
      .catch((error) => {
        if (!active) return
        addToast({ type: 'error', title: 'Could not load custom roles', message: error instanceof Error ? error.message : undefined })
      })
      .finally(() => active && setIsLoading(false))
    return () => { active = false }
  }, [guildId])

  const assignableRoleOptions = useMemo(() => [
    { value: '', label: 'No role selected' },
    ...(data?.roles || [])
      .filter((role) => role.assignable)
      .map((role) => ({ value: role.id, label: role.name })),
  ], [data])

  const requiredRoleOptions = useMemo(() => [
    { value: '', label: 'No required role' },
    ...(data?.roles || [])
      .filter((role) => role.requiredEligible)
      .map((role) => ({ value: role.id, label: role.name })),
  ], [data])

  function updateBase(name: string, patch: Partial<CustomRoleCommandConfig>) {
    setForm((current) => current ? {
      ...current,
      baseCommands: current.baseCommands.map((entry) => entry.name === name ? { ...entry, ...patch } : entry),
    } : current)
  }

  function updateCustom(index: number, patch: Partial<CustomRoleCommandConfig>) {
    setForm((current) => current ? {
      ...current,
      customCommands: current.customCommands.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry),
    } : current)
  }

  function addCustomCommand() {
    if (!form || !data) return
    if (form.customCommands.length >= data.limits.customCommands) {
      addToast({ type: 'error', title: 'Command limit reached', message: `Use no more than ${data.limits.customCommands} custom commands.` })
      return
    }
    const nextNumber = form.customCommands.length + 1
    setForm({
      ...form,
      customCommands: [
        ...form.customCommands,
        { name: `custom${nextNumber}`, roleId: null, enabled: true, base: false },
      ],
    })
  }

  async function handleSave() {
    if (!guildId || !form) return
    setIsSaving(true)
    setFieldErrors({})
    try {
      const saved = await customRolesAPI.update(guildId, form)
      setData((current) => current ? { ...current, ...saved } : current)
      setForm(cloneConfig(saved.config))
      addToast({ type: 'success', title: 'Custom roles saved', message: 'Role commands and req.role are now updated.' })
    } catch (error) {
      if (error instanceof APIError && error.fieldErrors) setFieldErrors(error.fieldErrors)
      addToast({ type: 'error', title: 'Save failed', message: error instanceof Error ? error.message : 'Could not save custom roles.' })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading || !data || !form) return <LoadingCard text="Loading custom role commands..." />

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Custom Role Commands</h1>
          <p className="text-muted-foreground mt-1">Let trusted members add or remove approved roles with short commands.</p>
        </div>
        <Button onClick={handleSave} isLoading={isSaving} leftIcon={<Save className="h-4 w-4" />}>
          Save Changes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Feature Access
          </CardTitle>
          <CardDescription>
            Only the server owner, administrators, or members with req.role can run configured role commands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Toggle
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
            label="Enable Custom Role Commands"
            description="Built-in CURSED commands always keep priority over custom mappings."
          />
          <Select
            label="Required Role (req.role)"
            value={form.requiredRoleId || ''}
            onChange={(value) => setForm({ ...form, requiredRoleId: value || null })}
            options={requiredRoleOptions}
            error={fieldErrors.requiredRoleId}
            hint="Members must have this role to assign or remove configured roles. Owner/admin bypass remains available for recovery."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersRound className="h-5 w-5 text-pink-400" />
            Base Role Slots
          </CardTitle>
          <CardDescription>Quick mappings matching the Staff, Girl, VIP, Guest, and Friend layout.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {data.baseSlots.map((slot) => {
              const entry = form.baseCommands.find((item) => item.name === slot.name)!
              const selectedRole = data.roles.find((role) => role.id === entry.roleId)
              return (
                <div key={slot.name} className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{slot.label}</p>
                      <code className="text-xs text-muted-foreground">!{entry.name} @member</code>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Reset ${slot.label}`}
                      onClick={() => updateBase(slot.name, { roleId: null })}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </div>
                  <Select
                    value={entry.roleId || ''}
                    onChange={(value) => updateBase(slot.name, { roleId: value || null })}
                    options={assignableRoleOptions}
                    error={fieldErrors[`commands.${entry.name}.roleId`]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {selectedRole ? `Assigned role: ${selectedRole.name}` : 'No role mapped yet.'}
                  </p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BadgePlus className="h-5 w-5 text-blue-400" />
                Additional Commands
              </CardTitle>
              <CardDescription>Create up to {data.limits.customCommands} extra role shortcuts.</CardDescription>
            </div>
            <Button variant="outline" onClick={addCustomCommand} leftIcon={<Plus className="h-4 w-4" />}>
              Add Command
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.customCommands.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No additional commands. Base slots can be used without creating custom entries.
            </div>
          ) : form.customCommands.map((entry, index) => (
            <div key={`${entry.name}-${index}`} className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
              <Input
                label="Command name"
                value={entry.name}
                onChange={(event) => updateCustom(index, { name: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                error={fieldErrors[`commands.${entry.name}.name`]}
                hint={`Preview: !${entry.name || 'command'} @member`}
                maxLength={24}
              />
              <Select
                label="Role"
                value={entry.roleId || ''}
                onChange={(value) => updateCustom(index, { roleId: value || null })}
                options={assignableRoleOptions}
                error={fieldErrors[`commands.${entry.name}.roleId`]}
              />
              <div className="pb-1">
                <Toggle
                  checked={entry.enabled}
                  onChange={(enabled) => updateCustom(index, { enabled })}
                  label="Enabled"
                  description="Allow this mapping"
                />
              </div>
              <Button
                variant="destructive"
                size="icon"
                aria-label={`Remove ${entry.name}`}
                onClick={() => setForm({
                  ...form,
                  customCommands: form.customCommands.filter((_, entryIndex) => entryIndex !== index),
                })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-yellow-400" />
            Discord Recovery Commands
          </CardTitle>
          <CardDescription>Server owners and administrators can recover settings even if the dashboard is unavailable.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm font-mono text-muted-foreground sm:grid-cols-2">
            <code>!reqrole set @role</code>
            <code>!reqrole clear</code>
            <code>!rolecmd add staff @role</code>
            <code>!rolecmd remove staff</code>
            <code>!rolecmd enable</code>
            <code>!rolecommands</code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-purple-400" />
            Recent Activity
          </CardTitle>
          <CardDescription>Recent configuration and role changes are retained for up to 90 days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.audits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom role activity yet.</p>
          ) : data.audits.slice(0, 10).map((audit, index) => (
            <div key={`${audit.createdAt}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2 text-sm">
              <span>
                <strong className="capitalize">{audit.action}</strong>
                {audit.commandName ? ` via !${audit.commandName}` : ' settings'}
                {!audit.success ? ' — denied/failed' : ''}
              </span>
              <time className="text-xs text-muted-foreground">{new Date(audit.createdAt).toLocaleString()}</time>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
