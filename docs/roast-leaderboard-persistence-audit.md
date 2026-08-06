# CURSED roast leaderboard persistence audit

## Scope

This audit covers only the global roast leaderboard persistence used by `addRoast()` and `getLeaderboard()`. It does not change roast generation, cooldowns, target selection, command responses, economy statistics, quest progress, medals, or display formatting.

## Previous storage

`utils/roast.js` used `roast_counts.json` as its live database:

- each object key was the exact target name passed to `addRoast()`;
- each value was the number of successful roasts recorded for that name;
- every successful roast read the full file, incremented one counter, and rewrote the full file;
- `getLeaderboard()` read the full file and sorted all entries by count descending;
- the leaderboard was global and had no guild or user scope.

This was unsafe on Railway because container files are ephemeral and concurrent increments could overwrite each other.

## Authoritative MongoDB store

The authoritative collection is now `roast_leaderboard`.

Each document contains:

- `targetName`: the exact, case-sensitive target-name key;
- `count`: the accumulated successful-roast count;
- `order`: the original insertion order used to preserve stable ordering when counts tie;
- Mongoose timestamps.

There is no `guildId` field. The leaderboard remains global across all servers.

## Runtime cache and synchronous APIs

The existing APIs remain synchronous:

- `addRoast(name)` updates the in-memory count immediately and returns without requiring callers to await it;
- `getLeaderboard()` returns the current cached array sorted by count descending, or `null` when empty.

Runtime state:

- `countCache`: exact target-name keys and current counts;
- `orderCache`: stable insertion order for tie handling;
- `pendingIncrements`: increments waiting to be persisted;
- `nextOrder`: insertion order for a newly seen target name.

The command handler therefore keeps its current behavior and response timing.

## Legacy import

`roast_counts.json` is retained as a read-only legacy import source.

At MongoDB startup:

1. CURSED reads the available JSON file without modifying it.
2. Each legacy target is inserted with `$setOnInsert` only when no MongoDB document exists.
3. Existing MongoDB counts and insertion order always win over stale JSON.
4. MongoDB records hydrate the runtime cache.
5. Increments completed while MongoDB was connecting are reapplied to the cache and persisted with `$inc`.

The import is idempotent and safe to run repeatedly. The code contains no JSON write, copy, rename, or delete path.

## Counting and sorting behavior preserved

The command still records a roast only after AI generation succeeds. It still passes the exact selected target string to `addRoast()`.

`getLeaderboard()` still:

- includes all global target-name counters;
- sorts by count descending;
- preserves insertion order for equal counts through JavaScript's stable sort and the stored `order` field;
- returns `null` for an empty leaderboard.

The `!leaderboard` command remains responsible for:

- showing only the first ten rows;
- using the existing medals;
- retaining the existing singular/plural wording;
- retaining the existing empty-leaderboard message.

## Failure and startup behavior

Increments performed while MongoDB is disconnected or still connecting remain immediately visible in memory and are queued. After MongoDB becomes available, queued increments are applied atomically with `$inc`.

If a write fails, its delta is restored to the pending queue and retried later. The legacy JSON file is never used as a write fallback, so stale data cannot overwrite a newer MongoDB count.

## Unchanged systems

This migration does not change:

- `!roast` or `!leaderboard` command recognition;
- AI prompts, providers, fallback, or generated roast content;
- the 15-second roast cooldown;
- target-name selection from mentions, text, or sender display name;
- when `addRoast()` is called;
- quest progress or economy statistics;
- global leaderboard scope;
- descending sorting or top-ten display;
- medals, wording, sanitization, or user-facing messages.
