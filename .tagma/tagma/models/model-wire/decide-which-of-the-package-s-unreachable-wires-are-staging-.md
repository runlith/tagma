---
id: 01a0c8cb-04ab-7ce3-82f6-fcaac812dd0e
title: Decide which of the package's unreachable wires are staging and which are dead
ord: 19
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/llm/package.json
---
Five complete surfaces that no deployment binds, found by separate readings:
- **BedrockConverse** — named by no exports entry, no profile, `sigV4Auth` has zero callers workspace-wide, default auth refuses until configured. Uncallable end to end.
- **Gemini** — named by no exports entry, no profile; its route is bound only by the cache-policy suite.
- **`OpenAIChat.route`** — complete and bound only by suites (`origin-policy.test.ts`, `cache-policy.test.ts`); native OpenAI turns leave over Responses ([[b18d7a02]]). The header that named seven consumer vendors was stripped with the prose (verified 2026-09-26); no profile binds it, and `openai-compatible-chat` spreads its protocol but that route is itself bound by nothing.
- **Responses `webSocketRoute`** — bound by nothing ([[572e4b17]]).
- **`native.openaiCompatible.reasoning_content`** — the reasoning echo chain's middle link has no writer ([[ff7a88dc]]).

Each is shipped, tested in part, and costs reading time for everyone who meets it. The decision is one per surface: keep with a stated reason, or remove.