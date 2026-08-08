# CURSED UX Style Guide

This document defines the user-facing presentation standard for CURSED. It applies to commands, embeds, buttons, moderation responses, security alerts, help content, cooldowns, permission errors, and system notifications.

## Product voice

CURSED should sound confident, concise, and specific. It should not sound theatrical, over-excited, self-congratulatory, or like unrelated features were written by different systems.

Use normal sentence casing. Prefer one clear sentence over a paragraph when the user only needs a result. Explain the actual reason for failures whenever it is safe to do so.

Good:

- `❌ I can't manage that member because their highest role is above mine.`
- `✅ Quarantined ExampleUser • Case #184.`
- `🛡️ Incident mode active • 28 minutes remaining.`

Avoid:

- all-caps status text
- repeated punctuation
- decorative emoji chains
- phrases such as `ULTIMATE`, `ADVANCED SYSTEM ACTIVATED`, `SUCCESSFULLY NEUTRALIZED`, or similar marketing language inside operational responses
- internal architecture names such as `Phase 2`, `Phase 3`, or implementation-specific module names in normal user-facing text

## Emoji policy

Emoji are status indicators, not decoration.

Approved status indicators:

- `✅` success
- `❌` error
- `⚠️` warning
- `⏳` cooldown or waiting
- `🛡️` active security state

Do not prefix embed field names, every button, every category, or every line with an emoji. Embeds should normally rely on color, hierarchy, spacing, and concise labels.

## Embed standard

Use the shared primitives in `utils/responseBuilder.js` when practical.

- Footer brand: `CURSED`
- Security footer: `CURSED • Server Protection`
- Moderation footer: `CURSED • Moderation`
- Titles use normal capitalization
- Field names are short nouns: `User`, `Moderator`, `Reason`, `Case`, `Status`, `Details`
- Do not put emoji in field names by default
- Timestamps are appropriate for moderation, security, warnings, and other operational records

## Colors

The shared palette is defined in `utils/responseBuilder.js`.

- Primary / informational: Discord blurple
- Success: green
- Warning: yellow
- Error / critical security: red
- Neutral / disabled: grey or dark neutral

Feature-specific colors are allowed when they improve recognition, but they should not create a different visual language for every command.

## Plain responses

For short command outcomes, use one status icon followed by direct wording.

Preferred structure:

`<status> <result> • <important detail>`

Examples:

- `✅ Snapshot created • Nightly backup • ID: abc123`
- `❌ Missing permission. You need Manage Server to use this command.`
- `⏳ Cooldown active. Try again in 12s.`

## Permission errors

Permission errors must say what is missing. Do not use vague wording such as `You cannot do that` when the actual requirement is known.

## Moderation

Moderation responses should prioritize operational information:

1. action
2. target
3. duration when relevant
4. reason when relevant
5. case number when available

Moderation logs should use the same field names and visual structure across warnings, timeouts, kicks, bans, locks, quarantines, and AutoMod actions.

## Security

Security messaging should be serious and restrained.

Use `Security alert`, `Server protection`, `Incident mode`, `Lockdown`, and the established feature names. Avoid exaggerated threat language.

Never trade attribution safety or permission checks for presentation. Styling must remain independent from detection and response logic.

## Help center

The help center should behave like product navigation, not a promotional landing page.

- Title: `CURSED Help`
- Buttons use words instead of decorative emoji
- Categories use clean names
- Command details use consistent fields: `Syntax`, `Examples`, `Cooldown`, `Aliases`, `Permissions`, `Category`
- Do not advertise implementation phases or internal architecture

## Engineering rule

Presentation refactors must not change command names, permissions, persistence, moderation decisions, security thresholds, database models, deployment behavior, or feature availability unless a separate feature-specific change explicitly requires it.
