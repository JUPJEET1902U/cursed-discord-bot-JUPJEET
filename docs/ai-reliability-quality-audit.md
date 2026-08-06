# CURSED AI reliability and conversation-quality audit

## Scope

This audit hardens CURSED's existing AI conversation pipeline without changing its public commands, English-only policy, personalities, Premium limits, AI cooldowns, MongoDB memory architecture, Discord channel restrictions, mention safety, economy, games, image generation, welcome system, moderation, tickets, birthdays, dashboard response shapes, or deployment topology.

The provider order remains:

1. Gemini
2. Groq
3. OpenRouter

Intent-specific provider ordering already used by CURSED remains supported. Missing provider keys continue to cause that provider to be skipped.

## Existing architecture

`utils/ai.js` owns the public AI facade and final orchestration. `utils/aiProviderReliability.js` owns provider health, timeouts, retries and statistics. `utils/aiConversationQuality.js` owns request-time memory selection and follow-up continuity. The previous implementation is retained as `utils/aiLegacy.js` only to preserve the established provider-client construction and safe defaults while the new facade uses the same configured clients. The Discord message handler in `index.js` waits for one completed `callAI()` result and sends one final reply. Provider retries, fallback attempts and quality-repair attempts do not directly send Discord messages.

Before this change, the pipeline had:

- a per-provider timeout;
- at most one retry;
- Gemini/Groq/OpenRouter fallback;
- empty-response detection;
- response-quality repair;
- basic provider success/failure/retry counters;
- relevance scoring for long-term memory;
- recent conversation compaction.

## Risks found

### Fixed retry timing

Retryable failures waited a nearly fixed delay. HTTP `Retry-After` and provider rate-limit reset headers were ignored. This could retry too early after a 429 response and waste the limited total response window.

### No provider health state

A provider that repeatedly returned HTTP 429, timed out, or produced 5xx errors was attempted again on every new request. That increased latency and repeated avoidable failures instead of temporarily routing traffic to the next configured provider.

### No chain-wide deadline

Each provider attempt had a timeout, but retries, fallbacks and quality repair did not share one total deadline. A request could therefore remain active for much longer than one provider timeout.

### Limited observability

Provider statistics did not distinguish rate limits, timeouts, empty responses, 5xx failures, fallback use, cooldown skips or latency. Diagnosing Gemini 429 problems required reading raw logs rather than inspecting structured health state.

### Irrelevant memory fallback

When no memory item passed the relevance threshold, the previous code still injected the two highest-ranked memories. Those memories could be important in general but unrelated to the user's current question.

### Short follow-up ambiguity

Messages such as `why?`, `what?`, `continue`, `explain`, `how?` and `tell me more` contain too little vocabulary for normal intent classification. Without explicit continuity guidance, a provider could restart the topic, ask an unnecessary clarification or answer the word in isolation.

## Reliability changes

### Exponential retry with provider guidance

Retry delays now combine:

- exponential backoff;
- bounded jitter;
- `Retry-After` seconds;
- `Retry-After` HTTP dates;
- `retry-after-ms`;
- `x-ratelimit-reset-after`;
- `x-ratelimit-reset`.

Provider guidance takes precedence when it requests a longer safe delay. Retry delays are bounded, and a retry is skipped when there is insufficient time remaining in the total request deadline.

### Provider cooldown circuit breaker

Each provider has process-local health state:

- consecutive transient failures;
- cooldown-until timestamp;
- cooldown count;
- automatic health reset after a successful response.

HTTP 429, timeout and 5xx failures contribute to the transient-failure threshold. Once reached, the provider enters a bounded cooldown. New requests skip it and continue to the next configured provider. When the cooldown expires, the provider is automatically eligible for a probe request; no restart or manual reset is required.

Cooldown state is intentionally process-local. It represents live provider health and should reset when Railway starts a new process.

### Shared total deadline

One deadline now covers:

- initial provider attempts;
- retry waits;
- provider fallback;
- quality repair.

A provider's individual timeout is clipped to the remaining total time. The OpenAI request receives an abort signal, and the local timeout aborts the attempt where supported. The default total deadline is 45 seconds and can be safely overridden.

### Railway model configuration

The existing models remain safe defaults. Railway can override them without a code change:

```text
AI_GEMINI_MODEL
AI_GROQ_MODEL
AI_OPENROUTER_MODEL
```

Compatibility aliases are also accepted:

```text
GEMINI_MODEL
GROQ_MODEL
OPENROUTER_MODEL
```

No model variable is required. Blank values use the existing defaults.

### Optional reliability variables

All variables are optional and bounded in code:

```text
AI_PROVIDER_TIMEOUT_MS
AI_TOTAL_TIMEOUT_MS
AI_RETRY_BASE_DELAY_MS
AI_RETRY_MAX_DELAY_MS
AI_PROVIDER_COOLDOWN_MS
AI_PROVIDER_COOLDOWN_MAX_MS
AI_PROVIDER_FAILURE_THRESHOLD
```

Defaults:

- provider timeout: 25 seconds;
- total request deadline: 45 seconds;
- retry base delay: 500 milliseconds;
- retry maximum delay: 8 seconds;
- provider cooldown: 30 seconds;
- maximum cooldown: 5 minutes;
- transient failures before cooldown: 2.

