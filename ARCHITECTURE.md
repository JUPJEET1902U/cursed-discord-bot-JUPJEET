# CURSED Bot — Architecture Documentation

## Overview

CURSED is a Discord.js v14 bot with AI chat, economy, gambling, pets, moderation, and more. This document describes the v2.0 architecture.

## Directory Structure

```
cursed-discord-bot/
├── index.js                    # Entry point — client setup, handler loading, login
├── webhook.js                  # Express webhook server (Ko-fi, Patreon, BMC)
├── package.json
├── .env.example                # Environment variable template
│
├── config/
│   └── constants.js            # ALL constants: colors, cooldowns, shop items, etc.
│
├── database/
│   └── Database.js             # JSON file abstraction with caching & backups
│
├── handlers/
│   ├── commandHandler.js       # Loads and routes prefix commands
│   └── eventHandler.js         # Loads and registers Discord event handlers
│
├── events/
│   ├── ready.js                # ClientReady — startup logic
│   ├── messageCreate.js        # MessageCreate — message routing
│   ├── interactionCreate.js    # InteractionCreate — slash commands
│   ├── guildCreate.js          # GuildCreate — welcome message
│   ├── guildMemberAdd.js       # GuildMemberAdd — role assignment + welcome
│   └── error.js                # Error — client error logging
│
├── commands/
│   ├── economy.js              # !daily, !balance, !rank, !give, !richlist, !levels, !shop, !buy
│   ├── fun.js                  # !roast, !imagine, !meme, !trivia, !story, !roleplay, !challenge, !fortune, !forget
│   ├── gambling.js             # !gamble, !coinflip, !slots
│   ├── quests.js               # !quests, !claimquests
│   ├── achievements.js         # !achievements
│   ├── pets.js                 # !adopt, !mypet, !feedpet, !petplay, !petsay
│   ├── profiles.js             # !profile, !setprofile, !clearprofile
│   ├── premium.js              # !premium, !verify, !setpremiumrole, !setpayment, !gencode, !givepremium, !addchannel, !removechannel, !channels
│   ├── moderation.js           # /warn, /warnings, /clearwarns, /mute, /unmute, /kick, /ban + prefix admin commands
│   ├── stats.js                # !ping, !uptime, !stats, !botinfo
│   └── help.js                 # !help, !help [command]
│
└── utils/
    ├── ai.js                   # Raw AI provider calls (Groq + Gemini with fallback)
    ├── aiHelper.js             # Centralized AI wrapper with logging & sanitization
    ├── antiSpam.js             # Anti-spam message tracking
    ├── automod.js              # Auto-moderation (anti-link, anti-invite, anti-spam)
    ├── commandUtils.js         # Shared command helpers (announceAchievements, etc.)
    ├── cooldowns.js            # Per-user command cooldowns + rate limiting
    ├── economy.js              # Economy data access (XP, coins, achievements, quests)
    ├── embedBuilder.js         # Standardized Discord embed creation
    ├── errorHandler.js         # Global error handlers + graceful shutdown
    ├── inputValidator.js       # Input sanitization, @mention prevention, validation
    ├── logger.js               # Structured leveled logging with ANSI colors
    ├── memory.js               # Per-user conversation memory (AI context)
    ├── modlog.js               # Mod-log channel embed sender
    ├── pets.js                 # Pet data access
    ├── premium.js              # Premium code generation and verification
    ├── profiles.js             # User AI personality profiles
    ├── roast.js                # Roast leaderboard data
    ├── serverConfig.js         # Per-guild configuration (channels, automod, etc.)
    ├── state.js                # In-memory shared state (active trivia answers)
    ├── timeFormatter.js        # Duration and date formatting utilities
    └── warnings.js             # Moderation warning records
```

## Data Flow

```
Discord Message
    │
    ▼
events/messageCreate.js
    │
    ├─► runAutoMod()          — delete spam/links/invites
    ├─► moderationCmd.handlePrefixCommand()  — admin config commands
    ├─► isChannelAllowed()    — channel allow-list check
    │
    ▼
handlers/commandHandler.js
    │
    ├─► commands/premium.js
    ├─► commands/fun.js
    ├─► commands/economy.js
    ├─► commands/gambling.js
    ├─► commands/quests.js
    ├─► commands/pets.js
    ├─► commands/profiles.js
    ├─► commands/achievements.js
    ├─► commands/stats.js
    └─► commands/help.js
    │
    ▼ (if no command matched)
AI Chat (utils/aiHelper.js → utils/ai.js → Groq/Gemini)
```

