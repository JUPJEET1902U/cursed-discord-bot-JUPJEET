// ── API ────────────────────────────────────────────────────────────────────────
export const API_BASE =
  'https://cursed-discord-bot-jupjeet-production.up.railway.app/api'

// ── Discord CDN ────────────────────────────────────────────────────────────────
export const DISCORD_CDN = 'https://cdn.discordapp.com'

// ── Discord OAuth ──────────────────────────────────────────────────────────────
// In production the redirect URI is always derived from the current origin so
// it matches whatever domain the dashboard is deployed to (Vercel, custom, etc.).
// VITE_REDIRECT_URI can override this for local development only.
const _redirectUri =
  import.meta.env.DEV && import.meta.env.VITE_REDIRECT_URI
    ? import.meta.env.VITE_REDIRECT_URI
    : `${window.location.origin}/auth/callback`

export const DISCORD_OAUTH_URL = `https://discord.com/oauth2/authorize?client_id=${
  import.meta.env.VITE_DISCORD_CLIENT_ID
}&redirect_uri=${encodeURIComponent(_redirectUri)}&response_type=code&scope=identify+guilds`


// ── Personalities ──────────────────────────────────────────────────────────────
export const PERSONALITIES = [
  { value: 'cursed',    label: '👹 Cursed',    description: 'Default — helpful but roasts you' },
  { value: 'friendly',  label: '😊 Friendly',  description: 'Warm, supportive, and kind' },
  { value: 'savage',    label: '🔥 Savage',    description: 'Extreme roasting mode' },
  { value: 'anime',     label: '🌸 Anime',     description: 'Anime references and honorifics' },
  { value: 'pirate',    label: '🏴‍☠️ Pirate',   description: 'Salty sea dog speak' },
  { value: 'wise',      label: '🧙 Wise',      description: 'Philosophical and profound' },
  { value: 'developer', label: '💻 Developer', description: 'Tech jargon and coding humor' },
  { value: 'chaos',     label: '🌀 Chaos',     description: 'Unpredictable and unhinged' },
]

// ── Token limits ───────────────────────────────────────────────────────────────
export const TOKEN_OPTIONS = [
  { value: 150,  label: 'Short (150 tokens)' },
  { value: 300,  label: 'Medium (300 tokens)' },
  { value: 500,  label: 'Standard (500 tokens)' },
  { value: 800,  label: 'Long (800 tokens)' },
  { value: 1200, label: 'Very Long (1200 tokens)' },
]

// ── Colors ─────────────────────────────────────────────────────────────────────
export const BRAND_COLORS = {
  primary: '#FF4444',
  success: '#44FF88',
  warning: '#FFAA00',
  error: '#FF3333',
  info: '#00AAFF',
}

// ── Pagination ─────────────────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 10

// ── Session ────────────────────────────────────────────────────────────────────
export const SESSION_KEY = 'cursed_session'
export const GUILD_KEY = 'cursed_guild'
