export interface CustomRoleCommandConfig {
  name: string
  roleId: string | null
  enabled: boolean
  base: boolean
}

export interface CustomRoleConfig {
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
  action: 'add' | 'remove' | 'configure' | 'deny'
  success: boolean
  reason: string | null
  source: 'discord' | 'dashboard'
  createdAt: string
}

export interface CustomRoleDashboardData {
  config: CustomRoleConfig
  roles: CustomRoleCatalogItem[]
  audits: CustomRoleAuditItem[]
  baseSlots: Array<{ name: string; label: string }>
  limits: { customCommands: number }
}
