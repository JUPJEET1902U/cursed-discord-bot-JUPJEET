# CURSED Moderation Phase 3 — Safety Contract

- Phase 3 is additive. It does not remove or replace AI, economy, leveling, welcome, autorole, games, profiles, premium, or Phase 1–2 moderation.
- The Phase 3 bootstrap is guarded and isolated behind `utils/modlog.js`.
- Server Protection is disabled by default for existing guilds until an administrator enables it.
- Anti-nuke actions use recent matching Discord audit-log entries and ignore the server owner and CURSED itself.
- Anti-raid and anti-nuke responses default to alert-only.
- Quarantine requires MongoDB before changing roles and stores the original restorable role list.
- Emergency lockdown stores exact `@everyone` channel permission states before changing them and restores those values on release.
- Failed quarantine and lockdown applications attempt rollback and report a failed state instead of continuing silently.
- The new dashboard API uses the existing server-to-server secret, strict validation, origin checks, and rate limiting.

## Dashboard impact

- Required: Yes
- Bot API updated: Yes
- Dashboard UI updated: Yes, in the coordinated dashboard PR
- Reason: anti-raid, anti-nuke, quarantine, lockdown, granular trust scopes, and incident handling are administrator-configurable.
