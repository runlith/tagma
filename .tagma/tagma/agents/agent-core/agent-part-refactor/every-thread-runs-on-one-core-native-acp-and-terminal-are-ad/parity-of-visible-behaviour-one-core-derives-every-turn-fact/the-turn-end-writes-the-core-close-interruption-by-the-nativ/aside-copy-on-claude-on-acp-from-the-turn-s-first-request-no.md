---
id: 01a14cba-e095-7bcb-bb6f-608377722519
title: Aside copy on Claude on ACP from the turn's first request, not its end
ord: 1
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
Question: can Claude on `acp` give an aside copy from the turn's first request, like native, instead of only at the turn end ([[f3949b43]])?

Answer: yes. The solution went into [[45d13bf3]]: the session copy is offered on the turn's first `measured`.

## Measurement

Two runs, 2026-10-18. Scripts lived in a temp folder outside the repo, the Tagma server untouched.

**Conditions:**
- `claude` 2.1.302, `@anthropic-ai/claude-agent-sdk` 0.3.292 (the one in `apps/tagma/server`);
- `haiku` model (`claude-haiku-5-5`), operator's CLI login;
- `query()` with streaming input, `includePartialMessages`, `settingSources: []`, `tools: ['Bash']`, `bypassPermissions`;
- side question — `Query.askSideQuestion(question)`, as the runner calls it (`runner/claude/aside.ts`).

**What was measured** — each value once:

| Moment of question | Answer | Time | Turn |
|---|---|---|---|
| idle after the first turn | correct (`PELICAN-42`) | 1.63 s | — |
| mid-turn: `sleep 20` running in Bash | correct | 1.12 s; answer arrived 23 s before the turn end | ended `success`, output `DONE` |
| mid-turn: model streaming a long answer (the request ran 32.8–40.3 s) | correct | 2.71 s; answer arrived before the request end | ended `success`, full output |
| first turn of a fresh session, right after the first request's `message_start` | named the project from this turn's words | 1.29 s | ended `success` |
| same turn, mid-tool | named the project and this turn's call | 1.68 s | — |

- **Transcript.** After the turn `getSessionMessages` holds no questions (0 of 9 and 0 of 5 records).
- **Event stream.** The main request shows no extra `message_start`. The SDK sends `system/control_request_progress` with `status: started`.
- **Price** — the `usage_EXPERIMENTAL…` difference before and after the question. At idle: input without cache +426, cache reads +29,425, writes +1,331, output +9, $0.00051. Mid-tool: +463, +30,824, +100, +9, $0.00037. For questions mid-streaming and in the first turn the difference is not separated from the live turn.
- **`costBasis`** in `modelUsage` — `list`.

**Derived, not measured:**
- the question reads the same prefix-cache as the turn: cache reads near 30 thousand, comparable to the session prefix;
- that the live turn is not delayed rests on its time and full answer, not on a comparison against a run with no question.

**The measurement does not establish:**
- behaviour on sonnet and opus and with a large history;
- behaviour under an API key instead of a subscription;
- repeatability: each moment is one sample;
- that `askSideQuestion` will stay in the SDK: its types do not declare the method, the runner calls it as undeclared.
