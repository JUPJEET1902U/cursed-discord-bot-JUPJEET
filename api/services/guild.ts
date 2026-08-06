import fs from 'fs'
import path from 'path'
import { createRequire } from 'node:module'
import type { GuildConfigData } from '../types/index.js'

const nodeRequire = createRequire(import.meta.url)
const guildConfigStore = nodeRequire(path.resolve(process.cwd(), 'utils', 'serverConfig.js')) as {
  getServerConfig: (guildId: string) => { config: Record<string, unknown> }
  updateGuildConfigAndWait: (
    guildId: string,
    updates: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
}

const ECONOMY_FILE = path.resolve(process.cwd(), 'economy.json')

function loadEconomy(): Record<string, { coins?: number; xp?: number; level?: number; name?: string; achievements?: string[] }> {
  try {
    if (fs.existsSync(ECONOMY_FILE)) {
      return JSON.parse(fs.readFileSync(ECONOMY_FILE, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

const DEFAULT_CONFIG: GuildConfigData = {
  guildId: '',
  prefix: '!',
  allowedChannels: [],
  modLogChannelId: null,
  premiumRoleId: null,
  paymentLinks: {},
  antiSpam: false,
  antiLink: false,
  antiInvite: false,
  linkWhitelist: [],
  welcomeEnabled: false,
  welcomeChannelId: null,
  welcomeMessage: '👋 Welcome to the server, {user}!',
  goodbyeEnabled: false,
  goodbyeChannelId: null,
  goodbyeMessage: '👋 {user} has left the server.',
  aiEnabled: true,
  aiChannelId: null,
  aiPersonality: 'cursed',
  aiMaxTokens: 500,
  aiMemoryEnabled: true,
}

/**
 * Get the configuration for a guild.
 */
export async function getGuildConfig(guildId: string): Promise<GuildConfigData> {
  const existing = guildConfigStore.getServerConfig(guildId).config as Partial<GuildConfigData>
  return { ...DEFAULT_CONFIG, ...existing, guildId }
}

/**
 * Update the configuration for a guild.
 */
export async function updateGuildConfig(
  guildId: string,
  updates: Partial<GuildConfigData>,
): Promise<GuildConfigData> {
  // Preserve the existing dashboard/API allow-list exactly.
  const allowedFields: (keyof GuildConfigData)[] = [
    'antiSpam', 'antiLink', 'antiInvite', 'linkWhitelist',
    'welcomeEnabled', 'welcomeChannelId', 'welcomeMessage',
    'goodbyeEnabled', 'goodbyeChannelId', 'goodbyeMessage',
    'aiEnabled', 'aiPersonality', 'aiMaxTokens', 'aiMemoryEnabled',
    'aiChannelId',
  ]

  const safeUpdates: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (field in updates) safeUpdates[field] = updates[field]
  }

  const stored = await guildConfigStore.updateGuildConfigAndWait(guildId, safeUpdates)
  return { ...DEFAULT_CONFIG, ...(stored as Partial<GuildConfigData>), guildId }
}

/**
 * Get statistics for a guild.
 */
export async function getGuildStats(guildId: string) {
  const economy = loadEconomy()
  const users = Object.values(economy)

  const totalCoins = users.reduce((s, u) => s + (u.coins || 0), 0)
  const totalXP = users.reduce((s, u) => s + (u.xp || 0), 0)
  const totalAchievements = users.reduce((s, u) => s + (u.achievements?.length || 0), 0)

  const topUsers = users
    .sort((a, b) => (b.xp || 0) - (a.xp || 0))
    .slice(0, 10)
    .map((u, i) => ({
      userId: String(i),
      username: u.name || 'Unknown',
      coins: u.coins || 0,
      xp: u.xp || 0,
      level: u.level || 0,
    }))

  return {
    guildId,
    memberCount: users.length,
    totalMessages: 0,
    totalCommands: 0,
    totalCoins,
    totalXP,
    totalAchievements,
    activeUsers: users.filter((u) => (u.xp || 0) > 0).length,
    topUsers,
    commandUsage: [],
    dailyActivity: [],
  }
}
