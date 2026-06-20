import type { Request } from 'express'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    username: string
    discriminator: string
    avatar: string | null
    token: string
  }
}

export interface SessionData {
  userId: string
  username: string
  discriminator: string
  avatar: string | null
  accessToken: string
  createdAt: number
}

export interface WebhookSecrets {
  WEBHOOK_KOFI_SECRET?: string
  WEBHOOK_PATREON_SECRET?: string
  WEBHOOK_BMC_SECRET?: string
}

export interface RateLimitConfig {
  windowMs: number
  max: number
}

export interface GuildConfigData {
  guildId: string
  prefix: string
  allowedChannels: string[]
  modLogChannelId: string | null
  premiumRoleId: string | null
  paymentLinks: Record<string, string>
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
