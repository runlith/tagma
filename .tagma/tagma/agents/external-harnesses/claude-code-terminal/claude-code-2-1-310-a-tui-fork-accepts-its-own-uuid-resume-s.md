---
id: 01a17319-75a7-7026-b6a0-721227bbf5fb
title: "Claude Code 2.1.310: a TUI fork accepts its own UUID, resume-session-at applies only in print"
ord: 9
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Code 2.1.310; Claude Agent SDK 0.3.292",
      "ref": "2026-10-25; installed native ~/.local/share/claude/versions/2.1.310; apps/tagma/server/node_modules/@anthropic-ai/claude-agent-sdk; .external/claude-agent-acp a44c486019e98ad478c549c4902e7092f1418d0b; https://code.claude.com/docs/en/sessions"
    }
  }
edges:
  - kind: relates
    to: 01a108ea-e245-71d3-a0b2-d34c30b86b6d
---
Read on 2026-10-25: installed `claude --version` → `2.1.310 (Claude Code)`; `claude --help`; package `@anthropic-ai/claude-agent-sdk` 0.3.292 (`apps/tagma/server/node_modules/@anthropic-ai/claude-agent-sdk`); `.external/claude-agent-acp` a44c486019e98ad478c549c4902e7092f1418d0b of 2026-10-02. No new TUI/model sessions launched. The preceding live 0.3.284 SDK / 2.1.289 CLI probe is separate from this reading.

## Observation: interactive argv

- Resume: `claude --resume X`; whole-history fork: `claude --resume X --fork-session`. A fork UUID can be assigned upfront: `claude --resume X --fork-session --session-id Y`. `--session-id Y` without resume creates a new conversation, Y must be a UUID and free.
- This is not a conclusion from combining two help rows: native binary `~/.local/share/claude/versions/2.1.310`, the `ra` function found via `rg -a -o`, explicitly allows `sessionId` together with resume/continue only with forkSession; the interactive boot hands sessionIdOverride to `bMn`. SDK `sdk.d.ts:2088–2094` describes the same contract.
- **`--resume-session-at UUID` does not cut history in the TUI.** `sdk.d.ts:2137–2143` says outright that interactive resume and background-worker boot ignore resumeSessionAt/resumeDropsTurn without error and load the whole chain. Native binary 2.1.310 holds a hidden flag declaration for print mode and the same text about ignoring outside print. The regular `--help` lacks the flag. So `claude --resume X --resume-session-at U` is not an interactive-rewind argv; adding `--fork-session` does not change this.
- SDK `sdk.mjs` maps `resumeSessionAt` to `--resume-session-at=…`, `forkSession` to `--fork-session`, `sessionId` to `--session-id=…`; this is print/headless mapping, not evidence of TUI support. The headless boundary is inclusive: the UUID of the **last kept chain entry**, not necessarily the last assistant response. Tool-result carriers and transcript attachments may come later than the reply (`sdk.d.ts:2095–2151`).

## Observation: TUI and storage

[Manage sessions](https://code.claude.com/docs/en/sessions) describes `/branch [name]`: a copy of the current conversation, new session ID, switch into the copy, original stays. [Checkpointing](https://code.claude.com/docs/en/checkpointing) describes `/rewind` / two Escs with empty input: prompt choice, Restore conversation separate from Restore code; the chosen prompt returns to the composer. Conversation rewind is kept with the next sent prompt: on exit before it, dropped messages may return. In native binary 2.1.310, `handleRestoreMessage` → `restoreMessageSync` → `rewindConversationTo` was read: the last takes prefix `slice(0,Ae)`, does transcript.cut/replace and resetForConversation(kind:rewound) without changing session.id. Its bumpConversationId changes the snapshot's internal UI field, not the vendor session id. So the source road keeps the session id; the physical record after the next prompt was not measured on this version. Docs promise no separate rewind hook.

Default JSONL: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, overridden by `CLAUDE_CONFIG_DIR`. Messages carry `uuid`, `parentUuid`, `sessionId`; physical rows do not equal the active branch. Hooks carry session_id/transcript_path; `/branch` is distinguishable by the new id/file, the active branch must be read by parentUuid. The official docs warn the format is internal. A direct copy with the same id across several projects can make global id search ambiguous.

## Observation and conclusion boundary: files outside the CLI

In the old probe the SDK indeed accepted a copied JSONL with a new sessionId and a synthetic JSONL; resume-at without fork appended a new active branch to the same file without deleting old rows. This is **not a new probe of interactive 2.1.310**.

SDK 0.3.292 has a separate offline `forkSession(X, {dir, upToMessageId: U})`: `sdk.d.ts:824–860`, implementation `aU` in `sdk.mjs` cuts by UUID inclusively, creates a new session UUID and remaps message/parentUuid UUIDs; file-history snapshots are not copied. `.external/claude-agent-acp/src/fork-session.ts:178–234` calls exactly it; ACP does not use the TUI flag for this operation. The official TUI accepts `claude --resume /absolute/file.jsonl`. These readings imply a road to prepare a correct prefix outside the model process and open the TUI, but acceptance of a specific hand-cut file by this installed version is unmeasured. Simply deleting the last N physical rows does not equal picking the active parentUuid chain.

## Open probes

Only after separate permission, on the own kept three-turn fixture: (1) `claude --resume X --fork-session --session-id Y`, compare SessionStart.session_id, source/new JSONL and full-history load with no new prompt sent; (2) `claude --resume X --resume-session-at U` in PTY, verify the TUI shows the whole tail as the code claims; (3) `/rewind` → Restore conversation → new distinguishable prompt → `/exit` → `claude --resume X`, compare id and parentUuid before/after; separately exit before the new prompt; (4) offline SDK forkSession to U, then `claude --resume Y`, compare the shown prefix. None of these probes ran in this reading.
