# CURSED Moderation & Server Security Rebuild

## Scope lock

Only moderation and server-security systems may change in this branch.

Included:
- Manual moderation safety and hierarchy checks
- AutoMod and progressive enforcement
- Anti-raid detection and response
- Anti-nuke detection, automatic containment, and incident logging
- Quarantine and emergency lockdown
- Cases, evidence, staff notes, and audit logging
- Security health/preflight checks
- Moderation and security dashboard API contracts
- Focused tests and CI

Excluded:
- AI providers, prompts, memory, or chat
- Economy, games, quests, pets, profiles, or leveling
- Tickets
- Welcome or autorole
- Image generation
- Prefix behavior
- Deployment architecture
- Unrelated refactors

## Delivery gates

1. Existing moderation/security behavior mapped before replacement.
2. Dangerous actions fail closed when Discord permissions or hierarchy are insufficient.
3. Every automatic action records an incident and reports failures visibly.
4. Anti-nuke response neutralizes a manageable attacker before or together with lockdown.
5. Critical destructive-event thresholds support immediate response.
6. Trusted subjects remain scope-limited and auditable.
7. Dashboard exposes permission readiness and unsafe configuration warnings.
8. Existing non-moderation command modules remain unchanged.
9. Focused regression checks cover tickets, AI module loading, economy module loading, and prefix routing without modifying those systems.
10. PR remains unmerged until Railway and Vercel checks pass.
