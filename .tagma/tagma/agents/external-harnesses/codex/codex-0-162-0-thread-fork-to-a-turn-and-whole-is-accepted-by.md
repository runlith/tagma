---
id: 01a17330-2035-75da-848d-7f943746cb7c
title: "Codex 0.162.0: thread/fork to a turn and whole is accepted by TUI resume; SessionStart arrives on the first turn"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "Codex CLI 0.162.0: live app-server experimental fork → TUI resume; upstream source",
      "ref": "2026-10-25; installed codex-cli 0.162.0; .external/codex 6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4 (2026-10-20); https://github.com/openai/codex/tree/6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4"
    }
  }
edges:
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-72133260ddfc
---
## Observation: installed CLI and conditions

The probe ran 2026-10-25 on `codex-cli 0.162.0`, macOS, in fresh `codex-probe/home` (`CODEX_HOME`) and `codex-probe/work` inside the thread's scratch [[01a17327-7201-7baf-bfe4-0b97e71adebc|Codex probe]]. Authorization was copied from the operator's home Codex; the `auth.json` copy was deleted after the processes stopped. The operator's home configuration, hooks and sessions were untouched. Tagma and the browser were not launched for verification.

The local upstream `.external/codex` was read, commit `6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4` of `2026-10-20T22:39:53Z`. The installed binary's match to this commit is not established. Source: https://github.com/openai/codex/tree/6fb1c3903d42e3cc7da2c89e3a045fe0ce137af4 . The earlier reading of the [[3260ddfc|Codex contracts]] held no such live check.

