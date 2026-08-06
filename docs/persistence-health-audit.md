# CURSED MongoDB persistence health audit

## Scope

This audit covers the active CURSED bot/backend persistence architecture after the economy, profile, pet, guild configuration, short-term memory, Premium, birthday and roast leaderboard migrations.

It inventories the current models, collections, caches, startup paths, write queues, retry behavior, legacy imports and shutdown behavior. It does not change commands, feature rules, limits, prices, rewards, prompts, permissions, dashboard payloads, eligibility, scheduler timing or user-facing responses.

## Connection ownership

- `index.js` starts the primary process-wide `mongoose.connect(MONGO_URI)` call before feature modules are loaded.
- Mongoose is a process singleton. Queue-backed compatibility stores check `mongoose.connection.readyState` before connecting:
  - ready state `1`: reuse the connected singleton;
  - ready state `0`: connect only when the store is loaded outside the normal bot startup;
  - connecting states: wait for the shared connection event rather than opening a second model registry.
- API-only code also uses the same Mongoose singleton inside its process.
- No feature creates a separate `mongoose.createConnection()` instance.

This means the repository has multiple defensive connection callers but one physical default Mongoose connection per process. The calls are redundant fallbacks, not separate database pools.

## Active collection inventory

### Migrated compatibility stores

| Model | Collection | Identity/index | Runtime cache and writes | Legacy source |
|---|---|---|---|---|
| `EconomyUser` | `economy_users` | unique `userId` | `economyCache`, `knownSnapshots`, `pendingWrites`, 30-second retry | `economy.json` |
| `ProfileData` | `profile_users` | unique `userId` | `profileCache`, `knownSnapshots`, `pendingWrites`, 30-second retry | `profiles.json` |
| `PetData` | `pet_users` | unique `userId` | `petCache`, `knownSnapshots`, `pendingWrites`, 30-second retry | `pets.json` |
| `GuildConfig` | `guildConfigs` | unique `guildId` | `mongoCache`; reliability wrapper adds a latest-value pending guild queue | `serverConfig.json` |
| `ShortTermMemory` | `short_term_memories` | unique `memoryKey` (`guildId:userId`) | `memoryCache`, `knownSnapshots`, `pendingWrites`, 30-second retry | `memory.json` |
| `PremiumAccount` | `premiumAccounts` | unique `userId`; active/expiry indexes | `accountCache`, `pendingAccountWrites` | `premiumData.json` |
| `PremiumSettings` | `premiumSettings` | unique key `global` | `paymentSettingsCache`, `pendingSettingsWrite` | `premiumData.json` |
| `PremiumCode` | `premiumCodes` | unique `code`; deleted index | `codeCache`, `pendingCodeWrites` | `premiumCodes.json` |
| `PremiumGuildAccount` | `premiumGuildAccounts` | unique `guildId`; active/expiry indexes | `guildCache`, `pendingGuildWrites` | `serverPremiumData.json` |
| `BirthdayEntry` | `birthdayEntries` | unique `(guildId,userId)`; guild/date indexes | entry cache, tombstones and pending entry mutations | `birthdayData.json` |
| `BirthdayGuildConfig` | `birthdayGuildConfigs` | unique `guildId` | config cache and pending config writes | `birthdayData.json` |
| `BirthdayDmDelivery` | `birthdayDmDeliveries` | unique `deliveryKey` | active/released sets and pending delivery writes | `birthdayData.json` |
| `RoastLeaderboardEntry` | `roast_leaderboard` | unique exact `targetName`; stable `order` | count/order caches and pending atomic increments | `roast_counts.json` |

All listed JSON files are read-only import sources. Existing MongoDB documents win through `$setOnInsert`.

### Mongo-native user and server features

