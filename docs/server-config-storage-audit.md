# CURSED server configuration storage audit

## Scope

This audit covers persistent and runtime stores keyed by Discord guild/server ID. The migration is intentionally limited to settings that were still written directly to `serverConfig.json`.

It does not change command behavior, defaults, permission checks, welcome behavior, dashboard response shapes, moderation logic, ticket behavior, or user-facing messages.

## Core guild configuration

| Store | Storage type | Contents | Result |
|---|---|---|---|
| `serverConfig.json` | Legacy JSON | Allowed channels, command controls, AI settings, prefix, welcome, autorole, moderation, security, ticket settings, premium role and payment links | Read-only legacy import source. Production callers no longer update it. |
| `mongoCache` in `utils/GuildConfigStore.js` | In-memory cache | Synchronous copy of guild configuration used by existing command handlers | Retained so command APIs remain synchronous and unchanged. |
| `guildConfigs` | MongoDB collection | Source of truth for the core guild configuration document | Retained as the canonical store. Legacy JSON is inserted only when no MongoDB document exists. |
| `api/services/guild.ts` | Previously direct JSON access | Dashboard/API reads and writes for the older TypeScript guild routes | Migrated to the shared `utils/serverConfig.js` facade and MongoDB write path. |

### Core configuration consumers

The following systems already read the shared guild configuration facade and therefore require no command-level migration:

- channel allow-list and channel restriction controls
- configurable prefix
- dashboard command/module controls
- AI enablement, personality, memory and token controls
- welcome and welcome-card configuration
- autorole configuration
- moderation and AutoMod configuration
- advanced moderation, whitelist and logging configuration
- security/anti-raid/anti-nuke configuration
- ticket base configuration
- moderation log channel
- premium role and server payment links

## Dedicated MongoDB configuration stores

These settings are already MongoDB-native and are intentionally not folded into the core guild document. Moving them would be an architecture change rather than a JSON migration.

| System | MongoDB collection | Runtime cache | Reason retained separately |
|---|---|---|---|
| Server leveling | `levelingConfigs` | `configCache` in `utils/leveling.js` | Coupled to `levelingMembers` and asynchronous ranking writes. |
| Custom role commands | `customRoleConfigs` | `configCache` in `utils/customRoles.js` | Coupled to custom-role audits and command validation. |
| Ticket panels | `ticketPanels` | No JSON settings source | Panel/category/question documents are independent content records. Base ticket settings remain in `guildConfigs`. |
| Birthday configuration | `birthdayGuildConfigs` | `fallback.configs` in `utils/birthdays.js` | Already MongoDB-first. Its fallback file also contains birthday entries and delivery idempotency records, so it is not a core guild-config JSON source. |

## Per-server state that is not configuration

The following stores were identified during the audit but are excluded because they contain entitlement, history, counters, incidents or live operational state rather than server settings:

- `premiumGuildAccounts` with `guildCache` and `serverPremiumData.json`: server Premium entitlement/account state
- `tickets` and `ticketCounters`: ticket records and numbering
- moderation cases, warning records and scheduled moderation tasks
- channel-lock, lockdown and quarantine state
- security incidents, recovery snapshots, bot approvals and incident-mode records
- activity and leveling member statistics
- birthday entries and DM delivery records

These systems remain unchanged.

## Runtime-only maps

Cooldown maps, anti-spam message windows, duplicate-message detection, short-lived locks and similar maps are runtime controls rather than persisted server configuration. They were audited but are outside this migration.

## Migration guarantees

1. `serverConfig.json` remains in the repository as a legacy backup/import source.
2. Legacy guilds are inserted with MongoDB `$setOnInsert`, so stale JSON cannot overwrite an existing `guildConfigs` document.
3. Bot commands continue using `getServerConfig` and `saveConfig` without API changes.
4. The TypeScript guild API keeps the same defaults, update allow-list and response shape.
5. Dashboard frontend files and command handlers are not modified.
6. Existing dedicated MongoDB configuration and operational collections remain separate.

## Deployment verification

After deployment:

1. Confirm MongoDB connects successfully.
2. Confirm existing allowed channels, welcome, autorole, prefix and command controls still work.
3. Change one dashboard/API setting and one Discord command setting.
4. Restart Railway and confirm both changes remain.
5. Confirm the `guildConfigs` collection contains the server document.
6. Confirm `serverConfig.json` does not change after settings updates.
