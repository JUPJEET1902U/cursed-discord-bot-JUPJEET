import { API_BASE, SESSION_KEY } from '@/utils/constants'
import type { APIResponse, GuildConfig, GuildStats } from '@/types'

class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem(SESSION_KEY)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string }
    throw new APIError(
      body.error || body.message || `HTTP ${res.status}`,
      res.status,
    )
  }

  const data = await res.json() as APIResponse<T>
  if (!data.success && data.error) {
    throw new APIError(data.error, res.status)
  }

  return data.data as T
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export const authAPI = {
  async login(code: string) {
    return request<{ token: string; user: unknown }>('/auth/discord', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  },

  async getMe() {
    return request<{ id: string; username: string; avatar: string | null }>('/auth/me')
  },

  async logout() {
    return request<void>('/auth/logout', { method: 'POST' })
  },
}

// ── Guilds ─────────────────────────────────────────────────────────────────────

export const guildsAPI = {
  async list() {
    return request<{ id: string; name: string; icon: string | null; botPresent: boolean }[]>('/guilds')
  },

  async get(guildId: string) {
    return request<GuildConfig>(`/guilds/${guildId}`)
  },

  async update(guildId: string, config: Partial<GuildConfig>) {
    return request<GuildConfig>(`/guilds/${guildId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    })
  },

  async getStats(guildId: string) {
    return request<GuildStats>(`/guilds/${guildId}/stats`)
  },
}

// ── Health ─────────────────────────────────────────────────────────────────────

export const healthAPI = {
  async check() {
    return request<{ status: string; bot: boolean; guilds: number; uptime: number }>('/health')
  },
}

export { APIError }
