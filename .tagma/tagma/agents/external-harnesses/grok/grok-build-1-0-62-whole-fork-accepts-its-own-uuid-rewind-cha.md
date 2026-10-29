---
id: 01a17319-75a7-7026-b6a0-7214504dbcc7
title: "Grok Build 1.0.62: whole fork accepts its own UUID; rewind changes only the conversation"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Grok Build 1.0.62 (1474f9cbdd91); xai-org/grok-build main",
      "ref": "2026-10-25; ~/.grok/bin/grok --help and embedded user-guide; https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/rewind.rs; https://x.ai/changelog/build"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f15c-7933-a666-38876787fb19
---
Read 2026-10-25: installed `grok --version` → `grok 1.0.62 (1474f9cbdd91) [stable]`, root/sessions help; the user guide embedded in `~/.grok/bin/grok` and symbol strings; official `xai-org/grok-build` sources/docs on a moving `main`, read via raw GitHub URLs. This is a reading, not a new TUI/model probe. The `main` snapshot could not be pinned to the installed hash: the raw URL with `1474f9cbdd91` returned 404; the source facts below carry that version bound.

## Observation: interactive argv

`grok --resume X` continues an id (also accepts a title); `grok --resume X --fork-session` creates a new id with full history. A fork UUID can be preassigned: `grok --resume X --fork-session --session-id Y`. The installed help directly states compatibility; Y must be a new UUID. `--session-id` together with resume/continue and no fork is forbidden. No cut-point flags are in root help; the built-in user guide directly calls `/fork --at <turn>` unsupported. `grok sessions --help` lists list/search/delete: no separate restore/fork-at subcommand.

## Observation: TUI and the rewind bound

The binary-embedded user guide describes `/fork [--worktree|--no-worktree] [directive]` as a peer with a history copy. An optional directive is a new prompt, not a cut pointer. `/rewind` (`/undo`), or two Esc within 800 ms while idle/with an empty prompt, lists user prompts and removes the picked turn and later turns from the conversation; it **does not restore files**. The [official changelog](https://x.ai/changelog/build) confirms the move to conversation-only rewind in v1.0.1. An older indexed GitHub preview of the docs claimed file restore; the fresh raw copy and the embedded 1.0.62 docs say the opposite.

[SessionActor::handle_rewind source](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/rewind.rs), lines 250–376: same session_info, an in-memory conversation cut, replay after compaction, then **append `RewindMarker {target_prompt_index, created_at}` to updates.jsonl**. No new session id is created, the physical updates.jsonl tail is not erased. An observer can recognize the marker and recompute the active timeline. This is a `main` source fact; the marker's presence/shape on the exact 1.0.62 build is unconfirmed by a live probe. The [extension handler](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/src/extensions/rewind.rs) takes the local point as `targetPromptIndex` (zero-based), not a message UUID; the bridge admits a different targetResponseId that does not equal the local contract. This is an internal extension, not a CLI launch flag.

[Fork TUI dispatcher](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-pager/src/app/dispatch/session/fork.rs), lines 141–235: a new peer; Effect::ForkSession has parent_session_id and a separate new_session_id, or a worktree pipeline. This is a new session id, the original stays; identity is visible in the child summary/new hook events. No separate rewind hook is established by this reading.

## Observation: storage and the file-editing conclusion

The binary-embedded user guide and [its raw copy](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md) describe `$GROK_HOME/sessions/<url-encoded-cwd>/<UUID>/` (default `~/.grok`), `summary.json`, `updates.jsonl` as the replay source, `chat_history.jsonl`, `rewind_points.jsonl`, `compaction_checkpoints/`. The rewind point is an ordinal prompt, not a JSONL line; `prompt_id` from hooks/updates identifies a turn, but the source rewind API picks a prompt index. The earlier 1.0.50 probe set the hook transcript_path to updates.jsonl and promptId on submit/stop; that is no 1.0.62 rewind measurement.

Replay/storage imply that a consistent session-directory copy outside the CLI is possible, but **copying/trimming updates.jsonl alone is unproven sufficient**: model history, metadata, markers, and compaction checkpoints sit alongside. The source itself uses markers and replay, not physical tail deletion. Whether 1.0.62 accepts a homemade prefix on resume is unverified.

## Open probes

On a personal kept session, after separate permission: (1) `grok --resume X --fork-session --session-id Y`, compare summary.info/id, parent_session_id, hooks, and X unchanged; (2) `grok --resume X`, `/rewind`, pick prompt index 1, check session-info id and new updates.jsonl lines, then exit/repeat resume; (3) in a separate GROK_HOME prepare a full directory copy with a consistent new id and prefix, run `grok --resume Y`, check the restored tail. No such probe was run now.