| Model | Collection | Persistence style |
|---|---|---|
| `LongTermMemory` | Mongoose-derived `longtermmemories` | direct awaited reads/writes; process-memory fallback when MongoDB is unavailable |
| `Personality` | Mongoose-derived `personalities` | direct awaited upserts; process-memory fallback |
| `LevelingConfig` | `levelingConfigs` | direct awaited writes with TTL configuration cache |
| `LevelingMember` | `levelingMembers` | atomic/direct writes; unique `(guildId,userId)` |
| `CustomRoleConfig` | `customRoleConfigs` | direct awaited writes with short TTL cache |
| `CustomRoleAudit` | `customRoleAudits` | direct audit inserts with a 90-day TTL index |
| `Activity` | Mongoose-derived `activities` | direct atomic lifetime counters |
| `GuildStatsConfig` | `guildStatsConfigs` | direct awaited writes with TTL cache |
| `GuildActivityDaily` | `guildActivityDaily` | unique `(guildId,date)` daily counters |
| `UserActivityDaily` | `userActivityDaily` | unique `(guildId,userId,date)` daily counters |
| `ChannelActivityDaily` | `channelActivityDaily` | unique `(guildId,channelId,date)` daily counters |

The voice-session maps, duplicate-message windows, user locks, activity session maps, cooldown maps and usage counters are intentionally process-local coordination state. They are not entitlement or durable business records.

### Ticket collections

| Model | Collection | Key indexes |
|---|---|---|
| `TicketPanel` | `ticketPanels` | guild/name lookup |
| `TicketRecord` | `tickets` | unique `(guildId,ticketNumber)` plus creator/status indexes |
| `TicketCounter` | `ticketCounters` | unique `guildId`; atomic `$inc` ticket numbering |

Ticket creation and actions use direct awaited MongoDB operations. There is no deferred in-memory ticket write queue to flush.

### Security recovery collections

| Model | Collection | Key indexes |
|---|---|---|
| `SecuritySnapshot` | `securitySnapshots` | guild and creation-time indexes |
| `SecurityBotApproval` | `securityBotApprovals` | guild/bot/active and expiry indexes |
| `SecurityIncidentMode` | `securityIncidentModes` | unique `guildId`; active/expiry indexes |

Security incidents, lockdown state, quarantine state, moderation cases/evidence and related protection records remain separate operational models. They use direct awaited writes and were not combined with guild configuration by this audit.

## Startup initializers

### Self-starting queue-backed stores

- Economy: `initializeEconomyStore()` → optional `$setOnInsert` import → Mongo hydration → queued write flush.
- Profiles: `initializeProfileStore()` → optional import → hydration → queued write flush.
- Pets: `initializePetStore()` → optional import → hydration → queued write flush.
- Short-term memory: `initializeMemoryStore()` → optional import → hydration → queued write flush.
- Roast leaderboard: `initializeRoastLeaderboard()` → optional import → hydration → queued `$inc` flush.
- Premium: connection listener runs `refreshPremiumCache()` and flushes pending user/settings/code writes.
- Server Premium: connection listener runs `refreshServerPremiumCache()` and flushes pending guild-account writes.
- Birthdays: connection listener runs `initializeBirthdayStore()` and flushes pending entry/config/delivery mutations.
- Guild configuration: connection listener refreshes `mongoCache` and imports missing legacy guild documents.

All startup promise chains have catches or internal error handling. `index.js` also logs `unhandledRejection` and `uncaughtException` without changing command responses.

## Startup-race findings

### Protected patterns

- Economy, profiles, pets and short-term memory do not hydrate over keys already present in their pending-write maps.
- Premium, server Premium and birthdays reapply pending mutations after Mongo hydration.
- Roast increments completed while MongoDB connects are added back after hydration and persisted with `$inc`.
- Legacy imports use `$setOnInsert`; stale JSON cannot overwrite an existing MongoDB record.
- Birthday removals, released DM claims and deleted Premium codes already use durable tombstones/state flags.

### Reliability changes in this audit

1. **Guild configuration queue**
   - Existing synchronous APIs still return immediately.
   - The latest returned guild snapshot is now retained in a process-level pending map.
   - Pending snapshots retry on MongoDB reconnect and are included in bounded shutdown flushing.
   - `updateGuildConfigAndWait()` remains the authoritative awaited persistence operation.

2. **Short-term memory clear tombstone**
   - A clear now persists the existing document with `messages: []` instead of deleting it.
   - Empty histories are omitted from the runtime cache and remain invisible to callers.
   - The document blocks stale `memory.json` from recreating cleared memory on a later restart.

3. **Pet deletion tombstone**
   - A deleted pet now persists its existing `pet_users` document with `data: null` instead of deleting it.
   - Null records are omitted from the runtime cache and `getPet()` still returns no pet.
   - The document blocks stale `pets.json` from restoring a deleted pet.

