---
id: 01a1732d-103b-7b7c-9f12-51b41bef914f
title: "Grok Build 1.0.62: whole fork into a set UUID with no prompt keeps prompt ids and leaves the source untouched"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Grok Build 1.0.62 (1474f9cbdd91) [stable]; live held-PTY probe",
      "ref": "2026-10-25; ~/.local/bin/grok; source/fork fixtures in apps/tagma/server/src/external-harnesses/testing/fixtures/grok/; https://docs.x.ai/developers/pricing"
    }
  }
edges:
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-7214504dbcc7
---
## Observation

2026-10-25, macOS, installed `grok 1.0.62 (1474f9cbdd91) [stable]`, binary `~/.local/bin/grok`. Confirmed on a personal two-user-turn conversation: `--resume X --fork-session --session-id Y` opens the TUI on Y with no new prompt, shows both earlier questions and answers, keeps prompt ids, and leaves X's files untouched.

X = `6cb5838c-d514-46d2-bd21-d8a34544062a`; Y = `2b75ac94-1b1e-49b6-a99f-5d3613d43029`.

### Conditions and exact launch

`P=~/.tagma-dev/scratch/01a17327-7201-7baf-bfe4-0b980085c3d9/grok-probe`. Personal empty `P/work`, `P/home`, `P/state`; cwd of both launches — `P/work`. Environment: `HOME=P/home`, `GROK_HOME=P/state`, `GROK_MANAGED_MCPS_ENABLED=false`, `GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED=false`, `GROK_AGENT_DASHBOARD=0`; `GROK_CONFIG`, `GROK_CONFIG_PATH`, `XAI_API_KEY` removed. A temporary copy of the operator's auth.json served for login; after both processes stopped it was deleted. No secrets were carried into fixtures.

Personal `P/state/config.toml`: `[cli] auto_update=false, use_leader=false`; `[features] telemetry=false, managed_config=false, codebase_indexing=false`; `[models] default="grok-4.5"`; in `[compat.claude]` and `[compat.cursor]` skills/rules/agents/mcps/hooks/sessions are off, in `[compat.codex]` sessions=false; `[managed_mcps] enabled=false, gateway_tools_enabled=false`. So the operator's user instructions, hooks, and MCPs never loaded from his usual HOME/GROK_HOME. Tagma and the browser never launched.

