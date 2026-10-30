---
id: 01a108ea-e26c-73a7-bfdb-11e9fa33bed1
title: "Claude SDK P5: turn usage with a tool — usage summed over calls, cost cumulative, rate_limit_event once per query; interrupted-turn and compaction usage undercounted"
ord: 8
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Claude Agent SDK probe: result, modelUsage, total_cost_usd and rate_limit_event fields on turns with an MCP tool, interruption and /compact",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284, CLI 2.1.289, Bun 1.4.2, claude-haiku-4-5, Claude Max; 2026-10-04; ~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/ (p7-steer-later.jsonl, p8-interrupt.jsonl, p11-compact.jsonl, p1-main.jsonl)"
    }
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
P5 for Claude, 2026-10-04: SDK 0.3.284 under Bun 1.4.2, `claude` 2.1.289, Claude Max (per `rate_limit_event` and `accountInfo`), `claude-haiku-4-5`. Data — `result`, `rate_limit_event` and frames in `~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/` (`p7-steer-later.jsonl`, `p8-interrupt.jsonl`, `p11-compact.jsonl`, `p1-main.jsonl`). Exhausted quota and 401 for Claude not reproduced: that would require spending the subscription or changing credentials.

## A turn `result` with a tool

Turn "call the tool twice, reply" (3 API calls: two with `tool_use`, the final one):

- `usage.input_tokens` 3978 and `output_tokens` 257 — **the sum over all turn API calls**; `num_turns: 3`. `usage.iterations` is one record (1456 in, 41 out, first call), i.e. the array does not break the turn down by calls.
- `total_cost_usd` — **cumulative** over the query (0.006255 after turn 1, 0.008248 after turn 2), `costBasis: "list"` — a price-list estimate, not a bill.
- `modelUsage` — cumulative per model: `inputTokens` 4905 (above 3978 by the session-naming request, ~930 tokens), `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`, `contextWindow` 200000, `maxOutputTokens` 32000, `thinkingTokens`, `provider: "firstParty"`. Turn usage is the difference of cumulative values; cumulative values must not be summed.
- Cache: on short prompts (1.5–4k tokens) `cache_read` and `cache_creation` are zeros — Haiku 4.5 caches from ~4096 tokens. On a turn with 11k tokens: turn 1 `cache_creation_input_tokens` 11364, turn 2 `cache_read_input_tokens` 11364, `cache_creation` 109.
- Interrupted-turn usage is undercounted ([[b05a4728]]): on `aborted_streaming`, `usage` is zero.
- `/compact` usage is not visible in `result.usage` (zeros), only in `modelUsage` and `total_cost_usd` growth.

## `rate_limit_event`

One event per query (in runs with 2–4 turns and 3–5 API calls — one each, before the first call): `rate_limit_info {status: "allowed", resetsAt, rateLimitType: "five_hour", overageStatus: "rejected", overageDisabledReason: "org_level_disabled", isUsingOverage: false, unifiedWindows: {five_hour: {utilization, resetsAt}, seven_day: {utilization, resetsAt}}}`. Values identical across all 19 runs in ~1 hour: five-hour window 0.04, seven-day 0.67 (with `status: "allowed"`) — on Haiku turns of this size usage did not move between runs, so these data do not show whether the event updates along the way. No data on what the event looks like with `status` ≠ `allowed`: not reproduced.

## What it means for the profile

- The ACP `usage_update` and the Claude runner's turn usage are computed from the difference of cumulative `modelUsage`/`total_cost_usd` across `result`; `result.usage` fits an ordinary turn's tokens, but not an interrupted turn or `/compact`.
- The `total_cost_usd` cost is a price-list estimate; the subscription plan shows in `rate_limit_event` windows, not money.
- Claude Code's extra requests (session naming on the first prompt; switched off with the `title` option) enter usage but not `result.usage`.
- Unverified: the SDK reply to exhausted quota and to 401 mid-turn.
