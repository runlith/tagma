---
id: 01a17319-75a7-7026-b6a0-72189d725189
title: "OpenCode: help 2.1.3 gives fork argv to mini only; source 2.0.29 cuts before the message ID"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "OpenCode @opencode/cli 2.1.3",
      "ref": "2026-10-25; bundled @opencode/cli 2.1.3 help; .external/opencode 8ffbcc2c81d1ff558618137204c36954797d7a6f (package 2.0.29); https://github.com/sst/opencode"
    }
  }
---
Read 2026-10-25: `opencode` is absent from PATH (command not found, exit 127), but the bundled executable `/opt/workspaces/runlith/node_modules/.bun/@opencode+cli@2.1.3/node_modules/@opencode/cli/bin/opencode.exe` answers `opencode v2.1.3`. Only its --version/--help and mini/run/session/import/export --help were run. `.external/opencode` is a clean HEAD `8ffbcc2c81d1ff558618137204c36954797d7a6f` from 2026-10-14, origin github.com/sst/opencode, package `2.0.29`. The source semantics below refer to this checkout; API parity with the 2.1.3 binary is not verified. TUI, model, server/API, and import/export without --help were never launched.

## Observation: interactive 2.1.3 argv

Call the executable above PROGRAM. Fullscreen resume: `PROGRAM --standalone --session ses_X`; standalone is a separate-process mode, not a requirement of the shared resume syntax. `--continue` picks latest. Help describes --session as continue **or create if the id does not exist**; so `PROGRAM --standalone --session ses_Y` sets the id of a new empty session. The source default handler distinguishes sessionID/newSessionID; create is deferred until prompt (`packages/cli/src/commands/handlers/default.ts:53–61,112–118`).

Whole-history fork of **interactive mini**: `PROGRAM mini --standalone --session ses_X --fork` (also --continue --fork). Mini is a separate minimal interactive interface. Fullscreen root declares no --fork; the root/mini/run declarations `packages/cli/src/commands/commands.ts:38–58,340–357,376–397` agree with the installed help here. `run --fork` also exists but is not the wanted interactive TUI path.

No point-launch flag and no preassigned destination fork ID were found in help/declarations. --session with --fork is the **source id**, not the target (`packages/cli/src/session-target.ts:105–118`, `mini.ts:52–58`). A new empty ses_Y does not mean a fork with ses_Y.

## Observation: source 2.0.29 — TUI/API fork and undo

Fullscreen `/fork` opens a Full session or a user prompt picker; the pick calls `session.fork({sessionID,before:messageID})`, switches the UI to result.id, returns the prompt to the composer (`packages/tui/src/routes/session/index.tsx:948–962`, `dialog-fork.tsx:21–70`, `dialog-message.tsx:77–85`).

API `POST /api/session/:sessionID/fork`, JSON `{before:"msg_..."}`; without before — full history (`packages/protocol/src/groups/session.ts:313–326`). No destination ID is accepted. `packages/core/src/session.ts:319–358` resolves the boundary by seq and creates a new session ID. `core/src/session/projector.ts:139–179` cuts BEFORE the picked message, without the picked prompt itself; full keeps THROUGH the last message. Fork is top-level (`parent_id=null`), with separate fork_session_id/fork_boundary. It carries settled history, skips unfinished assistant/shell/compaction, **remaps message IDs**, zeroes usage (`:192–225`). So whole means all settled history, not a byte copy of every in-progress item.

`/undo`/`/redo` operate **in the same session ID**. Undo stages a boundary, updates files/snapshot and the composer; redo lifts the stage until the next submit (`tui/src/routes/session/index.tsx:988–1034`, `core/src/session/revert.ts:21–73`). The next successfully prepared prompt commits the rollback; the projection deletes messages/inbox with seq >= boundary (`core/src/session/session.ts:159–174`, `projector.ts:759–789`). The [official snapshots docs](https://dev.opencode.ai/v2/docs/snapshots/) describe the same staged boundary. Reverting an earlier user message is available from the message menu.

## Observation: storage, identity, and external copy

Source data-dir: `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`; `OPENCODE_DB` overrides the SQLite path, default opencode.db with channel variants (`packages/util/src/global-roots.ts:4–18`, `packages/cli/src/database-path.ts:4–12`). This is a **shared DB**, not a per-session transcript file: session_v2, session_message with a global primary key id/session_id/seq/JSON data, session_inbox; a separate event log and projections (`core/src/session/sql.ts:22–143`, `core/src/event/sql.ts:4–24`). The unit is the message ID msg_…, not a turn ordinal or a terminal row.

The vendor API/event stream provides the fork/revert result and identity; a new fork differs by session id and new message IDs, undo by a staged/committed boundary under the same id. An immediate hook on a bare TUI transition is not proven; fullscreen root has no direct JSONL stdout contract.

The installed help offers `PROGRAM session export [SESSION]` and `PROGRAM session import FILE [--directory DIR]` (with --standalone). The source transfer schema is JSON `{info,messages}` (`schema/session-transfer.ts:8–11`); the producer `core/src/session/transfer.ts:64–143` uses info.id as target, rejects an existing id, requires an existing parentID, carries settled messages **without remapping message.id**, reassigns seq, and imports projections without the full source event log.

**A schema/producer conclusion, an unmeasured conflict:** a same-DB clone with only info.id changed collides with the global message primary keys. A correctly remapped prefix in a separate DB or with new message IDs may pass import, but tool/provider/snapshot/context consistency at an arbitrary point is unverified. Direct SQL copy/truncate bypasses event/projection consistency; trimming a text export does not change the source session. The stock fork performs the remap itself.

## Open probes

After separate permission, in an isolated 2.1.3 profile: `PROGRAM --standalone --session ses_Y`, a first harmless prompt — verify the exact preassigned ID; fullscreen `/fork` Full session and before user prompt — compare the new id, exclusive boundary, remap of message IDs, and source; `PROGRAM mini --standalone --session ses_X --fork` — compare the same facts. `/undo`→`/redo` before submit and `/undo`→edited submit — verify id and staged/committed persistence. Separately confirm the live 2.1.3 API `{before:MSG}`. For an external copy: export/edit/import in a separate profile, verify the source id conflict, a new session id with old message ids same-DB collision, then a remapped prefix. None of these probes has been run.
