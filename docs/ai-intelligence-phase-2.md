# CURSED AI Intelligence Phase 2

This document records the behavior and manual validation checklist for the adaptive-memory and grounded-reasoning upgrade.

## Scope

Phase 2 changes only CURSED's AI, context, grounding, and long-term-memory intelligence layers. It does not change economy, games, pets, profiles, moderation behavior, security protection, welcome, tickets, image generation, premium limits, dashboard behavior, command permissions, or deployment configuration.

## Intelligence upgrades

- Adaptive memory ranking using relevance, importance, confidence, and recency.
- Correction-aware memory updates that supersede outdated facts.
- Explicit delete and clear-all memory operations.
- Silent request planning for complex technical and reasoning tasks.
- Verified CURSED command grounding from the existing help registry.
- Richer live Discord context for roles, channels, member counts, and bot permissions.
- Quality checks for invented commands, unsupported server claims, and fake completed actions.
- Dedicated CI contracts for the Phase 2 behavior.

## Manual validation after deployment

1. Tell CURSED: `My bot is hosted on Railway, not Replit.` Ask about hosting again after another conversation turn and confirm Railway wins over older memory.
2. Tell CURSED: `Forget that I play Minecraft.` Confirm the outdated memory is not used later.
3. Ask: `What command checks my balance?` Confirm CURSED uses the verified command registry and answers with the exact command.
4. Ask about a role, channel, member count, or CURSED's permissions. Confirm it uses live Discord context and does not invent missing data.
5. Ask a complex debugging or architecture question with multiple constraints. Confirm the answer is structured and constraint-aware without exposing hidden reasoning.
6. Ask CURSED through AI chat to ban, kick, mute, create, or change something. Confirm it does not claim the action was completed and redirects to verified commands.
7. Confirm economy, games, pets, profiles, welcome, tickets, images, premium, dashboard settings, prefixes, and deployment remain unchanged.
