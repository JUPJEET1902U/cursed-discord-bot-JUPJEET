import mongoose from 'mongoose'
import { createRequire } from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const rootFile = (relativePath: string) => path.resolve(process.cwd(), relativePath)
// Apply the same help catalogs as the bot process before collecting reserved names.
// This prevents dashboard-created custom commands from shadowing any deployed CURSED command.
for (const catalog of [
  'commands/helpCatalog.js',
  'commands/prefixCommandCatalog.js',
  'commands/imageGenerationCatalog.js',
  'commands/birthdayCatalog.js',
  'commands/customRoleCatalog.js',
]) {
  require(rootFile(catalog))
}
const { COMMAND_REGISTRY } = require(rootFile('utils/helpGenerator.js')) as {
  COMMAND_REGISTRY: Record<string, { commands?: Array<{ name?: string; aliases?: string[] }> }>
}

const DISCORD_API = 'https://discord.com/api/v10'
const BASE_SLOTS = [
  { name: 'staff', label: 'Staff' },
  { name: 'girl', label: 'Girl' },
  { name: 'vip', label: 'VIP' },
  { name: 'guest', label: 'Guest' },
  { name: 'friend', label: 'Friend' },
] as const
const MAX_CUSTOM_COMMANDS = 50
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9-]{1,23}$/
const ADMINISTRATOR = 1n << 3n
const MANAGE_ROLES = 1n << 28n

export interface CustomRoleCommandConfig {
  name: string
  roleId: string | null
  enabled: boolean
  base: boolean
}

export interface CustomRoleConfigData {
  guildId: string
  enabled: boolean
  requiredRoleId: string | null
  baseCommands: CustomRoleCommandConfig[]
  customCommands: CustomRoleCommandConfig[]
}

export interface CustomRoleCatalogItem {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
  dangerous: boolean
  assignable: boolean
  requiredEligible: boolean
  unavailableReason: string | null
}

export interface CustomRoleAuditItem {
  actorId: string
  targetId: string | null
  roleId: string | null
  commandName: string | null
  action: string
  success: boolean
  reason: string | null
  source: string
  createdAt: Date
}

class CustomRoleValidationError extends Error {
  code = 'VALIDATION_ERROR'
  constructor(public fieldErrors: Record<string, string>) {
    super('Custom role configuration is invalid')
  }
}

const commandSchema = new mongoose.Schema({
  name: { type: String, required: true, lowercase: true, trim: true },
  roleId: { type: String, default: null },
  enabled: { type: Boolean, default: true },
  base: { type: Boolean, default: false },
}, { _id: false })

const configSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  enabled: { type: Boolean, default: false },
  requiredRoleId: { type: String, default: null },
  baseCommands: { type: [commandSchema], default: [] },
  customCommands: { type: [commandSchema], default: [] },
  updatedBy: { type: String, default: null },
}, { collection: 'customRoleConfigs', timestamps: true, minimize: false })

const auditSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  actorId: { type: String, required: true },
  targetId: { type: String, default: null },
  roleId: { type: String, default: null },
  commandName: { type: String, default: null },
  action: { type: String, required: true },
  success: { type: Boolean, default: true },
  reason: { type: String, default: null },
  source: { type: String, default: 'dashboard' },
  createdAt: { type: Date, default: Date.now, index: true },
}, { collection: 'customRoleAudits', minimize: false })
auditSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

const CustomRoleConfig = mongoose.models.CustomRoleConfig
  || mongoose.model('CustomRoleConfig', configSchema)
const CustomRoleAudit = mongoose.models.CustomRoleAudit
  || mongoose.model('CustomRoleAudit', auditSchema)

let mongoPromise: Promise<typeof mongoose> | null = null

async function ensureMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) return
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI is not configured')
  if (!mongoPromise) {
    mongoPromise = mongoose.connect(uri).catch((error) => {
      mongoPromise = null
      throw error
    })
  }
  await mongoPromise
}

function normalizeId(value: unknown): string | null {
  const text = String(value || '').trim()
  return /^\d{17,20}$/.test(text) ? text : null
}

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/^[!/.]+/, '')
}

