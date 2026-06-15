# 👹 CURSED Discord Bot

An AI-powered Discord bot with economy, gambling, pets, moderation, and more.

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your tokens

# 3. Start the bot
npm start
```

## Required Environment Variables

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Discord bot token |
| `GROQ_KEY` | Groq API key (primary AI) |

## Optional Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_KEY` | Gemini API key (AI fallback) |
| `HF_TOKEN` | Hugging Face token (image generation) |
| `MONGO_URI` | MongoDB URI (optional) |
| `PORT` | Webhook server port (default: 3000) |
| `LOG_LEVEL` | Log verbosity: DEBUG/INFO/WARN/ERROR |

## Features

- 🤖 **AI Chat** — Groq + Gemini with automatic fallback
- 💰 **Economy** — Coins, XP, levels, shop, daily rewards
- 🎲 **Gambling** — Gamble, coinflip, slots
- 📋 **Quests & Achievements** — Daily quests, 16 achievements
- 🐾 **Pets** — Adopt and care for AI-powered pets
- 👤 **Profiles** — Custom AI personalities
- 💎 **Premium** — Role-based premium with payment webhooks
- 🛡️ **Moderation** — Slash commands + auto-mod (anti-spam, anti-link, anti-invite)
- 📊 **Statistics** — !ping, !uptime, !stats, !botinfo

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full documentation.
