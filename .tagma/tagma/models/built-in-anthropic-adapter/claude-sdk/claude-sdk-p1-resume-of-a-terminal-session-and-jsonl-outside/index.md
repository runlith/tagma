---
id: 01a108ea-e245-71d3-a0b2-d34c30b86b6d
title: "Claude SDK P1: resume of a terminal session and JSONL outside Claude Code, fork and rewind, /compact as prompt"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Claude Agent SDK probe: resume, forkSession, resumeSessionAt, /compact, interactive claude under tmux, hand-built JSONL",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284, CLI 2.1.289 (TUI and SDK), Bun 1.4.2, claude-haiku-4-5; 2026-10-04; ~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/ (p1-inter.mjs, p9-fork.mjs, p9b.mjs, p11-compact.mjs, p12-resume.mjs, build-jsonl.py, transcripts/)"
    }
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Probe P1, 2026-10-04: SDK 0.3.284 under Bun 1.4.2, `claude` 2.1.289, Haiku. Scripts, frames and transcripts (email and id replaced) — `~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/` (`p1-inter.mjs`, `p9-fork.mjs`, `p9b.mjs`, `p11-compact.mjs`, `p12-resume.mjs`, `build-jsonl.py`, `transcripts/`).

## A session started by interactive `claude` continues via SDK

In a temp directory a real TUI `claude --model claude-haiku-4-5 --setting-sources project` ran (under tmux), one prompt "remember PINEAPPLE-42" in it, then `/exit`. The JSONL landed in `~/.claude/projects/<encoded cwd>/<id>.jsonl` (`entrypoint: cli`). `query({resume: <id>, cwd: same})` from the SDK picked the session up: reply `PINEAPPLE-42`, same `session_id`.

- The TUI transcript carries a `prompt_snapshot` with the full Claude Code prompt. On `resume` with an own `systemPrompt` and no snapshot flag, the **full TUI prompt** applies (on the wire `You are Claude Code…`, 32 KB, the "agent name" answer is `Claude Code`). With `extraArgs: {'system-prompt-snapshot': 'off'}` — the own one (`IOTA-AGENT`); details in [[6c4c410f]].
- History arriving from the TUI carries its service reminders (deferred-tool list, user MCP server instructions, skills listing), and they go on the wire as part of history, though the SDK session lacks these tools. For a Tagma thread moved from terminal to runner this is context noise.

## JSONL built outside Claude Code is accepted

Same `cwd` and project directory; file `<new-uuid>.jsonl`:

- **Edited copy.** An SDK session copied, `sessionId` replaced with a new one in all records, one user message text changed ("The secret code is 999. …"). `resume` accepted; the model saw the edit (`999`). Thinking-block signatures did not hinder.
- **Built from scratch.** Two rows of `user` and `assistant` (fields: `parentUuid`, `isSidechain:false`, `type`, `message` with `role`/`content`, `uuid`, `timestamp`, `cwd`, `sessionId`, `version`, `userType`, `entrypoint`, `gitBranch`; `assistant` also `message.id`, `model`, `content:[{type:text}]`, `stop_reason`, `usage`), without `attachment`, `ai-title`, `cost-state` and thinking. `resume` accepted; the model answered `777` from history; on the wire — history, then reminders, then the new message; the prompt is the launch-passed one (no snapshot in the file).

This is the "Tagma journal history → Claude Code" road working with no new session and no recap; the chain rests on `parentUuid`, `uuid` (in my build — random UUIDs). Unverified: tool_use/tool_result in built history, many turns, thinking with another session's signatures (in the copy the signatures were from the same session), CLI versions besides 2.1.289; the file format is internal and unpublished.

## Fork and rewind

A three-turn session ("code 111", "code now 222", "reply OK"). Reply uuids come from the stream's `assistant` messages; send uuids arrive by echo with `extraArgs: {'replay-user-messages': null}` (see [[b05a4728]]).

- `resume` + `forkSession: true` — new `session_id`, the original file unchanged (23527 bytes, 29 rows before and after); the fork has the whole history.
- `resume` + `resumeSessionAt: <turn-1 reply uuid>` **without** `forkSession` — the same `session_id`, the original file **grew** (23527 → 31578 bytes): the branch is appended to the same file, reply `111`. The next plain `resume` of the original answered `111` again: dropped turns stay in the file, but the active chain is the new branch. So rewind without fork is irreversible in the "default continuation" sense.
- `forkSession: true` + `resumeSessionAt: <uuid>` — new `session_id`, original untouched (37672 bytes before and after), reply `111`, the fork file 17718 bytes. This is "rollback without touching the original"; for decision 10 it is safer than rewind without fork.

## `/compact <instructions>` as a regular prompt

Live session: turn 1 — ~11k background tokens and "remember KIWI-77" (Haiku caches from 4096 tokens, so background of this size was needed), turn 2 "OK", turn 3 — "/compact Keep only the code word…", turn 4 "which word".

- Executes, **same session** (`session_id` unchanged).
- Turn 3 events: `system/status "compacting"` → `status null` → `system/init` → `system/compact_boundary` (`compact_metadata`: `trigger: "manual"`, `pre_tokens` 11516, `post_tokens` 526, `cumulative_dropped_tokens`, `duration_ms` 8194, `preserved_messages`/`preserved_segment` with saved-message uuids, `logical_parent_uuid`) → `user` message with retelling text ("This session is being continued from a previous conversation…", Summary sections 1–9, transcript path link) → `user` echo with `isReplay` and `<local-command-stdout>Compacted </local-command-stdout>` → `result` `success`, `result: ""`, `num_turns: 0`.
- The retelling does not arrive as a separate assistant message — only as the `user` message; the `/compact` instructions entered the retelling request and the retelling itself.
- This `result`'s `usage` is zeros, though there was a request: cost counted in cumulative `total_cost_usd` (0.0359 → 0.0426) and `modelUsage.cacheReadInputTokens` (11364 → 22829: the compaction request read ~11.5k from cache), but not in the turn's `result.usage`. Reading cache by the compaction request shows only via `modelUsage` growth.
- The compaction request goes with no `claude-code` beta and with `cache_control` without `ttl`. After compaction, turn 4 answered `KIWI` from the retelling; averaged tokens on this turn 1762 vs ~11k before compaction.

Profile conclusion: `/compact` is a regular runner prompt; the boundary is shown by `compact_boundary`, the retelling is in the `user` message after it; compaction usage must be counted via `modelUsage` growth, not `result.usage`.