function normalizeConfig(guildId: string, raw: Partial<CustomRoleConfigData> = {}): CustomRoleConfigData {
  const incomingBase = Array.isArray(raw.baseCommands) ? raw.baseCommands : []
  const baseByName = new Map(incomingBase.map((entry) => [normalizeName(entry?.name), entry]))
  const baseCommands = BASE_SLOTS.map((slot) => {
    const entry = baseByName.get(slot.name)
    return {
      name: slot.name,
      roleId: normalizeId(entry?.roleId),
      enabled: entry?.enabled !== false,
      base: true,
    }
  })

  const baseNames = new Set<string>(BASE_SLOTS.map((slot) => slot.name))
  const seen = new Set<string>()
  const customCommands: CustomRoleCommandConfig[] = []
  for (const entry of Array.isArray(raw.customCommands) ? raw.customCommands : []) {
    const name = normalizeName(entry?.name)
    if (!name || baseNames.has(name) || seen.has(name)) continue
    seen.add(name)
    customCommands.push({
      name,
      roleId: normalizeId(entry?.roleId),
      enabled: entry?.enabled !== false,
      base: false,
    })
    if (customCommands.length >= MAX_CUSTOM_COMMANDS) break
  }

  return {
    guildId,
    enabled: raw.enabled === true,
    requiredRoleId: normalizeId(raw.requiredRoleId),
    baseCommands,
    customCommands,
  }
}

function reservedCommandNames(): Set<string> {
  const names = new Set(['reqrole', 'rolecmd', 'rolecommands'])
  for (const category of Object.values(COMMAND_REGISTRY || {})) {
    for (const command of category.commands || []) {
      for (const rawName of [command.name, ...(command.aliases || [])]) {
        const name = normalizeName(rawName)
        if (name) names.add(name)
      }
    }
  }
  return names
}

function hasDangerousPermissions(value: string): boolean {
  let permissions = 0n
  try { permissions = BigInt(value || '0') } catch { /* ignore */ }
  return (permissions & ADMINISTRATOR) !== 0n || (permissions & MANAGE_ROLES) !== 0n
}

type DiscordRole = {
  id: string
  name: string
  color: number
  position: number
  permissions: string
  managed: boolean
}

type DiscordMember = { roles: string[] }

