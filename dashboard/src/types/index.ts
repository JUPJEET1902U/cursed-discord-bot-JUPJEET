// ── User Types ─────────────────────────────────────────────────────────────────

export interface DiscordUser {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  email?: string
  guilds?: DiscordGuild[]
}

export interface AuthState {
  user: DiscordUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

// ── Guild Types ────────────────────────────────────────────────────────────────

export interface DiscordGuild {
  id: string
  name: string
  icon: string | null
  owner: boolean
  permissions: string
  features: string[]
  memberCount?: number
  botPresent?: boolean
}

export interface GuildConfig {
  guildId: string
  prefix: string
  allowedChannels: string[]
  modLogChannelId: string | null
  premiumRoleId: string | null
  paymentLinks: {
    kofi?: string
    patreon?: string
    bmc?: string
  }
  antiSpam: boolean
  antiLink: boolean
  antiInvite: boolean
  linkWhitelist: string[]
  welcomeEnabled: boolean
  welcomeChannelId: string | null
  welcomeMessage: string
  goodbyeEnabled: boolean
  goodbyeChannelId: string | null
  goodbyeMessage: string
  aiEnabled: boolean
  aiChannelId: string | null
  aiPersonality: string
  aiMaxTokens: number
  aiMemoryEnabled: boolean
}

export interface GuildStats {
  guildId: string
  memberCount: number
  totalMessages: number
  totalCommands: number
  totalCoins: number
  totalXP: number
  totalAchievements: number
  activeUsers: number
  topUsers: TopUser[]
  commandUsage: CommandUsage[]
  dailyActivity: DailyActivity[]
}

export interface TopUser {
  userId: string
  username: string
  coins: number
  xp: number
  level: number
}

export interface CommandUsage {
  command: string
  count: number
}

export interface DailyActivity {
  date: string
  messages: number
  commands: number
}

// ── API Types ──────────────────────────────────────────────────────────────────

export interface APIResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ── UI Types ───────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
}

export interface NavItem {
  label: string
  href: string
  icon: string
  badge?: string | number
}

// ── Config Form Types ──────────────────────────────────────────────────────────

export interface BotConfigForm {
  prefix: string
  aiEnabled: boolean
  aiPersonality: string
  aiMaxTokens: number
  aiMemoryEnabled: boolean
  antiSpam: boolean
  antiLink: boolean
  antiInvite: boolean
}

export interface WelcomeConfigForm {
  welcomeEnabled: boolean
  welcomeChannelId: string
  welcomeMessage: string
  goodbyeEnabled: boolean
  goodbyeChannelId: string
  goodbyeMessage: string
}
