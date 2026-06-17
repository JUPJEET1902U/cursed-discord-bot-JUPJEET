import fs from 'fs'
import path from 'path'
import type { GuildConfigData } from '../types/index.js'

const CONFIG_FILE = path.resolve(process.cwd(), 'serverConfig.json')
const ECONOMY_FILE = path.resolve(process.cwd(), 'economy.json')

function loadServerConfig(): Record<string, Partial<GuildConfigData>> {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch { /* ignore */ }
  return {}
}

function saveServerConfig(data: Record<string, Partial<GuildConfigData>>): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2))
}

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
  const data = loadServerConfig()
  const existing = data[guildId] || {}
  return { ...DEFAULT_CONFIG, ...existing, guildId }
}

/**
 * Update the configuration for a guild.
 */
export async function updateGuildConfig(
  guildId: string,
  updates: Partial<GuildConfigData>,
): Promise<GuildConfigData> {
  const data = loadServerConfig()
  if (!data[guildId]) data[guildId] = {}

  // Merge updates (only allow safe fields)
  const allowedFields: (keyof GuildConfigData)[] = [
    'antiSpam', 'antiLink', 'antiInvite', 'linkWhitelist',
    'welcomeEnabled', 'welcomeChannelId', 'welcomeMessage',
    'goodbyeEnabled', 'goodbyeChannelId', 'goodbyeMessage',
    'aiEnabled', 'aiPersonality', 'aiMaxTokens', 'aiMemoryEnabled',
    'aiChannelId',
  ]

  for (const field of allowedFields) {
    if (field in updates) {
      (data[guildId] as Record<string, unknown>)[field] = updates[field]
    }
  }

  saveServerConfig(data)
  return { ...DEFAULT_CONFIG, ...data[guildId], guildId }
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
