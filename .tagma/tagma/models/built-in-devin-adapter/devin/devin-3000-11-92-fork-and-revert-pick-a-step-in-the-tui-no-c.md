---
id: 01a17319-75a7-7026-b6a0-72156eeb5374
title: "Devin 3000.11.92: fork and revert pick a step in the TUI; no cut-point launch argv found"
ord: 9
tags: ["research"]
fields:
  {
    "source": {
      "name": "Devin CLI 3000.11.92 (7f4e64980e22)",
      "ref": "2026-10-25; installed devin --help/--version; https://docs.devin.ai/cli/reference/commands; https://docs.devin.ai/cli/changelog/stable"
    }
  }
edges:
  - kind: relates
    to: 01a11d92-f128-7f29-9288-79ba04ba7dd7
---
Read 2026-10-25: installed `devin --version` → `devin 3000.11.92 (7f4e64980e22)`; root/acp help; official Commands & Flags and Stable changelog. No Devin source clone was among the references given. No new TUI/model/ACP sessions were started. The earlier transcript record belongs to the live 3000.11.3 probe, not the current binary.

## Observation: launch argv

`devin --resume X` (or `-r X`) continues a specific id; `--continue` picks the last one. The installed root help has no fork, truncate-at-step, session-id, or import-transcript launch flags. Help says `--export [PATH]` exports the conversation after every turn. Export is no resume input. No documented argv for whole-fork or resume/fork-at-point was found; that is no claim about missing internal ACP methods.

## Observation: interactive commands

[Commands & Flags](https://docs.devin.ai/cli/reference/commands), Session Management: `/fork [step]` creates a **new session**, with an optional point from `/steps`; `/revert <step>` rolls file changes back from that step and the conversation **before** the step. `/revert` with no argument opens a picker; the [Stable changelog](https://docs.devin.ai/cli/changelog/stable) ties the picker and double-Esc at idle to v2026.4.24-1 of 2026-04-24. v2026.4.17-0 of 2026-04-17 added `/steps` and `[step]` for fork. V3000.4.16 of 2026-08-10 says a fork with no point picks the latest step, and completed ask_user_question also become steps. So a step is not necessarily a user-turn boundary.

The docs do not establish whether the picked step itself is included in the fork, which internal node_id it maps to, whether `/revert` keeps the session id, or whether the inactive tail stays. **Revert identity stays unverified.** In the installed binary `~/.local/share/devin/cli/_versions/3000.11.92/bin/devin`, the strings `fork_session_from_node` and an ACP revert diagnostic prefix naming that function were found; no string can prove which id the TUI then gets. Same-id cannot be inferred from the word revert.

## Observation: storage and observability

The earlier live CLI 3000.11.3 probe established `~/.local/share/devin/cli/sessions.db` (SQLite, message_nodes) and `transcripts/<session_id>.json`. The hook session_id is a short name like splashy-quail; transcript_path was not passed in hooks. ATIF-v1.7 is a whole JSON with `steps[]` carrying step_id/source/message/tool_calls/observation; the file was rewritten, not appended. Current official help still names ATIF export. The 3000.11.92 binary holds SQL for sessions and message_nodes with node_id/parent_node_id and fork-related SQL; that confirms a persistence model exists, not a new measurement of the real path or schema.

No separate fork/revert hook was found in the documents read. A new fork id can be checked by later hooks session_id/export session_id; for revert the id before/after and a full re-read of ATIF are needed, not just waiting for appended lines. Which events arrive exactly on these slash commands is unmeasured.

## Conclusion and open probes

ATIF is an export, not a proven resume source. **Copying/trimming ATIF is undetermined as a fork/rewind means**: working state lives in SQLite, and no documented import exists. Hand-copying/editing sessions.db and replanting chain heads are unverified and undescribed as a CLI contract.

After separate permission, in a personal fixture: `devin --resume X --export /tmp/devin-fork-probe.json`; run `/steps`, record numbers and text, then `/fork N`, compare the id on screen/in hooks/export and inclusion of the picked step; repeat from the source `devin --resume X --export /tmp/devin-revert-probe.json`, `/revert N`, check the id before/after, ATIF, and kept files; exit and `devin --resume <result-id>` for persistence. Separately compare a fork with no N against whole history. To check a manual import, prepare an isolated full copy of the data home and an edited ATIF with unchanged DB: `XDG_DATA_HOME=<fixture-home> devin --resume X`; watch whether ATIF is ignored. None of these probes were run.
