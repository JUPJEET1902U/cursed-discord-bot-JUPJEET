# CURSED AI Intelligence Phase 3 — deployment checks

## Scope

Phase 3 changes only the main AI mention/reply pipeline. Prefix commands, slash commands, embeds, help pages, images, economy, games, moderation, welcome, tickets, premium, dashboard behavior, and deployment configuration are not character-limited by this change.

## Expected AI chat policy

- Every normal CURSED AI chat reply is 500 characters or fewer.
- The AI first attempts to produce a complete concise answer.
- If a provider exceeds the limit, the quality repair pass asks for a shorter answer.
- A deterministic sentence/word-boundary fallback guarantees the final reply remains within 500 characters.
- Explicit oversized requests such as 2,000-word essays receive a short limitation message and an offer for a concise version, outline, or key section.
- CURSED does not split an AI answer across multiple messages to bypass the limit.

## Manual Discord tests

1. Casual: `@CURSED yo, what is up?`
   - Expect a natural short answer under 500 characters.

2. Expert request: `@CURSED Debug my Discord.js permission error. Keep Railway, do not change economy, preserve existing commands, and give the safest fix.`
   - Expect a concise technical answer that respects each restriction.
   - The response must not reveal internal planning.

3. Oversized words: `@CURSED Write an essay of 2000 words about artificial intelligence.`
   - Expect a short message explaining that AI chat cannot provide that length.
   - It should offer a concise version, outline, or key section.

4. Oversized characters: `@CURSED Generate exactly 3000 characters about Discord bots.`
   - Expect the same graceful limitation behavior.

5. Allowed short writing: `@CURSED Write a 60-word paragraph about friendship.`
   - Expect the requested paragraph, provided the complete reply fits within 500 characters.

6. Command regression: run `!help`, `!balance`, `!profile`, and other normal commands.
   - Command output should remain unchanged.
   - Commands may use Discord's normal message limit and are not restricted to 500 characters.

7. Internal AI regression: use memory features and AI-powered commands such as roast/story where available.
   - Strict JSON memory extraction must remain unchanged.
   - Non-chat command behavior must remain unchanged.

## Railway checks

- Confirm the deployment uses the Phase 3 merge commit.
- Confirm normal startup with no syntax or missing-module errors.
- Confirm provider fallback remains Gemini, Groq, and OpenRouter according to the existing intent configuration.
- Confirm oversized requests return immediately through the local response policy without consuming a provider request.
