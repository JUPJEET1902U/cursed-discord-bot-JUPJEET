import { useEffect } from 'react'
import { useGuildStore } from '@/stores/guildStore'

export function useGuild(guildId?: string) {
  const store = useGuildStore()

  useEffect(() => {
    if (guildId && guildId !== store.selectedGuildId) {
      store.selectGuild(guildId)
    }
  }, [guildId])

  useEffect(() => {
    const id = guildId || store.selectedGuildId
    if (id && !store.config) {
      store.fetchConfig(id)
    }
  }, [guildId, store.selectedGuildId])

  return store
}

export function useGuildStats(guildId: string) {
  const { stats, fetchStats, isLoading } = useGuildStore()

  useEffect(() => {
    if (guildId) {
      fetchStats(guildId)
    }
  }, [guildId])

  return { stats, isLoading }
}