No collection or public schema was redesigned. Both tombstones use values already supported by the existing `Mixed` fields.

## Retry timers and error handling

- Economy, profiles, pets, short-term memory and roast leaderboard use one unref'ed 30-second retry timer per store.
- Birthdays use one unref'ed 30-second retry timer.
- Premium and server Premium primarily retry on the shared Mongoose `connected` event; pending changes remain cached until refresh/reconnect or bounded shutdown flush.
- Guild configuration now retries queued snapshots on reconnect.
- Direct-await systems return or log their existing feature-specific MongoDB failures; this audit does not convert them into deferred queues.
- Error prefixes remain feature-specific. The health test checks that every queue-backed startup path terminates in a catch or internally handled result.

## Graceful Railway shutdown

The existing `index.js` already destroys the Discord client and awaits `mongoose.connection.close()` for `SIGTERM` and `SIGINT`.

`utils/persistenceShutdown.js` safely wraps that existing close call:

1. It stops the birthday scheduler when that module is loaded.
2. It flushes only queue-backed modules already loaded in the current process.
3. It includes the guild-configuration reliability queue.
4. It applies a hard default flush deadline of 4 seconds.
5. It then applies a hard default MongoDB-close deadline of 1.5 seconds.
6. A timeout is logged and shutdown continues; the process is never blocked indefinitely.

Optional operational overrides:

- `PERSISTENCE_FLUSH_TIMEOUT_MS`
- `MONGO_CLOSE_TIMEOUT_MS`

Both values are bounded internally and do not affect feature logic.

Mongo-native direct-await systems are not re-run during shutdown because they have no deferred queue. Unloaded feature modules are not required merely to flush them, preventing new models, schedulers or migrations from starting during termination.

## Model registration and collection/index review

- Dedicated model files use `mongoose.models.Name || mongoose.model(...)`.
- Inline feature modules use a retrieve-existing-model helper before registration.
- Model names in the audited modules are unique.
- Explicit collection names do not collide.
- The two Mongoose-derived collections (`longtermmemories`, `personalities`) have distinct model names.
- Unique identities are consistent with public scope:
  - global user records use `userId`;
  - guild/user records use compound indexes;
  - guild settings use `guildId`;
  - short-term memory uses `guildId:userId` in `memoryKey`;
  - roast targets remain globally keyed by exact target name.
- TTL indexes remain limited to audit/operational retention features and are not added to entitlement or user-progress records.

## Remaining operational limitations

- A platform hard kill that bypasses `SIGTERM`/`SIGINT` cannot run application-level flushing.
- A change made while MongoDB is unavailable and followed by a hard kill before reconnect can still be lost; the bounded queue materially reduces, but cannot eliminate, that platform-level case.
- Process-local cooldowns, anti-spam windows, voice-session starts and Premium daily usage counters intentionally reset on deploy.
- Old Summary/Knowledge MongoDB records may remain for rollback safety, but the removed feature code does not load or mutate them.

## Railway verification

1. Confirm `MONGO_URI` is configured and startup logs show one successful MongoDB connection.
2. Confirm the startup-ready logs for economy, profiles, pets, short-term memory, Premium, server Premium, birthdays and roast leaderboard.
3. Confirm no `OverwriteModelError`, duplicate-key index build error or repeated connection-pool error appears.
4. Change one economy value, profile, pet field, guild setting, memory item, Premium setting, birthday and roast count.
5. Restart Railway normally and verify all values survive.
6. Clear short-term memory, restart twice and confirm it stays cleared while its Mongo document contains `messages: []`.
7. Delete/remove a test pet through the existing flow, restart twice and confirm it stays absent while its Mongo document contains `data: null`.
8. Change a guild setting and immediately restart; confirm the queued latest snapshot survives.
9. During a controlled restart, look for persistence-flush timeout/failure logs. There should be none under normal MongoDB health.
10. Verify the active collections and indexes in Atlas match this inventory.
11. Confirm legacy JSON files, when present, were not modified.
12. Confirm commands, dashboard responses, scheduler intervals, plan limits and user-facing messages remain unchanged.

## Rollback

Revert this PR. It does not delete collections or legacy JSON files. Empty short-term-memory documents and null pet documents are safe inert tombstones; reverting would leave them harmlessly unreadable as active data by the existing callers.
