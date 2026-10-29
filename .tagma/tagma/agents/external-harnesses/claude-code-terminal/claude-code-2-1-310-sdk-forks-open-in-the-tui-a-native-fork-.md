---
id: 01a1732c-8663-7eed-af66-fea9880f739d
title: "Claude Code 2.1.310: SDK forks open in the TUI; a native fork records the file only after the first prompt"
ord: 10
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Code 2.1.310; Claude Agent SDK 0.3.292",
      "ref": "2026-10-25; live probe; apps/tagma/server/src/external-harnesses/testing/fixtures/claude-code/"
    }
  }
edges:
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-721227bbf5fb
---
## Conditions and kept evidence

Live probe of 2026-10-25: `claude --version` → `2.1.310 (Claude Code)`, Agent SDK 0.3.292 from `apps/tagma/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`. Own directory `<probe> = ~/.tagma-dev/scratch/01a17326-ef30-7886-bdfe-f356f62594c2/claude`, no repository; active Claude Max, model `haiku` → `claude-haiku-5-5`, low effort. Three neutral prompts: `Reply exactly: FIXTURE_A.`, then B and C. Replies: FIXTURE_A/B/C. The CLI added account context itself; kept fixtures are anonymized.

Shared argv `COMMON`: `--model haiku --effort low --tools '' --strict-mcp-config --setting-sources '' --settings <probe>/settings.json`. `settings.json` has only a SessionStart command hook `bun <probe>/hook.ts` and `autoUpdatesChannel: stable`; the hook reads stdin JSON and appends it to `<probe>/hooks.jsonl`. Env: `CLAUDECODE` unset, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Each TUI launched via a Tagma held PTY; X screen 120×40, fork/resume 120×48. All five PTYs stopped, stop confirmed cleanup complete.

Sessions:
- X: `c252b18d-e481-452e-8449-a632720da358`.
- SDK whole Y: `1fc80a2c-3ad0-4331-a75b-15fd97028d6a`.
- SDK prefix Y: `32a3a5d9-7fd0-43ab-9ca4-5ea7f6932855`.
- Native whole Y2: `6df0a4e0-2a66-4bd7-bdd8-fb5a52bef02c`.

CLI files lay in `~/.claude/projects/-Users-<user>--tagma-dev-scratch-01a17326-ef30-7886-bdfe-f356f62594c2-claude/<id>.jsonl`; the path confirmed SessionStart.transcript_path. The repo keeps `apps/tagma/server/src/external-harnesses/testing/fixtures/claude-code/{source,sdk-full,sdk-prefix,tui-full,session-start}.jsonl`.

## Observation: offline SDK → idle TUI

X created with `claude --session-id X COMMON --system-prompt 'Answer the trivial fixture prompts concisely. Do not use tools.'`, A/B/C entered into the PTY one by one after the previous reply finished, then the PTY closed. In `<probe>/fork.ts`, run with `bun <probe>/fork.ts` with cwd `<probe>`, executed `await forkSession(X)` and `await forkSession(X, {dir: <probe>, upToMessageId: U})`. U = `cc2fcffe-4f56-4ca1-9bac-513e81529f44`: B's parentUuid prompt, the last chain entry before B, system/turn_duration after A's prompt_snapshot. This is not assistant A's own UUID.

Both Ys immediately had files. Each opened with `claude --resume Y COMMON`, no new prompt. The whole screen showed A/reply A → B/reply B → C/reply C; prefix — only A/reply A. Order matched X. Hook SessionStart arrived on idle open, `source: resume`, `session_id` strictly of the matching Y, `transcript_path` of its file. None of X's original 19 chain-entry UUIDs occur in whole (20 UUID entries) or prefix (12): the SDK rewrote UUIDs and parentUuids. The sdk-prefix fixture ends after A; it has no B/C.

## Observation: native whole fork

`claude --resume X --fork-session --session-id Y2 COMMON` immediately showed A/B/C in the previous order. SessionStart on idle: `source: fork`, `session_id: Y2`, transcript_path of the expected Y2. But after stopping with no prompt, the Y2 file was absent: reading by hook path returned ENOENT, a Y2 glob under `~/.claude` found no file. So the hook path here does not testify that the transcript already exists.

Re-ran the same argv, again A/B/C; sent one extra `Reply exactly: FIXTURE_D.`. After reply D and stopping, the Y2 file appeared. It has 23 UUID entries, including all 19 previous X UUIDs unchanged and four new ones; A/B/C stay ahead of D. The tui-full fixture was taken after this extra turn, not from the idle fork.

After both SDK forks, both idle/native launches and D, X's SHA-256 stayed `e1163ab100e984fde16aa5caee227d514f419313c498b29ced9d4b970b5082fe` (107525 bytes, 44 JSONL rows). The X source did not change.

## Fixtures and boundaries

These are full session JSONLs, with no records removed. In copies `<probe>` is replaced with `/fixture/workspace`, other `~` with `/fixture/home`; the auto-attached email with `fixture@example.invalid`, the organization UUID with `00000000-0000-4000-8000-000000000001`. Session/message UUIDs, parentUuids, prompts, responses and order kept. SessionStart transcript paths reduced to `/fixture/home/.claude/projects/fixture/<id>.jsonl`. Every row's JSON parsed; the production fold `vendors/claude-code/metadata.ts:claude(id)` accepted four transcript files and returned Haiku 5.5, low and the expected titles. Full vendor resume of the anonymized copies was not run; content-addressed API-request hashes in them were not recomputed, so they are meant for Tagma parsers, not wire-request replay.

## Conclusion

On this short conversation, SDK whole and prefix proved the "ready file → resume idle with no model request" road, with a new session_id and UUID renumbering. A native whole fork keeps UUIDs, but exists only in the live CLI until the first prompt: a child closed before the first word has no durable file for resume. So one durable road for both cuts is the offline SDK; the new root's turn map must be built from Y. The probe did not measure tools, compaction, sidechains, multi-branch parentUuid history, other CLI versions or accounts.