async function discordFetch<T>(route: string): Promise<T> {
  const token = process.env.BOT_TOKEN
  if (!token) throw new Error('BOT_TOKEN is not configured')
  const response = await fetch(`${DISCORD_API}${route}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Discord API returned HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function getCustomRoleCatalog(guildId: string): Promise<CustomRoleCatalogItem[]> {
  const botId = process.env.BOT_CLIENT_ID || process.env.DISCORD_CLIENT_ID
  if (!botId) throw new Error('BOT_CLIENT_ID is not configured')
  const [roles, botMember] = await Promise.all([
    discordFetch<DiscordRole[]>(`/guilds/${guildId}/roles`),
    discordFetch<DiscordMember>(`/guilds/${guildId}/members/${botId}`),
  ])
  const byId = new Map(roles.map((role) => [role.id, role]))
  const botRoleIds = new Set([guildId, ...(botMember.roles || [])])
  const botRoles = roles.filter((role) => botRoleIds.has(role.id))
  const botHighestPosition = botRoles.reduce((max, role) => Math.max(max, role.position), 0)
  const botPermissions = botRoles.reduce((bits, role) => bits | BigInt(role.permissions || '0'), 0n)
  const botCanManageRoles = (botPermissions & ADMINISTRATOR) !== 0n || (botPermissions & MANAGE_ROLES) !== 0n

  return [...byId.values()]
    .sort((a, b) => b.position - a.position)
    .map((role) => {
      const everyone = role.id === guildId
      const dangerous = hasDangerousPermissions(role.permissions)
      let unavailableReason: string | null = null
      if (everyone) unavailableReason = 'The @everyone role cannot be assigned.'
      else if (role.managed) unavailableReason = 'This role is managed by Discord or an integration.'
      else if (!botCanManageRoles) unavailableReason = 'CURSED needs the Manage Roles permission.'
      else if (role.position >= botHighestPosition) unavailableReason = 'Move the CURSED role above this role in Discord.'
      else if (dangerous) unavailableReason = 'Administrator and Manage Roles roles are blocked.'

      return {
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
        dangerous,
        assignable: unavailableReason === null,
        requiredEligible: !everyone && !role.managed,
        unavailableReason,
      }
    })
}

function validateConfig(config: CustomRoleConfigData, roles: CustomRoleCatalogItem[]): void {
  const errors: Record<string, string> = {}
  const roleById = new Map(roles.map((role) => [role.id, role]))
  const reserved = reservedCommandNames()

  if (config.requiredRoleId) {
    const role = roleById.get(config.requiredRoleId)
    if (!role || !role.requiredEligible) errors.requiredRoleId = 'Choose a valid, non-managed server role.'
  }
  if (config.enabled && !config.requiredRoleId) errors.requiredRoleId = 'Choose a required role before enabling the feature.'
  if (config.customCommands.length > MAX_CUSTOM_COMMANDS) errors.customCommands = `Use no more than ${MAX_CUSTOM_COMMANDS} custom commands.`

  const all = [...config.baseCommands, ...config.customCommands]
  const seen = new Set<string>()
  for (const entry of all) {
    if (!COMMAND_NAME_PATTERN.test(entry.name)) {
      errors[`commands.${entry.name || 'unknown'}.name`] = 'Use 2-24 lowercase letters, numbers, or hyphens.'
    } else if (reserved.has(entry.name)) {
      errors[`commands.${entry.name}.name`] = 'That name conflicts with an existing CURSED command.'
    } else if (seen.has(entry.name)) {
      errors[`commands.${entry.name}.name`] = 'Command names must be unique.'
    }
    seen.add(entry.name)

    if (entry.roleId) {
      const role = roleById.get(entry.roleId)
      if (!role || !role.assignable || role.dangerous) {
        errors[`commands.${entry.name}.roleId`] = role?.unavailableReason || 'Choose a role CURSED can safely assign.'
      }
    }
  }

  if (Object.keys(errors).length) throw new CustomRoleValidationError(errors)
}

export async function getCustomRoleDashboard(guildId: string) {
  await ensureMongo()
  const [doc, roles, audits] = await Promise.all([
    CustomRoleConfig.findOne({ guildId }).lean(),
    getCustomRoleCatalog(guildId),
    CustomRoleAudit.find({ guildId }).sort({ createdAt: -1 }).limit(20).lean(),
  ])
  return {
    config: normalizeConfig(guildId, (doc || {}) as Partial<CustomRoleConfigData>),
    roles,
    audits: audits as unknown as CustomRoleAuditItem[],
    baseSlots: BASE_SLOTS,
    limits: { customCommands: MAX_CUSTOM_COMMANDS },
  }
}

export async function saveCustomRoleDashboard(
  guildId: string,
  rawConfig: Partial<CustomRoleConfigData>,
  actorId: string,
) {
  await ensureMongo()
  const roles = await getCustomRoleCatalog(guildId)
  const config = normalizeConfig(guildId, rawConfig)
  validateConfig(config, roles)

  const doc = await CustomRoleConfig.findOneAndUpdate(
    { guildId },
    {
      $set: {
        enabled: config.enabled,
        requiredRoleId: config.requiredRoleId,
        baseCommands: config.baseCommands,
        customCommands: config.customCommands,
        updatedBy: actorId,
      },
      $setOnInsert: { guildId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()

  await CustomRoleAudit.create({
    guildId,
    actorId,
    action: 'configure',
    success: true,
    reason: 'Dashboard custom role settings updated',
    source: 'dashboard',
  })

  return {
    config: normalizeConfig(guildId, doc as Partial<CustomRoleConfigData>),
    roles,
  }
}

export { CustomRoleValidationError, BASE_SLOTS, MAX_CUSTOM_COMMANDS }