### Provider statistics

`getStatus()` keeps the existing configured-provider and last-used fields and adds safe operational data for each provider:

- successful final responses;
- failed provider chains;
- failed attempts;
- retries;
- fallback attempts and successes;
- cooldown skips;
- HTTP 429 count;
- timeout count;
- empty-response count;
- 5xx count;
- other-error count;
- cooldown count;
- total, average and last latency;
- last success and failure timestamps;
- redacted last error;
- current health and cooldown time remaining.

No API key, token, request content, system prompt or user memory is exposed.

## Conversation-quality changes

### Relevant memory only

Memory ranking still considers overlap, importance, confidence and recency. However, a memory is now injected only when the current user input has actual token overlap or a meaningful direct text match. When no item is relevant, the entire long-term-memory block is removed from that request instead of injecting unrelated fallback facts.

Stored memory is not deleted or rewritten. This is request-time selection only, and new explicit user corrections still override old memory.

### Short follow-up continuity

The intelligence layer now recognizes concise follow-up classes:

- continue;
- why;
- how;
- clarify/explain;
- expand/tell me more.

For these messages, CURSED inherits the prior user topic's intent where possible and adds a concise continuity instruction. The provider is told to continue the existing topic rather than restart, repeat the full answer or interpret the short word in isolation.

Conversation history, stored-message limits and Premium memory limits remain unchanged.

## Duplicate-reply safety

The AI orchestration layer remains transport-independent and contains no Discord send/reply call. Retries, fallback and quality repair return only one final result or throw one final error. `index.js` continues to send after `await callAI(...)` resolves, while its catch branch sends only when that call fails.

A focused source-contract test protects this boundary so future provider work cannot accidentally emit intermediate Discord replies.

## Files changed

```text
utils/ai.js
utils/aiLegacy.js
utils/aiProviderReliability.js
utils/aiConversationQuality.js
test/ai-reliability.test.js
docs/ai-reliability-quality-audit.md
package.json
```

No provider key, prompt policy, command handler, Premium plan, cooldown module, MongoDB model, memory store, dashboard API, economy rule, welcome flow, moderation action, ticket system, birthday system or image-generation file is changed. `utils/aiLegacy.js` is an exact Git blob copy of the pre-PR `utils/ai.js`; it is not independently edited.

## Regression coverage

Run:

```bash
npm run test:ai-reliability
```

The focused provider-stubbed tests cover:

- Railway model overrides and safe defaults;
- Retry-After seconds, dates and millisecond headers;
- exponential retry delay and jitter;
- repeated 429 failures opening provider cooldown;
- cooldown skipping and automatic fallback;
- provider latency, empty-response and fallback statistics;
- one deadline across retry, fallback and repair;
- removal of irrelevant memory;
- retention of relevant memory;
- intent inheritance for short follow-ups;
- continuity guidance for `continue` and `explain`;
- absence of Discord sends inside AI orchestration;
- one final Discord delivery after `callAI()`;
- preservation of English-only prompts, Premium limits, MongoDB memory and default provider order;
- package test-script registration.

## Railway verification

After merging:

1. Confirm Railway deploys and CURSED logs in normally.
2. Leave the new model variables unset first and confirm the existing default models are reported by the owner AI status command.
3. Send ordinary casual, factual, technical and reasoning messages and confirm Gemini/Groq/OpenRouter ordering still follows the existing intent configuration.
4. Trigger or observe a Gemini HTTP 429. Confirm the log respects Retry-After when supplied, retries only within the total deadline, then falls back without sending an intermediate Discord reply.
5. Repeat transient Gemini failures until cooldown opens. Confirm subsequent requests skip Gemini and reach Groq/OpenRouter more quickly.
6. After the cooldown expires, confirm Gemini is automatically attempted again and a success clears its transient-failure state.
7. Temporarily use a deliberately small `AI_TOTAL_TIMEOUT_MS` in a controlled test deployment and confirm the whole chain ends near that deadline rather than multiplying provider timeouts. Restore the normal value afterward.
8. Check provider status statistics for rate limits, timeouts, empty responses, fallback attempts, latency and cooldown state. Confirm no secret or message content appears.
9. Hold a conversation and send `why?`, `what do you mean?`, `continue`, `how?`, `explain` and `tell me more`. Confirm CURSED continues the preceding topic without restarting it.
10. Ask about a topic unrelated to stored personal memories and confirm unrelated facts do not appear. Then ask about a genuinely matching stored fact and confirm relevant memory can still be used.
11. Confirm each AI message produces exactly one Discord reply during normal success, provider fallback, quality repair and final failure.
12. Confirm English-only behavior, all personalities, Premium AI cooldowns, short-term memory, long-term MongoDB memory, channel restrictions and mention sanitization remain unchanged.
13. Smoke-test AI-backed fun, pet, battle, image-prompt, welcome and long-term-memory helper calls.

## Rollback

Revert this PR. Provider health and statistics are process-local, no MongoDB migration is performed, and no stored memory or Premium data is modified.
