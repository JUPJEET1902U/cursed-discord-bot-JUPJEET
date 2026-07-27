import { API_BASE, SESSION_KEY } from '@/utils/constants'
import type { APIResponse, GuildConfig, GuildStats } from '@/types'
import type { CustomRoleConfig, CustomRoleDashboardData } from '@/types/customRoles'

class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

const REQUEST_TIMEOUT_MS = 15_000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(SESSION_KEY)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new APIError('Request timed out — the server took too long to respond', 408)
    }
    throw new APIError(err instanceof Error ? err.message : 'Network error — could not reach the server', 0)
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as {
      error?: string
      message?: string
      code?: string
      fieldErrors?: Record<string, string>
    }
    throw new APIError(
      body.error || body.message || `HTTP ${res.status}`,
      res.status,
      body.code,
      body.fieldErrors,
    )
  }

  const data = await res.json() as APIResponse<T>
  if (!data.success && data.error) throw new APIError(data.error, res.status)
  return data.data as T
}

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

export const customRolesAPI = {
  async get(guildId: string) {
    return request<CustomRoleDashboardData>(`/guilds/${guildId}/custom-roles`)
  },
  async update(guildId: string, config: CustomRoleConfig) {
    return request<Pick<CustomRoleDashboardData, 'config' | 'roles'>>(`/guilds/${guildId}/custom-roles`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    })
  },
}

export const healthAPI = {
  async check() {
    return request<{ status: string; bot: boolean; guilds: number; uptime: number }>('/health')
  },
}

export { APIError }
