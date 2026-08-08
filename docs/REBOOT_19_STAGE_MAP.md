# CURSED Reboot — 19 Stage Implementation Map

Branch: `REBOOT-1`

This map translates Reboot A–H into nineteen concrete engineering stages. The code stage can be complete while production promotion still requires green CI and test-server validation for destructive moderation/security flows.

1. **Product hierarchy** — Reduce the public surface to Server Management, AI & Creative, Community, Economy & Games, and Utilities.
2. **Shared presentation** — Use one restrained response system for colors, status markers, fields, footers, and safe mentions.
3. **Unified prefix pipeline** — Resolve configured/default legacy prefixes through one dispatcher with timing and concise failures.
4. **Professional Help** — Section → category → command progressive disclosure with permissions, syntax, examples, and search.
5. **Status, Doctor, and permissions** — Add public status plus Manage Server diagnostics with a least-privilege permission contract; Administrator is not required.
6. **Moderation authorization** — Centralize moderator access, target hierarchy, bot permission, and reason validation.
7. **Advanced moderation safety** — Keep purge/lock/slowmode/nickname/tempban/softban/note/history predictable and permission-safe.
8. **Cases and operational logs** — Keep case history consistent and isolate completed Discord actions from secondary logging failures.
9. **Audit-log attribution** — Resolve likely actors conservatively with bounded retries, target/recency matching, and duplicate suppression.
10. **Anti-Raid and Message Shield** — Apply risk settings, bounded runtime state, and one clear owner for rapid/repeated spam punishment.
11. **Anti-Nuke, quarantine, lockdown, recovery** — Prefer fast defensive response, scoped trust, safe recovery, and explicit incident controls.
12. **AI provider architecture** — Keep Gemini → Groq → OpenRouter in a separated provider-client/reliability layer.
13. **AI reliability and privacy** — Respect Retry-After, deadlines, cooldowns, fallbacks, and latency metrics without logging conversations or secrets.
14. **Community systems** — Keep Welcome, Tickets, Leveling, Birthdays, Profiles, and Custom Roles while standardizing their operator/member UX.
15. **Economy and shop** — Preserve balances and features while standardizing economy, advanced economy, rotating shop, inventory, quests, and leaderboards.
16. **Games lifecycle** — Bound active sessions and collectors so abandoned games expire instead of growing memory indefinitely.
17. **Predictable battle execution** — Keep combat local during rounds instead of serial AI network calls; AI is optional flavor, not a battle dependency.
18. **Persistence and restart safety** — Preserve hardened short-term memory/economy caches, Mongo-first long-term memory, and restart-safe scheduled moderation state.
19. **Isolation and validation** — Reboot CI is branch-only, blocks dashboard/API/deployment changes, checks syntax, locks feature families, and reruns memory/AI/welcome/runtime/owner regressions.

## Promotion gate

Do not merge or deploy `REBOOT-1` as production only because the implementation is large or compiles. Promotion requires a final branch diff review, green automated checks, test-server validation of high-risk moderation/security actions, restart tests for persisted systems, and explicit approval to promote the branch.
