# CURSED Moderation Phase 2

## Safety contract

- Existing AI, economy, welcome, autorole, leveling, games, pets, profiles, premium, and Phase 1 moderation remain intact.
- Advanced commands are registered by a guarded bootstrap after existing slash-command registration.
- A Phase 2 initialization failure is logged and isolated from the rest of CURSED.
- Temporary-ban expiries are persisted in MongoDB and retried after restarts.
- Channel unlock restores the exact permission state captured before lock.
- Purge is capped by the per-guild dashboard setting and Discord's 100-message limit.
- The moderation whitelist can exempt trusted users, roles, channels, and bots from AutoMod and protect targets from manual punishments.

## Dashboard impact

- Required: Yes
- Bot API updated: Yes
- Dashboard UI updated: Yes, in the coordinated dashboard repository PR
- Reason: Phase 2 introduces administrator-configurable commands, logging, persistent tasks, case evidence, and whitelist protection.
