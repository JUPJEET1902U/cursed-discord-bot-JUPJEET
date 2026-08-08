# CURSED Reboot

Branch: `REBOOT-1`

## Product direction

CURSED is an AI-powered Discord server protection and community-management bot. The Reboot is not a feature reset; it is a reliability, architecture, performance, and product-experience overhaul of the existing bot.

The design standard is inspired by the qualities that make established Discord bots feel dependable: a small public hierarchy, deep internal systems, predictable commands, terse failures, restrained visuals, explicit permissions, safe recovery, and measurable performance.

## Product hierarchy

1. Server Management
   - Moderation
   - Server Protection
   - Server configuration
2. AI & Creative
   - AI chat
   - Memory
   - Image generation
3. Community
   - Welcome
   - Tickets
   - Profiles
   - Leveling
   - Birthdays
   - Custom roles
4. Economy & Games
   - Economy
   - Shop
   - Games
   - Gambling
   - Pets
   - Quests
5. Utilities
   - Server information
   - Statistics
   - Premium/account utilities

The internal module count can be large. The public product hierarchy should remain small.

## Reboot engineering rules

- `main` remains the production baseline while Reboot is developed.
- Reboot work stays on `REBOOT-1` until explicitly promoted.
- Dashboard, dashboard API, webhook hosting and deployment configuration are outside this Reboot phase.
- Existing user-facing features are preserved unless a feature is proven unused, unsafe, or duplicate.
- Destructive actions must validate authorization, target hierarchy, bot permissions and feature configuration before execution.
- A successful Discord action must not be reported as failed solely because logging or database side effects failed.
- Security attribution must be conservative. Faster response must not mean guessing the actor.
- Security neutralization happens before non-critical persistence/reporting when attribution is reliable.
- Message content, AI output, secrets and tokens do not belong in runtime logs.
- Background timers must be bounded and should not keep the process alive unnecessarily.
- User-facing errors should state what failed and what permission/configuration is required.
- Emojis are functional status markers or domain identity, not decoration on every heading/field.
- CI must protect feature presence, Reboot isolation, syntax, persistence, AI reliability and major UX contracts.

## Reboot A-H

### A — Foundation
- Shared product hierarchy and naming.
- Shared response builder.
- Shared runtime timing metrics.
- Cleaner command dispatch errors and timing.

### B — Command experience
- Section-first Help UI.
- Progressive disclosure: section → category → command.
- Consistent command usage, permission and error language.
- Cleaner server, statistics and setup responses.

### C — Moderation
- Unified moderation permission/target validation.
- Consistent cases and logs.
- Advanced moderation aligned with the same UX.
- Tempban expiry remains restart-safe.
- Logging/database failures are isolated from completed Discord actions.

### D — Security response performance
- Parallel audit-log type resolution.
- Short bounded audit-log propagation retries.
- Target/recency matching and duplicate suppression.
- Fast defensive response before non-critical logging/report work.
- Runtime state bounded and cleaned.

### E — Security configuration and logging
- Existing Anti-Raid risk settings fully participate in detection.
- Dedicated `manageGuild` trust scope for server-setting actions.
- Message Shield owns rapid/repeated spam when enabled to avoid duplicate punishment with legacy Anti-Spam.
- Security audit recommendations cannot contradict detected issues.
- Operational security log presentation.

### F — AI
- Provider clients separated from the old legacy provider module.
- Gemini → Groq → OpenRouter order preserved.
- Retry-After, cooldown, fallback and total deadline behavior retained.
- Provider and chat latency measured without logging conversations.
- Image command failures/gating standardized.

### G — Community, economy and games
- Economy, advanced economy, shop, quests, profiles, pets and leaderboards use one restrained presentation system.
- Active game sessions expire instead of living indefinitely in memory.
- Battle rounds no longer make serial AI network calls; combat execution is local and predictable.
- Leveling, birthday and custom-role administration are presented consistently.

### H — Validation and cleanup
- Reboot CI runs only on `REBOOT-1`.
- CI fails if Reboot touches dashboard/API/deployment paths during this phase.
- Feature-preservation tests lock existing command families in place.
- Existing memory, economy, AI, welcome, runtime-warning and owner-network regressions remain in the validation suite.

## Promotion rule

`REBOOT-1` must not be merged or deployed as production merely because the code compiles. Promotion requires a final diff review, green automated checks, Discord test-server validation of high-risk moderation/security flows, and explicit approval to merge.
