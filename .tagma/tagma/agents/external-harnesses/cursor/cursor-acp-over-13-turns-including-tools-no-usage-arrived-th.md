---
id: 01a108e9-6003-7ee7-aec9-b4cc4a8fa2cc
title: "Cursor ACP: over 13 turns including tools, no usage arrived; the CLI JSON control gave tokens; quota and 401 never met"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor-agent 2026.09.15-d2fe57e, ACP v1, Free/Auto; 13 ACP turns + 2 CLI controls; live probe 2026-10-04",
      "ref": "~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/cursor/ — full JSONL, summarize.mjs, summary.json, cli-*-trusted.json, restoration-first.json, restoration.json, cleanup.py"
    }
  }
edges:
  - kind: discovered-from
    to: 01a108ce-ee39-7d2f-9573-86fc0db65596
  - kind: relates
    to: 01a1050f-fe45-7d5b-a4d9-cb5c3632e800
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Measured 2026-10-04 on `cursor-agent 2026.09.15-d2fe57e`, kept login, Free plan, Auto. This series sent 13 ACP prompts: six MCP probes, one read/edit/shell turn, two cancels, two mid-turn-probe prompts, ask and plan. Two more successful CLI turns are needed to check sharedSessions and the hooks fixture's fitness. Two earlier CLI attempts were locally rejected with Workspace Trust Required before the model started; they are not model turns. Total — 15 started turns. Scripts and full raw answers are kept; `summarize.mjs` counts ACP prompts and all update kinds into `summary.json`.

## ACP spend never arrived, even on tools

None of the 13 ACP prompts brought `usage_update`, usage, tokens or cost. That includes successfully run MCP tools/call, file read/edit and shell. Prompt answers held only stopReason: end_turn or cancelled. Replaying history via load added no usage either. Absence in this series does not prove absence on another model or build, but this measured configuration's profile cannot show zero spend as measured: spent must name turns with unknown spend.

In the CLI control `--print --output-format json` gave usage. A Read turn returned `{"inputTokens":11560,"outputTokens":124,"cacheReadTokens":18944,"cacheWriteTokens":0}` together with duration_ms/duration_api_ms, session_id and request_id (`cli-hook-control-trusted.json`). A tool-less turn returned inputTokens 12644, outputTokens 91, cacheReadTokens 2688, cacheWriteTokens 0 (`cli-resume-acp-trusted.json`). That confirms measurable usage on this build's CLI, but not a way to get an ACP session's spend; carrying CLI numbers onto ACP is unmeasured.

## Quota and 401 stayed unchecked

During the 15 started turns no exhausted-quota or 401 errors met. Quota was deliberately not exhausted, credentials neither deleted nor replaced. So these probes did not establish the exact ACP shape of a quota or auth refusal mid-turn. The old native note about the Free usage limit does not replace the ACP measurement: the current Auto turns truly answered.

## User state returned

Before measuring, source copies of cli-config.json, acp-config.json and all top-level ~/.cursor files were taken. After every model variant both configs were restored by copying. At the end the changed statsig-cache.json was also restored, all 20 created ACP sessions, two CLI chats with their own UUID/workspace hashes, the temporary projects' approval/worker/transcript directories and the created plan file deleted. CLI Backspace-delete was called in the matching workspace's single line, but the final deletion of its own files is confirmed by disk; the ACP build offers no delete/close method. Metadata, transcripts, plan and approval are kept in `user-state`, the deletion journal and hashes — `restoration-first.json` and `restoration.json`. All kept top-level ~/.cursor files matched the sources byte for byte, no created ACP ids remain. No real Tagma grant was issued, Tagma Keychain and server unchanged, checkout unedited.
