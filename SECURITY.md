# CURSED Security Policy

## Reporting a vulnerability

Do not post tokens, exploit details, private user data, or reproducible attack steps in a public issue. Contact the repository owner privately and rotate any potentially exposed secret immediately.

## Required production protections

- Enable two-factor authentication on Discord, GitHub, Railway, MongoDB Atlas, Vercel, and AI/payment providers.
- Keep `BOT_TOKEN`, database credentials, API keys, OAuth secrets, and webhook secrets only in platform secret stores.
- Use a `DASHBOARD_API_SECRET` of at least 32 random characters.
- Use payment webhook secrets of at least 24 random characters.
- Restrict the MongoDB user to the CURSED database and enable Atlas backups.
- Review repository, Railway, Vercel, and database collaborators regularly.
- Rotate the Discord bot token immediately if it appears in a screenshot, chat, log, commit, or support ticket.

## GitHub repository settings to enable manually

These settings cannot be delivered through a code pull request:

1. Protect `main` and require pull-request reviews.
2. Require the Security checks, CodeQL, and Dependency review workflows.
3. Enable secret scanning and push protection.
4. Enable private vulnerability reporting.
5. Restrict force pushes and branch deletion on `main`.

## Runtime behavior

- Optional payment routes return `503` when their verification secret is missing or too short; the Discord bot remains online.
- The dashboard API returns `503` when its shared secret is not securely configured; the Discord bot remains online.
- Duplicate payment webhook deliveries are blocked in-process for 24 hours.
- Fatal uncaught exceptions cause a non-zero process exit so Railway can start a clean instance.
- The public `/health` endpoint intentionally exposes only `{ "status": "ok" }`.
