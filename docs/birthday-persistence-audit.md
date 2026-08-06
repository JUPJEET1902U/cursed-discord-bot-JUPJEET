# CURSED birthday persistence audit

## Scope

This audit covers birthday entries, per-guild birthday settings, announcement delivery state, DM delivery state, scheduler state, runtime caches, and `birthdayData.json`. It does not change commands, validation, leap-year rules, server scoping, timezones, templates, placeholders, scheduler timing, permissions, dashboard payloads, or user-facing messages.

## Authoritative MongoDB stores

| Data | MongoDB collection | Runtime cache | Legacy JSON source |
| --- | --- | --- | --- |
| Birthday entries and annual announcement claim | `birthdayEntries` | `entryCache` and `entryTombstones` | `birthdayData.json` → `entries` |
| Guild birthday settings | `birthdayGuildConfigs` | `configCache` | `birthdayData.json` → `configs` |
| Birthday DM delivery claim | `birthdayDmDeliveries` | `activeDmDeliveries` and `releasedDmDeliveries` | `birthdayData.json` → `dmDeliveries` |

MongoDB is authoritative. `birthdayData.json` is read once as a legacy import source and is never written, copied, renamed, or deleted.

## Birthday entries

Entries remain uniquely scoped by `{ guildId, userId }`. Date fields, actor fields, timestamps, and `lastAnnouncementKey` retain their existing meanings.

Removal now writes a tombstone in `birthdayEntries` using `deleted: true` instead of physically deleting the MongoDB document. Reads and lists exclude tombstones. Re-adding the birthday intentionally clears the tombstone. This prevents an older JSON entry from restoring a birthday that was removed after migration.

The annual announcement claim remains stored in `lastAnnouncementKey`. A failed announcement still releases the matching claim by setting it back to `null`. Legacy import uses `$setOnInsert`, so JSON cannot overwrite either a completed claim or a released state in an existing MongoDB document.

## Guild birthday settings

The existing `birthdayGuildConfigs` collection remains authoritative for enabled state, announcement channel, timezone, DM and announcement toggles, templates, and updater identity.

Legacy configs are inserted only when a guild document does not exist. Existing MongoDB settings always win.

## DM delivery state

The existing `birthdayDmDeliveries` collection continues using one unique `deliveryKey` per user, birthday, and year.

Delivery records now have an `active` state:

- `active: true` means the annual DM claim is held and prevents duplicate delivery.
- `active: false` is a released tombstone after a failed DM and permits a retry.

Released records are retained instead of deleted, so stale JSON cannot recreate a claim that was deliberately released. Existing records created before this migration are normalized to `active: true`, preserving their original “already delivered” meaning and preventing duplicate DMs.

## Operations while MongoDB connects

The public birthday APIs remain asynchronous. While MongoDB is unavailable or connecting, changes are applied to the runtime caches and queued in:

- `pendingEntryWrites`
- `pendingConfigWrites`
- `pendingDmWrites`

After MongoDB connects, CURSED imports missing legacy records with `$setOnInsert`, loads all MongoDB state including tombstones, reapplies queued mutations, and flushes them. Queued removals and releases therefore take priority over stale database or JSON snapshots.

Temporary connection and write failures are retried without restoring JSON writes.

## Scheduler state

`schedulerHandle` and `schedulerRunning` remain intentionally process-local controls. They are not user data and are not persisted.

Scheduler behavior is unchanged:

- first check after 15 seconds;
- default interval of 10 minutes;
- minimum interval of 60 seconds;
- overlapping checks remain blocked;
- failed announcement and DM sends release their claims for retry.

## Compatibility

The following remain unchanged:

- birthday commands and aliases;
- date parsing and validation;
- 29 February behavior in non-leap years;
- guild scoping and member checks;
- timezone validation and date conversion;
- announcement and DM templates and placeholders;
- announcement channel behavior;
- duplicate-delivery protection;
- dashboard routes, validation, response shapes, and permissions;
- scheduler timing and user-facing messages.
