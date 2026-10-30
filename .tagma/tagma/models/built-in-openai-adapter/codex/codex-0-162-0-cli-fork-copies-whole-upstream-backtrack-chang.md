---
id: 01a17319-75a7-7026-b6a0-72133260ddfc
title: "Codex 0.162.0: CLI fork copies whole; upstream backtrack changes the rollout only on a persistent paginated thread"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "Codex CLI 0.162.0; OpenAI Codex upstream 6fb1c390",
      "ref": "2026-10-25; .external/codex 6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4 (2026-10-20); installed codex --help/resume --help/fork --help; https://github.com/openai/codex"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f13e-70e0-a79e-313114005f86
  - kind: relates
    to: 01a14b9f-6b94-75cf-989e-01375d27ec30
---
Read 2026-10-25: installed `codex --version` → `codex-cli 0.162.0`; root/resume/fork help; clean `.external/codex` revision `6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4` of 2026-10-20. The binary's match to this commit is not established. This is a new checkout relative to 09bced5 from the earlier research. TUI, app-server, model requests and upstream tests were not run.

## Observation: interactive argv

`codex resume X [PROMPT]` continues thread UUID; `codex fork X [PROMPT]` creates a new thread with X's full history. The installed help confirms both subcommands. Position X in fork is the **source** id, not the new thread's. An explicit nonexistent UUID does not turn into a new chat (`codex-rs/tui/src/lib.rs:820–866,1616–1643`).

CLI fork calls fork_thread_with_permission_mode with `last_turn_id=None, before_turn_id=None`: `tui/src/lib.rs:1510–1541`, `tui/src/app/startup.rs:727–769`, `tui/src/app_server_session.rs:975–994`. No cutoff or destination-id flags in either the installed help or the full ForkCommand (`cli/src/main.rs:417–451`, `tui/src/cli.rs:53–89`).

[ThreadForkParams](https://github.com/openai/codex/blob/6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L544) separately offers app-server `thread/fork {threadId:X,beforeTurnId:T}` — drop T and the whole tail — or lastTurnId inclusive; never both. The contract has no destination id; a UUIDv7 is generated. **These are API fields, not CLI argv.** The "API fork → codex resume of the new id" chain conclusion rests on compatible contracts; end-to-end on 0.162.0 is unverified. beforeTurnId needs the experimentalApi handshake.

## Observation: TUI backtrack and /fork

Empty composer, Esc then Esc opens the past-prompts picker; confirming sends RevertSessionForPromptEdit. An initial prompt of a completed/interrupted turn is allowed; mid-turn steer and in-progress turn are rejected (`tui/src/app_backtrack.rs:109–145,509–619`). A successful cut is possible **only for a persistent paginated thread**: the backend explicitly rejects ephemeral and legacy history (`app-server/src/request_processors/thread_processor.rs:2204–2212`), and the TUI leaves history unchanged on validation error (`tui/src/app/event_dispatch.rs:797–806`). On success the chosen prompt returns to the composer, the conversation is cut **before** its turn. This is no file undo. This path's shape and availability on installed 0.162.0 are not established by live probe.

`thread/revert` takes the **same thread_id** and before_turn_id: `tui/src/app_server_session/history.rs:139–171`. The backend creates a new rollout, keeps thread/session ids and switches the SQLite rollout_path via CAS; the old rollout stays (`app-server/src/request_processors/thread_processor.rs:2190–2253,2334–2342,2377–2435`, `thread-store/src/local/revert_thread.rs:105–150,172–190`). Watching only the old path's append is not enough.

`/fork` calls ForkCurrentSession with no cutoff and switches the UI to the **new thread id** (`tui/src/app/event_dispatch.rs:562–613,634–649`); the root session_id comes from the new thread id (`core/src/session/session.rs:898–911,940–960`). Subagents may carry another thread's root session_id; that difference must not be erased.

## Observation: identity, points, storage

`/status` shows Session and Forked from (`tui/src/status/card.rs:845–853`). App-server returns the thread in the fork response and publishes thread/started; revert — thread/reverted. These events are not the TUI's JSONL stdout. The SessionStart hook carries source fork/resume, session_id, transcript_path (`core/src/session/session.rs:1967–1995`, `core/src/hook_runtime.rs:128–170`), but is **deferred until run_turn**, not promised on simply opening an idle TUI (`core/src/session/turn.rs:340–342`). The next turn takes current_rollout_path (`core/src/session/mod.rs:5415–5433`).

`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl`; after revert — `<thread-id>_<rollout-id>` (`rollout/src/recorder.rs:94–104,1755–1772`). Envelope `{timestamp,ordinal?,type,payload}`; SessionMeta holds id/session_id/forked_from_id/history_mode/history_base. The API point is the turn id; the paginated cutoff resolves to the turn start's ordinal/byte offset, not a user-message number or JSONL line (`thread-store/src/local/paginated_fork.rs:87–178`). One turn may hold steers.

A paginated fork may reference another rollout's prefix: one child JSONL need not hold the whole conversation. HistoryPosition holds rollout identity, end_ordinal_exclusive and end_byte_offset (`protocol/src/protocol.rs:3234–3273`). The SQLite pointer is authoritative for a known paginated thread; the legacy filesystem fallback does not replace it (`thread-store/src/local/thread_rollout_resolver.rs:73–129`).

## Finding: external copy/truncate unproven

The legacy loader reads the canonical id from SessionMeta and may skip individual unparsed lines (`rollout/src/recorder.rs:1120–1203`). That does not prove the TUI accepts a handmade file: positional resume is UUID/name, not file path. The paginated projection stores next_byte_offset and explicitly refuses `durable rollout shrank before projection` if the file shortened (`thread_history_materialization.rs:49–79,100–106`). So plain copy/truncate of an existing rollout is not declared a working fork/rewind path. Importing a standalone legacy prefix into an empty CODEX_HOME stays a hypothesis.

## Open probes

After separate permission, in an isolated CODEX_HOME: (1) `codex resume X` and `codex fork X` in PTY with no initial prompt, compare `/status`, turns, source file; separately measure SessionStart before/after the first permitted prompt; (2) via app-server experimental handshake run `thread/fork {threadId:X,beforeTurnId:B}`, then `codex resume <returned-id>`, check B/C exclusion; (3) on a persistent paginated fixture Esc,Esc,Enter on B: same thread id, new rollout_path, B in composer; exit and repeat resume; separately check validation error and unchanged history on a legacy/ephemeral fixture; (4) standalone legacy/paginated prefix copies with a new canonical id in a fresh home, `codex resume Y`, compare restored turns; separately shrink a copy of an already indexed paginated thread. None of these probes ran yet.
