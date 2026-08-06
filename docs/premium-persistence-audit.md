# CURSED Premium persistence audit

## Scope

This audit covers Premium eligibility and persistence only. It does not change prices, plan limits, payment verification, Premium role assignment, commands, dashboard payloads, permissions, expiry decisions, or user-facing messages.

## Authoritative MongoDB stores

| Data | MongoDB collection | Runtime cache | Legacy JSON import |
| --- | --- | --- | --- |
| User Premium accounts | `premiumAccounts` | `accountCache` | `premiumData.json` → `accounts` |
| Global payment settings | `premiumSettings` | `paymentSettingsCache` | `premiumData.json` → `settings` |
| Redemption codes | `premiumCodes` | `codeCache` | `premiumCodes.json` |
| Direct server Premium accounts | `premiumGuildAccounts` | `guildCache` | `serverPremiumData.json` |

All three JSON files are now read-only legacy import sources. Production grants, revocations, settings updates, code creation, code redemption, and code deletion no longer write JSON.

## User Premium accounts

`utils/premium.js` stores user entitlements in `premiumAccounts` with:

- `userId`
- `active`
- `source`
- `note`
- `grantedBy`
- `grantedAt`
- `expiresAt`
- `revokedAt`

`isPremiumUser()` still grants Premium to configured bot owners first and otherwise calls the unchanged active/expiry check. An account is eligible only when `active === true` and `expiresAt` is either absent or in the future.

Revoked and expired records remain present in MongoDB and are loaded into `accountCache`. Active account listings continue filtering through the same eligibility function. Keeping inactive records authoritative prevents an older active JSON entry from restoring access.

## Direct server Premium accounts

`utils/serverPremium.js` stores direct server grants in `premiumGuildAccounts` with the same active, grant, expiry, and revocation fields, keyed by `guildId`.

A server remains Premium when either:

1. it has an active direct server account; or
2. its Discord owner has an active user Premium account.

That eligibility rule is unchanged. Revoked and expired direct grants remain authoritative MongoDB records and cannot be overwritten by `serverPremiumData.json`.

## Payment settings

Global payment visibility, currency, monthly price, headline, instructions, and provider links remain in the existing `premiumSettings` document with key `global`.

`premiumData.json` settings are inserted only when the MongoDB document does not already exist. Dashboard and command updates continue using `updatePaymentSettings()` and preserve the existing normalized response shape.

## Redemption codes

Redemption codes previously depended entirely on `premiumCodes.json`. They now use the `premiumCodes` collection while retaining the synchronous APIs:

- `loadCodes()`
- `saveCodes()`
- `generateCode()`
- `createCode()`
- `useCode()`
- `listCodes()`

The in-memory `codeCache` preserves current call behavior. MongoDB writes are queued in the background because these APIs are synchronous. Deleted codes are stored as tombstones instead of being physically removed, preventing an old JSON entry from recreating a deleted code during later startups.

A MongoDB code marked used cannot be reset to unused by stale JSON because legacy migration uses `$setOnInsert`.

## Legacy migration rules

At MongoDB startup:

1. Available legacy JSON is read without being modified.
2. Missing user accounts, payment settings, codes, and server accounts are inserted with `$setOnInsert`.
3. Existing MongoDB documents always win, including inactive, revoked, expired, used, and deleted records.
4. All MongoDB records are loaded into their existing synchronous caches.
5. Changes queued while MongoDB is connecting are reapplied and persisted after loading.

The migration is idempotent and safe to run repeatedly.

## In-memory state that remains intentionally ephemeral

The following maps are runtime controls, not Premium entitlement records, and remain in memory:

- `aiCooldowns`: per-process AI reply pacing
- `usageCounters`: current-day image, meme, and fun usage counters

Their limits and reset behavior are unchanged by this migration.

Payment webhook signature verification, replay protection, payment-provider parsing, Discord role assignment, and guild `premiumRoleId` storage are separate systems and are not modified. `premiumRoleId` remains in the shared `guildConfigs` store.

## Compatibility

The following remain unchanged:

- bot-owner eligibility
- user and server Premium eligibility
- free and Premium plan values
- expiry comparisons
- grant and revocation command behavior
- payment settings validation and dashboard response shape
- Premium role assignment and removal
- payment webhook verification
- command names, permissions, and messages
- dashboard frontend and API routes
