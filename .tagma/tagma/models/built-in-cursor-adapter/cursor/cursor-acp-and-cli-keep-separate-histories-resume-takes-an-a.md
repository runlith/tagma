---
id: 01a108e9-6003-7ee7-aec9-b4cd16b1a7be
title: "Cursor ACP and CLI keep separate histories: --resume takes an ACP UUID as a new CLI chat, sharedSessions false"
ord: 8
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor-agent 2026.09.15-d2fe57e; ACP session/list/load/replay, CLI create-chat/ls/resume, JSON meta/transcript; 2026-10-04",
      "ref": "~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/cursor/ — storage*.jsonl, cli-ls-workspace.txt, cli-create-chat.json, cli-resume-acp-trusted.json, cli-probes.py, cli-control.py, user-state"
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
Measured 2026-10-04 on `cursor-agent 2026.09.15-d2fe57e`, macOS arm64. Own ACP sessions created in a temporary tools workspace and a CLI chat in the storage workspace. SQLite was neither read nor changed: measurement rests on public session/list/load, CLI ls/resume, file paths/meta.json, the official CLI transcript and ACP replay. Frames `storage.jsonl`, `storage-replay.jsonl`, TUI record `cli-ls-workspace.txt`, `cli-create-chat.json`, `cli-resume-acp-trusted.json` are kept.

## Storages and history differ

ACP keeps state in `~/.cursor/acp-sessions/<sessionId>/`; CLI — in `~/.cursor/chats/<workspaceHash>/<chatId>/`. `agent ls` in This workspace showed No sessions in this workspace with the tools ACP sessions already standing. ACP `session/list {cwd:storage}` returned an empty list after `agent create-chat`; `session/load` of that CLI id refused:

```json
{"code":-32602,"message":"Invalid params","data":{"message":"Session \"d5fac7f2-4236-4e08-bce5-2d7f5d1bf48b\" not found"}}
```

CLI `agent --trust --resume <ACP-id> --print …` formally took the ACP session UUID and answered RESUMED with the same session_id. But this does not continue its history: a separate CLI store.db/meta.json appeared under `chats/1ad17f57677c9fc13206f0484e1239eb/d21fa7e2-bebb-4db5-816fd5b2f2fd`, with creation-timeMs of the CLI probe. The official CLI transcript holds only the new user prompt and RESUMED. After that, ACP session/load of the same UUID replayed the source ACP prompt with read/edit/shell and DONE, with no new CLI prompt and RESUMED. The same UUID in two paths means no shared conversation.

For this build's profile `sharedSessions:false`: switching terminal ↔ acp needs a new vendor context with recap. A successful CLI --resume of an arbitrary passed UUID must not be taken as proof of context carry-over. Whether another documented way to import history exists is not established by this probe. All created own sessions and their temporary project/transcript directories were deleted after the evidence was kept.
