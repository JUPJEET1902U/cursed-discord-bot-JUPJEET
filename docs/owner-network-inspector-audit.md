# CURSED Owner Network Inspector audit

## Scope

This feature upgrades CURSED's existing bot-owner server visibility into a private owner-only network inspection system. It does not add a public server directory, dashboard endpoint, slash command, moderation capability, persistence model, or new Discord permission requirement.

The commands are:

```text
!botservers [page]
!servers [page]
!serverinfo <server-id>
!servermembers <server-id> [page]
!serverinvite <server-id>
!networkhelp
```

## Authorization model

Every command in `commands/ownerNetwork.js` is gated only by `BOT_OWNER_IDS`.

Server ownership, Administrator permission, Manage Guild, moderator roles, Premium status, dashboard access, and guild configuration do not grant access to the inspector.

A non-owner receives only:

```text
This command is restricted to the CURSED bot owner.
```

No server name, ID, member information, invite URL, or other network data is included in the denial response.

## Privacy and output location

Sensitive inspector output is sent only through `message.author.send(...)` to the authenticated bot owner.

The channel where the command was invoked receives only a generic acknowledgement or a generic DM-delivery error. Member lists, server reports and invite URLs are never intentionally posted in the guild channel.

All DM payloads set `allowedMentions` to an empty allow-list. Server/member-controlled strings are sanitized for newlines, backticks and `@` before being inserted into reports.

Long reports are split below Discord's message-length limit before delivery.

## Server list

`!botservers [page]` and the legacy alias `!servers [page]` show six cached guilds per page with:

- server name;
- server ID;
- member count;
- cached owner name or owner ID;
- cached channel count;
- cached role count.

The list does not create or expose invites. Full details require `!serverinfo <server-id>`.

The new owner-network command module is registered before the existing admin module so the richer implementation handles the legacy `!botservers` and `!servers` names without deleting the previous fallback code.

## Server detail

`!serverinfo <server-id>` resolves only a guild CURSED is currently connected to and reports:

- server name and ID;
- fetched owner identity where available;
- member count;
- cached human/bot breakdown;
- creation time;
- CURSED join time;
- channel breakdown;
- role, emoji and sticker counts;
- boost count and tier;
- verification level;
- preferred locale;
- description;
- selected guild features;
- icon and banner URLs;
- cached vanity URL when already available.

No MongoDB data or server configuration is changed.

## Member inspection

`!servermembers <server-id> [page]` attempts an on-demand `guild.members.fetch()` using CURSED's existing Guild Members intent.

If Discord returns the complete guild member set, the command paginates it. If the fetch fails or Discord returns only a partial set, CURSED falls back to the current cache and labels the report as partial.

Member pages include display name, username/tag, user ID and bot status. Humans sort before bots, with alphabetical ordering inside each group.

No member data is persisted by this feature.

## Invite behavior

`!serverinvite <server-id>` is intentionally explicit and separate from the server list/detail commands.

The command follows this order:

1. If the guild already exposes a vanity URL code to CURSED, return the vanity URL and create nothing.
2. Otherwise, find a channel where CURSED already has both View Channel and Create Instant Invite.
3. Create a unique invite with:
   - maximum age: 1 hour;
   - maximum uses: 1;
   - audit-log reason: `CURSED owner network inspector request`.
4. DM the URL only to the configured bot owner.

The inspector does not reuse hidden existing admin invites and does not attempt to bypass Discord permissions. If CURSED lacks Create Invite permission, the command reports that the invite is unavailable.

## Discord and deployment requirements

No new environment variable is required. `BOT_OWNER_IDS` remains the source of owner authorization.

The bot already uses the Guild Members gateway intent in `index.js`; Discord's privileged Server Members Intent must remain enabled for the application if complete large-server member fetching is expected.

No Railway start command, health route, MongoDB collection, Vercel setting, API key or dashboard configuration is changed.

## Regression coverage

Run:

```bash
npm run test:owner-network
```

The focused suite checks:

- BOT_OWNER_IDS-only authorization;
- non-owner denial without a DM;
- DM-only owner help flow;
- Discord-safe message chunking;
- private server list content;
- detailed server report formatting and sanitization;
- member sorting and pagination;
- vanity-link behavior without invite creation;
- permission-gated invite creation;
- one-use/one-hour invite constraints;
- audit-log reason;
- refusal when Create Invite permission is unavailable;
- command-loader precedence ahead of the legacy admin handler;
- package test-script registration.

A dedicated `Owner Network Inspector CI` workflow runs syntax checks and the focused suite on pull requests that touch this system.

## Railway verification

After merging:

1. Confirm Railway deploys and CURSED logs in normally.
2. Run `!networkhelp` from the BOT_OWNER_IDS account and confirm the command details arrive only by DM.
3. Run `!networkhelp` from a different administrator account and confirm it receives only the owner-restricted denial.
4. Run `!botservers` and confirm server names, IDs, members, channels and roles arrive only in the owner's DMs.
5. Run `!serverinfo <id>` for a known server and validate owner, counts, dates, boost data and media URLs.
6. Run `!servermembers <id> 1`; confirm members are paginated and bots are marked.
7. Try a later member page and confirm page clamping is safe.
8. On a server with a vanity URL, run `!serverinvite <id>` and confirm no new invite is created.
9. On a test server where CURSED has Create Invite permission, run `!serverinvite <id>` and verify the created invite expires after one hour and one use.
10. Confirm the invite creation appears in the server audit log with the CURSED inspector reason.
11. Remove Create Invite permission in a test server and confirm the command reports the invite as unavailable.
12. Confirm no sensitive server/member/invite output appears in the command channel.
13. Smoke-test `!botstats`, `!aistats`, `!givecoins` and other admin commands to confirm the new module precedence did not affect them.

## Rollback

Revert this PR. The feature stores no data and creates no background jobs. Any one-use invites already created by an explicit owner command remain governed by Discord's one-hour expiry and one-use limit.