## Configuration

All constants are centralized in `config/constants.js`:

| Constant Group | Description |
|---|---|
| `BOT` | Bot name, prefix, version |
| `COLORS` | Embed color palette |
| `EMOJIS` | All emoji constants |
| `COOLDOWNS` | Per-command cooldown durations (ms) |
| `RATE_LIMIT` | AI message rate limiting |
| `ANTI_SPAM` | Anti-spam thresholds |
| `AI` | Model names, token limits |
| `ECONOMY` | Daily rewards, XP ranges, pet costs |
| `SHOP` | Shop item definitions |
| `ACHIEVEMENTS` | Achievement definitions |
| `QUEST_POOL` | Daily quest pool |
| `PET_TYPES` | Pet type definitions |
| `PROMPTS` | AI system prompts |
| `SLOTS` | Slot machine configuration |
| `GAMBLING` | Gambling win rates |
| `FILES` | JSON data file paths |
| `MODERATION` | Mod action colors and emojis |

## Database

The bot uses JSON files for persistence, abstracted through `database/Database.js`:

| Store | File | Contents |
|---|---|---|
| `economy` | `economy.json` | User coins, XP, levels, achievements, quests |
| `memory` | `memory.json` | Per-user AI conversation history |
| `pets` | `pets.json` | User pet data |
| `profiles` | `profiles.json` | User AI personality profiles |
| `warnings` | `warnings.json` | Moderation warnings per guild |
| `serverConfig` | `serverConfig.json` | Per-guild bot configuration |
| `premiumCodes` | `premiumCodes.json` | Generated premium codes |
| `roastCounts` | `roast_counts.json` | Roast leaderboard counts |

Backups are created automatically every 30 minutes in the `backups/` directory.

## Security

- All user input is sanitized via `utils/inputValidator.js`
- `@everyone` and `@here` mentions are neutralized in all user-facing content
- AI output is sanitized before sending to Discord
- Admin commands require `Administrator` or `ManageGuild` permission
- Moderation commands require `ModerateMembers` permission
- Rate limiting: 8 AI messages per user per 60 seconds
- Per-command cooldowns prevent spam

## Logging

Structured logging via `utils/logger.js`:

```
12:34:56.789 [INFO ] [Startup] Connecting to Discord...
12:34:57.123 [INFO ] [Ready]   Logged in as CURSED#1234
12:34:57.456 [INFO ] [CMD]     [My Server] #general | JohnDoe: !daily
12:34:57.789 [INFO ] [AI]      [groq] Here's your daily reward...
12:34:58.000 [WARN ] [AI]      Groq rate limited (1), switching to Gemini
12:34:58.500 [ERROR] [Economy] Save error: ENOENT: no such file
```

Set `LOG_LEVEL=DEBUG` in your `.env` for verbose output.

## Environment Variables

See `.env.example` for all available environment variables.

Required:
- `BOT_TOKEN` — Discord bot token
- `GROQ_KEY` — Groq API key

Optional:
- `GEMINI_KEY` — Gemini fallback AI
- `HF_TOKEN` — Hugging Face (image generation)
- `MONGO_URI` — MongoDB (optional, bot works without it)
- `PORT` — Webhook server port (default: 3000)
- `LOG_LEVEL` — Logging verbosity (default: INFO)
- `MOD_LOG_CHANNEL_ID` — Mod-log channel
- `DEFAULT_ROLE_ID` — Auto-assign role for new members

## Adding New Commands

1. Create or edit a file in `commands/`
2. Export a `handle(message)` function that returns `true` if handled
3. Register it in `handlers/commandHandler.js` COMMAND_MODULES array
4. Add metadata to `commands/help.js` COMMANDS object

## Adding New Events

1. Create a file in `events/` exporting `{ name, once, execute }`
2. Register it in `handlers/eventHandler.js` EVENT_MODULES array