`model/list` returned seven available models: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`. `gpt-6-luna` was used, effort `low`: the catalog describes it as fast and affordable for simple tasks. The catalog and its cache hold no prices or spend rate, so the models' minimum absolute price is not established by this probe. Three source model turns and one extra turn in the cut child were made; model tools were not called.

## Observation: app-server and two forks

Exact preparation argv: `["codex","app-server","--stdio"]`; cwd — `codex-probe/work`, `CODEX_HOME` — `codex-probe/home` of the same scratch. The final RPC driver `codex-probe/probe.mjs` ran it. Handshake: `initialize {clientInfo:{name:"neutral_cut_probe",version:"1.0.0"},capabilities:{experimentalApi:true}}`, then notification `initialized`.

`thread/start {cwd:<work>,model:"gpt-6-luna",approvalPolicy:"never",sandbox:"read-only",baseInstructions:"Answer the user briefly. Do not use tools."}` returned X=`01a17329-1ae3-78a3-af25-aba70cf0f88a`, `ephemeral:false`, `historyMode:"paginated"`: the same durable paginated path the prepare check in `vendors/codex/row.ts` verifies, with model choice for a paid probe.

Three consecutive `turn/start {threadId:X,input:[{type:"text",text:<prompt>,text_elements:[]}],effort:"low"}` waited for `turn/completed` with status `completed`:

| Turn | Prompt → answer | Turn id |
|---|---|---|
| A | `Reply exactly ALPHA.` → `ALPHA` | `01a17329-1b4c-7971-b242-453487dd1265` |
| B | `Reply exactly BRAVO.` → `BRAVO` | `01a17329-25d7-7ac3-a0a8-23b0355703b3` |
| C | `Reply exactly CHARLIE.` → `CHARLIE` | `01a17329-29d8-7c73-8ef0-dc5356c7dc76` |

`thread/fork {threadId:X,beforeTurnId:"01a17329-25d7-7ac3-a0a8-23b0355703b3"}` returned Ycut=`01a17329-2ee4-7210-a54a-e21a99e9321d`. `thread/fork {threadId:X}` returned Ywhole=`01a17329-2f9f-75d0-a50f-4259ab03fca8`. Both have `historyMode:"paginated"`, `ephemeral:false`, `forkedFromId:X`.

`thread/read {threadId:<id>,includeTurns:true}` confirmed: Ycut holds only A, Ywhole — A/B/C. Inherited turn and message ids match X, not rewritten. Full `thread/read` answers for X before and after the forks are equal. The source rollout's SHA-256 before the forks, after the forks and after both TUIs with the child's extra prompt matched: `8b310c5927c7bc0ad1be8ad69773b79c9dae2d73ea3d0fc87daddbca8c5838a2`.

Child JSONLs do not copy messages: `session_meta.history_base` points at X. Ycut's source `end_ordinal_exclusive:16`, `end_byte_offset:36801`; Ywhole's — `35`, `48910`. Child session_meta starts at ordinal 16 or 35; the file holds only its own later records.

## Observation: resume in a held PTY and SessionStart

Each child was opened with no initial prompt, only via Tagma `start_terminal` (`transport:pty`, `lifetime:held`, 110×45). Exact argv: `["codex","-m","gpt-6-luna","-c","model_reasoning_effort=low","-c","tui.resume_cwd=current","resume",Y]`. cwd and `CODEX_HOME` are the same as at preparation. The vendor asked to trust the new local SessionStart hook; `write_terminal` picked "Trust all and continue". No cwd choice question appeared.

`read_terminal_screen` witnesses:
- Ycut: execution `069a17ca-1059-4639-8b41-7b7aeeb02cd3:167`, frame 2 — only `Reply exactly ALPHA.` / `ALPHA`, idle composer; frame 4 after `/status` — Session=Ycut, Forked from=X.
- Ywhole: execution `4000cf8c-8fd6-46d4-831d-5d4448f25ee6:167`, frame 2 — A/B/C with answers, idle composer; frame 4 after `/status` — Session=Ywhole, Forked from=X.

The new home has `features.hooks=true`; `hooks.json` holds a SessionStart command `node <scratch>/codex-probe/hook.mjs`. The hook keeps stdin and the receive time in scratch `hooks.jsonl` and answers `{}`. After trust, opening both TUIs and `/status`, the file was absent when read at `2026-10-25T13:05:35.853Z`. This is the measured idle window, not proof the hook never fires under unbounded waiting.

A single extra prompt `Reply exactly OK.` was sent in Ycut via `write_terminal`. The hook recorded `2026-10-25T13:06:33.195Z`: `hook_event_name:"SessionStart"`, `session_id:Ycut`, `source:"resume"`, `transcript_path` pointing at Ycut's rollout, `model:"gpt-6-luna"`. Frame 5 shows the `OK` answer. Ywhole got no model prompt, and no SessionStart was recorded for it. This matches `core/src/session/turn.rs:340–342`, where a pending SessionStart launches inside the turn path, not on simply showing an idle TUI.

Both held PTYs were stopped with `stop_terminal` with cause `scope-closed`: exit 0 on hang-up, cleanup complete, survived=0, unverified=0; `read_terminals` for this thread answered "no terminals held".

## Kept files and exact neutralization

Directory: `apps/tagma/server/src/external-harnesses/testing/fixtures/codex/`.
- `source.jsonl`: all 35 X lines, 47,711 bytes; raw basename `rollout-2026-10-25T14-03-56-01a17329-1ae3-78a3-af25-aba70cf0f88a.jsonl`.
- `fork-before-turn2.jsonl`: 3 Ycut lines, 3659 bytes; raw basename `rollout-2026-10-25T14-04-01-01a17329-2ee4-7210-a54a-e21a99e9321d.jsonl`.
- `fork-whole.jsonl`: 3 Ywhole lines, 3659 bytes; raw basename `rollout-2026-10-25T14-04-01-01a17329-2f9f-75d0-a50f-4259ab03fca8.jsonl`.
- `session-start.json`: kept Ycut SessionStart input after neutralization of paths.
- `fork-rpc.json`: four full result payloads from the same probe, keys `cut`, `whole`, `cutRead`, `wholeRead`; JSON-RPC envelope not included. Only work/home paths neutralized by the same replacements. `JSON.parse` check and deep equality against the matching projection of the raw `result.json` after these replacements confirm all other fields are kept exactly; turn counts — 1/3/1/3. The model catalog and prompt instructions are not in this file.

Rollout files were taken before Ycut's extra prompt; the two later lines of each fork are vendor `thread_settings_applied` at preparation and resume. Lines, timestamps, ordinal, session/turn/message ids and message contents are kept. No lines cut. Only these changes:
1. Absolute scratch `codex-probe/work` replaced with `/workspace`, scratch `codex-probe/home` — with `/home/fixture/.codex`; the remaining home-folder prefix — with `/home/fixture`. This covers JSON fields and nested text environment/skills instructions.
2. `creator_user_id` replaced with `user-fixture`, `creator_account_id` — with `00000000-0000-4000-8000-000000000001`.
3. String `credits.balance` in three source token_count events replaced with `"0"`.
4. After the source line length change, `history_base.end_byte_offset` fixed to actual UTF-8 boundaries: Ycut `36801 → 35940`, Ywhole `48910 → 47711`. Ordinal boundaries stayed 16 and 35. These new offsets belong only to the kept neutralized source, not the raw rollout.

All files were added with dedicated write/edit tools. Raw `result.json`, `rpc.jsonl`, rollout files, driver and hook stay in scratch `codex-probe/`; that is local probe evidence, not part of the committed fixtures. No durable copy of the full runnable experiment is kept in the repository.

Checks: every JSONL line parsed with `JSON.parse`, every full rollout run through the real metadata fold `codex(id)` from `vendors/codex/metadata.ts`; source yields model `gpt-6-luna`, effort `low`, turn C, both children correctly bound to their ids. On the children the metadata fold yields no model, because they have no `turn_context` of their own: inherited data sits with X. A separate read-only check summed source UTF-8 bytes to ordinal 16/35, compared against `history_base.end_byte_offset` and got turn ids A or A/B/C. The hook JSON parsed separately. Searching the fixtures directory for the source home path and source creator/account/balance values gave zero matches; the diff was read. This checks the shape and Tagma's working metadata parser, not a re-import of the neutralized set into the vendor SQLite. Types and check:change for a data-only change were not run.

## Finding and limits

Confirmed: vendor `thread/fork` to B and whole creates separate durable paginated roots; the installed TUI takes both via `resume` with no prompt, shows the wanted prefix, keeps turn ids and does not change X. Refuted: the assumption that SessionStart already proves identity at the moment a bare idle TUI opens; in the measured window it is absent, and the first permitted turn yields a hook with id Y. The deferred hook does not refute the cut, but needs another identity source before the first turn.

Finding for the adapter: `history_base` must be read together with the source rollout, not as a self-sufficient copy of the child JSONL. The probe does not check rewind/revert, interrupted turn, races, host restart, another's account, the child's independence from later X deletion, model cache warmth, or Tagma's terminal-history implementation. The chosen model's minimum price is not proven numerically.