`grok models` on the account listed only `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`. `grok-4.5` was picked, effort `low`: per the official [price table](https://docs.x.ai/developers/pricing) read 2026-10-25, 4.5/4.6/4.7 share the same minimum input/output rates among this list, 4.5 has the lowest cached-input rate; fast costs more. That is the choice basis, not a subscription-bill measurement.

Exact source argv:

```text
~/.local/bin/grok --session-id 6cb5838c-d514-46d2-bd21-d8a34544062a --model grok-4.5 --reasoning-effort low --no-subagents --disable-web-search --system-prompt-override 'You are a neutral session-storage fixture. Reply exactly as requested. Do not use tools.'
```

Through held PTY `03377dbd-09b4-4bfd-9e67-534ddd5d784f:167`, 120×36, only `Reply exactly NEUTRAL_ONE.` and `Reply exactly NEUTRAL_TWO.` were sent. Screen and updates hold the `NEUTRAL_ONE`, `NEUTRAL_TWO` answers. Each turn_completed has `modelCalls=1`; auxiliary CLI requests were not counted separately. The source was stopped before baseline hashing: stop_terminal reported exit 0 at hang-up, cleanup complete, survived=0, unverified=0.

Exact fork argv with the same environment:

```text
~/.local/bin/grok --resume 6cb5838c-d514-46d2-bd21-d8a34544062a --fork-session --session-id 2b75ac94-1b1e-49b6-a99f-5d3613d43029 --model grok-4.5 --reasoning-effort low --no-subagents --disable-web-search --system-prompt-override 'You are a neutral session-storage fixture. Reply exactly as requested. Do not use tools.'
```

Held PTY `6a80b030-9d17-4495-8626-8281c8089199:167`, 120×36; the first screen read showed both earlier turns and an empty composer. Not a byte was sent into that PTY. The fork was stopped too: exit 0 at hang-up, cleanup complete, survived=0, unverified=0. All TUI interactions ran via start_terminal/write_terminal/read_terminal_screen/stop_terminal.

### Files and identity

Source data directory `P/state/sessions/<encodeURIComponent(P/work)>/<UUID>/`. In `Y/summary.json` the `info.id` field is Y, `parent_session_id` is X, `session_kind="fork"`. `X/summary.json` keeps X.

`X/updates.jsonl`: 6 lines — two user_message_chunk, two agent_message_chunk, two turn_completed. `Y/updates.jsonl`: the same six updates with `params.sessionId=Y` and a new outer timestamp, then background_tasks with empty tasks. Inherited `_meta.eventId` still holds X; the current root must not be inferred from its prefix. `_meta.promptId` of answers and `update.prompt_id` of completions are kept in order:

1. `e471c37c-09e4-47b2-8519-3964387acda3`;
2. `02a1ed60-92ef-4539-a8dc-16d992e9843d`.

After stopping Y, all 16 files of the X directory were re-read and re-hashed: names, sizes, and SHA-256 matched the baseline after stopping X. No file added, none gone. Non-empty files with identical before/after SHA-256:

```text
chat_history.jsonl       4cbaa974b2ba26ff961f15a3e773b2a703d692f0219a192f9500d234d9b61a91
events.jsonl             f90b15683af5dc1b6f76ed01ae2ffa627702dc88b4ba3bc6f4183891cff71759
prompt_context.json      c8beaf7dd53361318c43489909fd9098be53f816d72a7bfb107a50048cbe6b53
rewind_points.jsonl      11af9715ab1ea6f7e1e73ea82806e89acafb21044685d4fabbd32c5053fa1b72
signals.json             3f0ba071c20418bff1dda483e387b6b3ab1bf6c1215fb54a227abc150bbfc168
summary.json             ff7cb9de086c76ba38dabd981a58ded820fa6fc6351ebdda98b96988928d6ddb
system_prompt.txt        5b411d1588c3467b94a5f81ccc9bd9b7e0e713b4024513c66e5e6f6707733258
title_refresh_idx        6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b
tool_definitions.json    8f8c9954ecef59b3923c94866f1b0796bdecd73a0a562510829b22ee05b1ec53
updates.jsonl            53cfee2ede49bfbfb1b73e631cb54a27f5727f0e89d15fd5554255a4db92fbdc
usage.json               48031bd706ff469665712dd9e81edb82b017deaff4a20f7d5ce1285d157a6b43
```

The remaining five are empty chat_history.jsonl.lock, rewind_points.jsonl.lock, summary.json.lock, updates.jsonl.lock, usage.json.lock; each SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

### Kept fixtures and checks

`apps/tagma/server/src/external-harnesses/testing/fixtures/grok/` keeps `source.summary.json`, `source.updates.jsonl`, `fork.summary.json`, `fork.updates.jsonl`. JSONL were copied byte-for-byte via a dedicated write fromFile; summaries were kept with the same fields and values with the only scrub replacements: `info.cwd` → `/fixtures/grok/work`, `grok_home` → `/fixtures/grok/state`. UUIDs, prompt ids, event ids, timestamps, usage, and remaining fields are unchanged. A deepEqual check against the original after the two replacements confirmed that boundary; the private-path scan is clean. 8818 bytes total.

Both summaries were accepted by the real `grok(rootKey, text)` from vendors/grok/metadata.ts: model=grok-4.5, title="Exact Neutral One Two Replies". Both JSONL were parsed by the real `grokEnds.reader.judge(rows.toReversed(), true)` from vendors/grok/ends.ts: `{_tag:"Completed",message:"NEUTRAL_TWO"}`. Byte-for-byte comparison of the JSONL against the original passed. The diff of the four new files was read; production code, tests, and spec were unchanged. No new tests: here the external format and behavior are proven, not a new Tagma guarantee.

### Extra probe: SessionStart on idle open

Observation of 2026-10-25: the same installed `grok 1.0.62 (1474f9cbdd91) [stable]`, same personal X, HOME/GROK_HOME, cwd, config, and model. The CLI itself wrote `default_reasoning_effort=low`, ui and marketplace params into the isolated config; the operator's user config was untouched. New root Y2=`bfabafa4-6eb9-442f-a253-3652a944cf2e`. Exact argv:

```text
~/.local/bin/grok --resume 6cb5838c-d514-46d2-bd21-d8a34544062a --fork-session --session-id bfabafa4-6eb9-442f-a253-3652a944cf2e --model grok-4.5 --reasoning-effort low --no-subagents --disable-web-search --trust --system-prompt-override 'You are a neutral session-storage fixture. Reply exactly as requested. Do not use tools.'
```

`P/work/.grok/hooks/tagma.json` temporarily held one `SessionStart` matcher group with a single command hook: `/opt/homebrew/bin/bun P/capture-start.ts`, where P is expanded to the absolute scratch path named above. The script read all of `Bun.stdin.text()` unparsed and kept it in `P/session-start.raw.json`; it separately wrote receivedAt after stdin was read into `P/session-start.timing.json`. This is a personal capture, not a Tagma hook. The extra `--trust` allowed the project hook only for the personal fixture folder; login and compatibility stayed isolated.

Held PTY `a05cf723-d7e9-4ee7-88f5-283f6eede07d:167`, 120×36, opened the two earlier turns and an empty composer. Not a byte was sent into that PTY. Already on the first idle-screen read the raw capture existed: payload timestamp=`2026-10-25T13:23:37.650940+00:00`, capture receivedAt=`2026-10-25T13:23:37.684Z`. The event arrived before a new prompt; a fallback probe with a prompt was unnecessary and never ran. The gap between payload timestamp and receivedAt is about 33 ms on this machine; this is no total-launch measurement.

Payload: `hookEventName="session_start"`, `hook_event_name="SessionStart"`, `sessionId=session_id=Y2`, `source="load"`, `permissionMode=permission_mode="default"`; both `transcriptPath`/`transcript_path` point at `Y2/updates.jsonl`. So in this probe SessionStart on idle open already reports the new assigned root, not X; the source value is exactly `load`, not a guessed `fork`/`resume`.

`apps/tagma/server/src/external-harnesses/testing/fixtures/grok/session-start.json` keeps the whole raw payload object with the only scrub replacements: `cwd` and `workspaceRoot` → `/fixtures/grok/work`; `transcriptPath` and `transcript_path` → `/fixtures/grok/state/sessions/%2Ffixtures%2Fgrok%2Fwork/bfabafa4-6eb9-442f-a253-3652a944cf2e/updates.jsonl`. Fields, aliases, UUID, timestamp, source, and permissionMode are neither dropped nor changed; a trailing newline is added. DeepEqual after the four replacements confirmed the boundary; JSON.parse and the private-path scan passed. The real Grok adapter accepted the fixture: `grok.sessionKeyOf(payload)=Y2`, `grok.occasionOf({name:payload.hookEventName,tool:null})="session-start"`. The diff was read; types/check:change for this data-only delivery were not run.

The process was stopped via stop_terminal: exit 0 at hang-up, cleanup complete, survived=0, unverified=0. The temporary auth.json and project hook were deleted. Tagma/browser never launched; no foreign sessions were opened. Limit: only this whole fork in a trusted fixture folder with no new user turn was checked; behavior without trust, on hook error, in compaction, and for subagents is undetermined by this experiment.

## Conclusions and bounds

Confirmed for whole-session fork 1.0.62 on this two-turn conversation: the preassigned Y is accepted without a prompt, the TUI restored history, prompt ids are kept, the whole X directory is byte-identical. The adapter may match earlier turns by prompt ids on such a full fork; that is a measurement conclusion, not proof of already implemented Tagma support.

Whole-fork before a turn, rewind, compaction, tool calls, and continuing Y with a new user turn are unchecked; SessionStart on idle open of a whole fork is checked by the extra probe above. No claims about cache completeness or subscription billing. Fixtures are small real summary/updates for parser checks, not a portable resumable directory. The experiment's other original files stayed in scratch; outside this probe the study alone does not reproduce them.
