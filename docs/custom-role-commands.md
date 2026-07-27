# CURSED Custom Role Commands — bot deployment and safety guide

## Purpose

Custom Role Commands let server administrators map short prefix commands to approved Discord roles. A configured **Required Role (`req.role`)** controls who may use those mappings. Running a mapped command toggles the configured role on one mentioned member.

Example configuration:

- Required role: `Trusted Staff`
- `!staff @member` → `Staff`
- `!vip @member` → `VIP`
- `!designer @member` → `Designer`

If the target lacks the mapped role, CURSED adds it. If the target already has it, CURSED removes it.

## Five implementation stages

### Stage 1 — persistence and policy

- Dedicated MongoDB collections: `customRoleConfigs` and `customRoleAudits`.
- Default-disabled configuration with five base slots: Staff, Girl, VIP, Guest, and Friend.
- Command-name normalization, uniqueness, limits, and built-in command collision checks.
- Role catalog checks for Discord-managed roles, hierarchy, and dangerous permissions.

### Stage 2 — Discord role commands

- Dynamic mapped commands run after all built-in CURSED command modules, so built-ins always win.
- Only the owner, an administrator, or a member holding `req.role` may use a mapped command.
- Discord hierarchy still applies to administrators; only the server owner bypasses actor hierarchy checks.
- CURSED must have Manage Roles and its highest role must be above the mapped role and target member.
- Bots, `@everyone`, managed roles, Administrator roles, and Manage Roles roles are blocked.
- Three-second per-user cooldown prevents rapid role toggling.

### Stage 3 — recovery and administration

- `!reqrole set @role`
- `!reqrole clear`
- `!reqrole view`
- `!rolecmd add <name> @role`
- `!rolecmd remove <name>`
- `!rolecmd list`
- `!rolecmd enable`
- `!rolecmd disable`
- `!rolecommands`

Clearing `req.role` also disables the feature, preventing an accidentally unlocked configuration. Owner/admin recovery remains available.

### Stage 4 — secure dashboard bridge

This bot repository exposes authenticated server-to-server routes under the existing private dashboard API:

- `GET /api/dashboard/guilds/:guildId/custom-roles`
- `PUT /api/dashboard/guilds/:guildId/custom-roles`

The separate dashboard repository is `JUPJEET1902U/cursed-discord-bot-DASHBOARD`. Its companion PR provides the Next.js page, API proxy route, editor components, navigation, and production build checks.

The bot API validates role IDs, role hierarchy, dangerous permissions, command collisions, uniqueness, limits, and the required-role rule again. Dashboard input is never trusted directly.

### Stage 5 — audit, regression, and deployment checks

- Successful role adds/removals and denied attempts are persisted.
- Configuration changes are audited.
- Successful role changes are sent to the configured moderation-log channel when available.
- Bot CI checks JavaScript syntax, command isolation, policy contracts, storage contracts, and the secure dashboard API bridge.
- The companion dashboard repository runs its own Next.js production build and type checks.

## Manual Railway and Discord tests

1. Merge and deploy the bot PR to Railway.
2. Merge and deploy the companion dashboard PR to Vercel.
3. Place CURSED's role above the roles it will assign and grant Manage Roles.
4. Open Dashboard → Custom Roles.
5. Select a Required Role, map Staff to a safe role, enable the feature, and save.
6. Wait up to five seconds for cross-process cache refresh.
7. As a member without `req.role`, run `!staff @member`; expect denial.
8. Add `req.role` to the command user and run it again; expect Role Added.
9. Run it a second time; expect Role Removed.
10. Try a target at or above the command user's highest role; expect denial.
11. Try selecting an Administrator, Manage Roles, managed, or above-CURSED role; dashboard save must reject it.
12. Try creating `help`, `balance`, or another built-in command name; save must reject it.
13. Run `!help`, `!balance`, AI chat, economy, welcome, tickets, games, images, and moderation regression checks.
14. Restart Railway and confirm settings persist.

## Scope lock

This feature does not change AI intelligence, the 500-character AI-chat policy, economy, games, pets, profiles, welcome, tickets, image generation, premium limits, provider routing, slash-command registration, or Railway configuration.
