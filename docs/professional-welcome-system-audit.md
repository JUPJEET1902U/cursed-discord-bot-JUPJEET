# CURSED Professional Welcome System Audit

## Scope

This audit covers the active welcome configuration facade, MongoDB-backed guild settings, slash-command callers, dashboard API contract, welcome embed delivery, Premium welcome-card generation, remote media handling, fallback destinations and regression coverage.

The upgrade is intentionally isolated from AI chat, provider fallback, economy, profiles, pets, memory, Premium eligibility, tickets, moderation actions, birthdays, deployment and unrelated commands.

## Existing architecture preserved

- `utils/serverConfig.js` keeps the existing synchronous `getServerConfig()` and `saveConfig()` compatibility APIs.
- The `guildConfigs` MongoDB collection remains authoritative.
- `serverConfig.json` remains a read-only legacy import source.
- `/welcome setup|view|preview|test|disable` remains registered through the existing moderation command module.
- AI-generated welcome text still uses the existing prompt and falls back to the configured/default text.
- Welcome cards remain Premium-only through `isGuildPremium(guild)`.
- Non-Premium servers and card-generation failures continue receiving the existing embed-only welcome.
- The dashboard API response object keeps the same fields and nesting.

## Card themes

The renderer and dashboard API now support:

- Classic
- Modern
- Minimal
- Glass
- Dark
- Purple
- Neon
- Gold

The legacy `midnight` identifier remains accepted so existing guild configurations do not break. Unknown identifiers still normalize to `classic`.

All card themes use the same 1000×420 output size and retain the existing Premium gate. The renderer now includes:

- circular/rounded member avatar;
- accent glow and soft shadows;
- gradient or custom-image background;
- glass-style rounded information panel;
- server icon and server name;
- display name and member number;
- assigned-role label when supplied;
- theme-specific text, muted text and accent treatment.

## Placeholder support

The following placeholders resolve case-insensitively:

- `{user}`
- `{username}`
- `{mention}`
- `{user.id}`
- `{user.tag}`
- `{server}`
- `{memberCount}`
- `{createdAt}`
- `{joinedAt}`
- `{rulesChannel}`
- `{staffRole}`

They are resolved in the welcome message/description, the existing `welcomeEmbedTitle` setting and the footer.

`{rulesChannel}` uses an explicitly stored rules-channel ID when available, otherwise a conventional rules/information channel name, otherwise the safe text `the rules channel`.

`{staffRole}` uses an explicitly stored staff-role ID, the first configured moderator role, or a conventional Staff/Moderator/Admin/Support role, otherwise the safe text `the staff team`.

## Destination fallback and duplicate prevention

For a configured welcome system, delivery is attempted in this order:

1. Configured welcome channel.
2. Guild system channel when it is different and usable.
3. Direct message to the joining member.

A guild channel is usable only when it is text-based and CURSED has View Channel, Send Messages and Embed Links. Attach Files is optional: when absent, CURSED sends the embed without a card.

The delivery function returns immediately after the first successful send. A failed configured-channel send can continue to the system channel, but a successful send never proceeds to another channel or DM.

## Remote image safety

Member avatars, server icons and custom card backgrounds are fetched through one bounded loader.

Safeguards:

- HTTP and HTTPS only;
- no URL credentials;
- localhost and `.local` hosts blocked;
- private, loopback, link-local, carrier-grade NAT and multicast IP destinations blocked;
- DNS answers checked before fetch;
- redirects handled manually and revalidated, maximum three;
- five-second request timeout;
- image MIME type required;
- eight-megabyte default response limit;
- streamed responses stopped when the byte limit is exceeded;
- failures return `null`, allowing the normal gradient/avatar fallback instead of crashing the welcome.

## Dashboard compatibility

The dashboard welcome API keeps its existing request and response field set. It accepts the expanded card-theme identifiers for Premium guilds and still forces Free guilds to embed-only/classic settings.

No dashboard response field was added, removed or renamed.

## Focused regression coverage

Run:

```bash
npm run test:welcome
```

The suite covers:

- all eight requested themes plus legacy Midnight;
- Premium card restriction;
- private/local image URL rejection;
- MIME and byte-size limits;
- all placeholders;
- title, description and footer replacement;
- old configuration defaults;
- configured-channel success;
- system-channel fallback;
- DM fallback;
- permission failures;
- failed-send fallback;
- embed-only fallback without Attach Files;
- duplicate-send prevention;
- dashboard response-shape preservation.

## Railway verification

1. Confirm the deployment completes and CURSED logs in normally.
2. Confirm there are no `Welcome`, canvas, DNS, MongoDB or slash-registration startup errors.
3. In a Premium test server, save each supported theme through the existing dashboard/API flow and run `/welcome test`.
4. Confirm Classic, Modern, Minimal, Glass, Dark, Purple, Neon, Gold and an existing Midnight configuration render.
5. Confirm the card contains the member avatar, server icon, server name, display name and member number.
6. Test a welcome message and footer containing all placeholders.
7. Temporarily remove Attach Files while retaining Send Messages and Embed Links; confirm one embed-only welcome is sent.
8. Configure a deleted or inaccessible welcome channel; confirm the system channel receives exactly one welcome.
9. Make both configured and system channels unusable; confirm the joining member receives one DM.
10. Restore the configured channel; confirm the system channel and DM do not receive duplicates.
11. Use a localhost/private background URL and an oversized image URL; confirm the card falls back safely and the bot remains online.
12. Test a non-Premium server and confirm the Premium card remains unavailable while the embed still sends.
13. Restart Railway and confirm welcome settings remain in `guildConfigs`.
14. Smoke-test AI chat, economy, profiles, pets, Premium, tickets, moderation, birthdays and the dashboard API.

## Rollback

Revert the PR. No MongoDB collection is deleted or redesigned, and existing guild settings remain compatible.
