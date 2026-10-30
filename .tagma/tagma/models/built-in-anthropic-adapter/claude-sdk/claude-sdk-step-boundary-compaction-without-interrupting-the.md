---
id: 01a118cf-b972-77e1-a649-dbd8332f3ece
title: "Claude SDK: step-boundary compaction without interrupting the turn — auto-compaction enabled by applyFlagSettings mid-turn; cuts via interrupt and priority now — probe 2026-10-08"
ord: 11
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live probes: mid-turn compaction with a tool — /compact next and now, interrupt before and after the result, flag auto-compaction",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.292, CLI 2.1.293, Bun 1.4, claude-haiku-4-5; 2026-10-08; scratch 01a113b6…/probe-step-compact.ts"
    }
  }
edges:
  - kind: discovered-from
    to: 01a10a1a-ee85-7fd6-b885-d18d92391518
---
Thirteen live runs, 2026-10-08: SDK 0.3.292 under Bun, `claude` 2.1.293, Haiku 4.5. Options as the runner's: `tools: []`, `strictMcpConfig`, `settingSources: []`, own `systemPrompt` without snapshot, `replay-user-messages`, `bypassPermissions`. Tool — in-process MCP `wait(n)`: waits 2 s and replies with a token and ~4.7 KB text. Turn: call `wait` with n=1, 2, 3 in order and reply `DONE <tokens>`. The variant applied mid-`wait(2)`. Success — the final reply with three correct tokens and call order. Script `probe-step-compact.ts` and logs lie in the 01a113b6 thread scratch and leave with it.

## Observations

| Variant mid-`wait(2)` | What happened | Reply, calls |
|---|---|---|
| `/compact` with `priority: 'next'` | turn ran to the end, `/compact` started after `result` — as in [[e78fa33c]] on 2.1.289 | correct, 1,2,3 |
| `/compact` with `priority: 'now'` | turn cut at once: `wait(2)` `tool_result` — "interrupted before a result" error, `result` success with empty text, compaction right away; the real `wait(2)` result lost | continuation not launched |
| `interrupt()` in the tool handler, before yielding the result | `tool_result` — "doesn't want to proceed" error, "[Request interrupted by user for tool use]", `error_during_execution`; then `/compact` and "Continue" | correct, but calls 1,2,2,3: `wait(2)` executed twice |
| `interrupt()` right after `tool_result` in the stream | result kept, "[Request interrupted by user]" added, `error_during_execution`; `/compact` goes at once, the kept tail — tool_use, tool_result and the mark; then "Continue" | correct, 1,2,3 |
| `applyFlagSettings({ autoCompactEnabled: true })` on a process started with `autoCompactEnabled: false`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | after `tool_result` and before the next model request: `status compacting` → `compact_boundary` `trigger: auto` → synthetic retelling → the turn continues on its own, with no interruption mark and no new message, one `result` | correct, 1,2,3 |

Last-variant details:
- Both variables needed. With only `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` or only the compression window, nothing. `autoCompactWindow` via `applyFlagSettings` does not move the threshold: at 3000 and 100000 the `autoCompactThreshold` stayed 167000.
- A window below the model window changes `getContextUsage().maxTokens`: 5000 yields 100000 with a 200000 model window. Windows 200000 and 1000000 leave `maxTokens` 200000. `autoCompactThreshold` from `getContextUsage` ignores the percent: showed 167000 and 67000, while compression ran at 2.8K tokens.
- The SDK `PreCompact` hook, replying `{ systemMessage }`, feeds instructions to automatic compaction too: the marker from it stood in the retelling (`PostCompact.compact_summary`). `custom_instructions` in the hook input is null on auto.
- `PostCompact` arrives before `compact_boundary` and before the next model request. `applyFlagSettings({ autoCompactEnabled: false })` inside it switches compression off until the next request: no repeated compression.
- A `priority: 'next'` steer sent during `wait(2)` is embedded by echo at the same step boundary before compaction, stayed in the kept tail, and the model executed it.
- Compressing ~4K tokens took 15–30 s on Haiku, manual and automatic alike.
- Both variables are described in Claude Code docs (code.claude.com/docs/en/env-vars, read 2026-10-08): the window — 100000 to 1000000 and no more than the model window; the percent acts only in sessions that compress before the model limit, i.e. with a set window. The SDK types lack them.

## Second series, same day

Five runs with the same script and Tagma test runs on live Claude:
- A flag enabled while the tool still runs fires at the same boundary — after its result.
- A flag enabled during a turn's only request does not fire in this turn: there is no next model request. No compression 30 s after the turn end.
- In a short conversation (~33K tokens, almost all system prompt) Claude Code refused: `status` with `compact_result: failed` and `compact_error: too_few_groups`, no `PreCompact` reply in the retelling; the turn continued.
- With auto-compaction off, a turn that hit the limit (`CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE=4000`) ended with a `result` with `is_error`, text "Prompt is too long" and `terminal_reason: blocking_limit`; Claude Code itself did not compress. The flag enabled after this and a "continue" message gave `PreCompact` → `compacting` → `PostCompact` → `compact_boundary` before the model request, and the model continued the task; the variable comes from the `claude` binary, absent from docs.

## Conclusion

A client can order step-boundary compaction without interrupting the Claude Code turn. The process rises with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` and auto-compaction off; on request `applyFlagSettings` enables it, `PostCompact` disables it, and instructions go via the `PreCompact` hook. A cut via `interrupt()` only fits after the tool result and leaves an interruption mark and an extra message; a cut before the result repeats the tool.

## Undetermined

- Where the real window's limit lies at which the turn ends with `blocking_limit` without auto-compaction: the probe understated it with the variable.
- Other `claude` models and versions, parallel tool calls, the 1M window. One run per variant — one sample.
