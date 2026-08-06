# CURSED runtime warning audit

## Scope

This audit addresses the three warnings observed in the Railway startup/runtime logs:

1. `MaxListenersExceededWarning` on the shared Mongoose `NativeConnection`.
2. Duplicate Mongoose schema index warning for `createdAt`.
3. Discord.js deprecation warning for the `ephemeral` interaction-response option.

No command behavior, permissions, cooldowns, persistence data, Premium eligibility, dashboard response shape, scheduler interval, AI behavior, economy value, moderation action, ticket behavior, or user-facing message is changed.

## Mongoose connection listeners

### Inventory

CURSED has independent persistence stores that subscribe once to the shared Mongoose connection so they can hydrate caches or flush queued writes after a reconnect. Permanent `connected` subscribers are currently registered by:

- `utils/GuildConfigStore.js`
- `utils/warnings.js`
- `utils/premium.js`
- `utils/serverPremium.js`
- `utils/birthdays.js`
- `utils/persistenceShutdown.js`

Several Mongo-backed compatibility stores also use temporary one-shot `connected`/`error` waiters while the initial connection is in progress:

- economy
- profiles
- pets
- short-term memory
- roast leaderboard

The modules are loaded through CommonJS and register their permanent listeners once per process. The audit found no listener registration inside a Discord event, command handler, API request, scheduler iteration, or retry loop. The warning is produced because the legitimate permanent subscribers and overlapping one-shot startup waiters can exceed Node's default EventEmitter limit of ten.

### Fix

`utils/runtimeWarningGuards.js` is preloaded before `index.js` by both `npm start` and `npm run dev`.

It sets a finite Mongoose connection listener budget of **32** before application modules load. The installation is guarded by a global symbol and is idempotent. It does not add a Mongoose listener itself and does not use unlimited listeners, so abnormal growth remains observable.

This changes only Node's warning threshold for the intentionally shared connection architecture. It does not alter connection ownership, reconnect behavior, initialization timing, pending-write queues, retries, or shutdown flushing.

## Duplicate schema index

### Root cause

`utils/customRoles.js` declared the `customRoleAudits.createdAt` index twice:

- `createdAt` had `index: true` in the field definition.
- `customRoleAuditSchema.index({ createdAt: 1 }, { expireAfterSeconds: ... })` declared the required 90-day TTL index.

Mongoose warns when the same path index is declared through both mechanisms.

### Fix

The field-level `index: true` was removed. The explicit TTL index remains:

```js
customRoleAuditSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: AUDIT_TTL_SECONDS }
)
```

The collection name, timestamp values, audit retention period, sorting, writes, reads, and cleanup behavior remain unchanged.

## Discord interaction `ephemeral` deprecation

### Root cause

CURSED has established command and component handlers that pass the legacy Discord.js option:

```js
{ ephemeral: true }
```

Discord.js 14.26 accepts it for compatibility but emits a deprecation warning and now prefers `MessageFlags.Ephemeral` through the `flags` field.

### Fix

The startup guard patches the shared Discord.js interaction response methods once per process:

- `reply`
- `deferReply`
- `followUp`

Before Discord.js processes an options object, the guard:

- removes the deprecated `ephemeral` property;
- adds or removes `MessageFlags.Ephemeral` in `flags`;
- preserves any other message flags;
- leaves string payloads and options without `ephemeral` unchanged;
- does not mutate the caller's object.

This compatibility layer keeps existing command files and response behavior unchanged while ensuring Discord.js no longer receives the deprecated option. It covers command interactions, context-menu interactions, message components, select menus, buttons, and modal submissions through their shared response prototypes.

## Startup order

Railway now starts CURSED with:

```bash
node -r ./utils/runtimeWarningGuards.js index.js
```

Local watch mode uses the same preload before `index.js`. No environment variable, Railway service setting, port, health route, webhook, API route, or Vercel configuration changes.

## Regression coverage

Run:

```bash
npm run test:runtime-warnings
```

The focused tests verify:

- the Mongoose listener budget is finite;
- installation is idempotent;
- the guard adds no connection listener;
- `ephemeral: true` becomes the Ephemeral message flag;
- `ephemeral: false` removes only that flag;
- existing flags are preserved;
- `reply`, `deferReply`, and `followUp` never pass `ephemeral` downstream;
- string payloads remain unchanged;
- Railway and development commands preload the guard;
- the custom-role audit has exactly one `createdAt` TTL index.

## Railway verification

After merging:

1. Open the latest Railway deployment logs from the beginning of process startup.
2. Confirm CURSED logs in and MongoDB-backed stores initialize normally.
3. Confirm these warnings are absent:
   - `MaxListenersExceededWarning`
   - `Duplicate schema index`
   - `Supplying "ephemeral" for interaction response options is deprecated`
4. Run one ephemeral slash-command response, one deferred ephemeral command, one button/select interaction, and one modal flow.
5. Confirm private responses remain visible only to the invoking user.
6. Run a public command and confirm it remains public.
7. Restart Railway twice and confirm no listener warning appears on either startup.
8. Confirm custom-role audit records are still written and expire under the existing 90-day TTL index.
9. Smoke-test MongoDB reconnect initialization, Premium, birthdays, economy, tickets, moderation, welcome, and the dashboard API.

## Atlas verification

In MongoDB Atlas, inspect the `customRoleAudits` collection indexes. There should be one `createdAt_1` TTL index with the existing 90-day `expireAfterSeconds` value. This PR does not require deleting documents or rebuilding application data.

## Rollback

Revert this PR. Existing data is untouched. Reverting restores the previous startup command, field-level index declaration, and legacy Discord interaction option handling.
