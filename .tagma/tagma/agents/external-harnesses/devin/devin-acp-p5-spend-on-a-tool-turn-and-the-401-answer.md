---
id: 01a108dc-1b17-7a13-a0ce-eca0fe60d425
title: "Devin ACP P5: spend on a tool turn and the 401 answer"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "devin acp 3000.11.3, turns of 2026-10-04 on SWE-2 (Free, Pro account) + WINDSURF_API_KEY=invalid probe; frames probes/devin/s1.jsonl, s5auth.jsonl",
      "ref": "scratch 01a10407-8719-764b-9fac-8b1d83b24de9/probes/devin/"
    }
  }
---
# Devin ACP P5: spend on a turn with tools and the 401 answer

Live probe of `devin acp` 3000.11.3, 2026-10-04, on the P2–P3 walks (SWE-2 High/Medium) plus a separate probe with `WINDSURF_API_KEY=invalid` in the process environment. Raw frames: `probes/devin/s1.jsonl`, `s5auth.jsonl`.

## Measured

**Spend on a turn with tools arrives three ways, all live.** A turn with `mcp_list_tools` + `mcp_call_tool` (19,547 input / 36 output tokens): `usage_update` — several times per turn (after reasoning, mid-way, at the end), cumulative, `_meta {inputTokens, outputTokens, cachedReadTokens}`; each is duplicated with a `subagent_context {parentAgentId: "root"}` option. No cost fields in live frames. `turn_stats`: `responseDimensions` (agent_messages, model mark, input/output/cached tokens) with `turnClientMessageId`. `agent_stopped`: `stats {toolCalls, filesChanged, commandsRun, inputTokens, outputTokens, ttftMs, tokensPerSec, totalTimeMs, modelLabel, requestId}`. Prompt answer: `usage {totalTokens, inputTokens, outputTokens}` (+`cachedReadTokens`). `totalCreditCost`/`totalAcuCost` (here `0`/`0.0`, Free-family model on a Pro account) appear only in replay `usage_update` on `session/load`, never in live frames. `agent_message_chunk` chunks are cut arbitrarily (`fake` + `-secret-42`), `agent_thought_chunk` chunks are whole reasonings.

**401 answers on `session/new`, not on the turn.** With `WINDSURF_API_KEY=invalid` in the process env (saved login untouched): `session/new` → `-32603 "Failed to load team settings: Failed to fetch team settings: Authentication required: invalid api key (trace ID: …)"`. No session is created, no turn starts. The env key takes priority over saved credentials; after the probe `devin auth status` still said `Logged in (via Devin)`.

## Conclusion for the profile

`Harness.spent` is built from `usage_update`/`turn_stats`/`agent_stopped`; money cost is absent from live events (zeros only in replay after load). Exhausted quota was never checked live. A missing/invalid login is a `-32603` refusal on `session/new` with agent text: the driver maps it to `harness-login` with the `devin auth login` command; the turn never starts.
