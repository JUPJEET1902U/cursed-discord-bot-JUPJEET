import { create } from 'zustand'
import type { DiscordGuild, GuildConfig, GuildStats } from '@/types'
import { guildsAPI } from '@/services/api'
import { GUILD_KEY } from '@/utils/constants'

interface GuildStore {
  guilds: DiscordGuild[]
  selectedGuildId: string | null
  config: GuildConfig | null
  stats: GuildStats | null
  isLoading: boolean
  isSaving: boolean
  error: string | null

  fetchGuilds: () => Promise<void>
  selectGuild: (guildId: string) => void
  fetchConfig: (guildId: string) => Promise<void>
  updateConfig: (guildId: string, config: Partial<GuildConfig>) => Promise<void>
  fetchStats: (guildId: string) => Promise<void>
  clearError: () => void
}

export const useGuildStore = create<GuildStore>((set, get) => ({
  guilds: [],
  selectedGuildId: localStorage.getItem(GUILD_KEY),
  config: null,
  stats: null,
  isLoading: false,
  isSaving: false,
  error: null,

  fetchGuilds: async () => {
    set({ isLoading: true, error: null })
    try {
      const guilds = await guildsAPI.list()
      set({ guilds: guilds as DiscordGuild[], isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch guilds',
        isLoading: false,
      })
    }
  },

  selectGuild: (guildId: string) => {
    localStorage.setItem(GUILD_KEY, guildId)
    set({ selectedGuildId: guildId, config: null, stats: null })
  },

  fetchConfig: async (guildId: string) => {
    set({ isLoading: true, error: null })
    try {
      const config = await guildsAPI.get(guildId)
      set({ config, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch config',
        isLoading: false,
      })
    }
  },

  updateConfig: async (guildId: string, updates: Partial<GuildConfig>) => {
    set({ isSaving: true, error: null })
    try {
      const config = await guildsAPI.update(guildId, updates)
      set({ config, isSaving: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to save config',
        isSaving: false,
      })
      throw err
    }
  },

  fetchStats: async (guildId: string) => {
    set({ isLoading: true, error: null })
    try {
      const stats = await guildsAPI.getStats(guildId)
      set({ stats, isLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch stats',
        isLoading: false,
      })
    }
  },

  clearError: () => set({ error: null }),
}))
