import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DiscordUser } from '@/types'
import { SESSION_KEY } from '@/utils/constants'
import { authAPI } from '@/services/api'

interface AuthStore {
  user: DiscordUser | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (code: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
  setToken: (token: string) => void
  clearError: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (code: string) => {
        set({ isLoading: true, error: null })
        try {
          const { token, user } = await authAPI.login(code)
          localStorage.setItem(SESSION_KEY, token)
          set({
            token,
            user: user as DiscordUser,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Login failed',
            isLoading: false,
          })
          throw err
        }
      },

      logout: async () => {
        set({ isLoading: true })
        try {
          await authAPI.logout()
        } catch { /* ignore */ }
        localStorage.removeItem(SESSION_KEY)
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        })
      },

      fetchMe: async () => {
        const { token } = get()
        if (!token) return

        set({ isLoading: true })
        try {
          const user = await authAPI.getMe()
          set({ user: user as DiscordUser, isAuthenticated: true, isLoading: false })
        } catch {
          localStorage.removeItem(SESSION_KEY)
          set({ user: null, token: null, isAuthenticated: false, isLoading: false })
        }
      },

      setToken: (token: string) => {
        localStorage.setItem(SESSION_KEY, token)
        set({ token })
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'cursed-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
)
