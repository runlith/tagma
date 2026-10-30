---
id: 01a17319-75a7-7026-b6a0-7216b9c8b99d
title: "Cursor Agent 2026.10.22: TUI fork creates a UUID; rewind changes the root of the same store.db"
ord: 17
tags: ["research"]
fields:
  {
    "source": {
      "name": "Cursor Agent 2026.10.22-27dcf5f",
      "ref": "2026-10-25; ~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f/{index.js,8008.index.js}; https://cursor.com/docs/cli/reference/slash-commands; https://cursor.com/docs/cli/changelog"
    }
  }
edges:
  - kind: relates
    to: 01a108e9-6003-7ee7-aec9-b4cd16b1a7be
---
Read 2026-10-25: installed `cursor-agent --version` → `2026.10.22-27dcf5f`; root/create-chat/ls help; JS bundles of the installed package `~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f/{index.js,8008.index.js,3105.index.js,5622.index.js}`; official CLI slash commands and changelog. No new CLI/model/ACP sessions were started. Names like `./src/...` below are saved webpack module names inside the installed bundle, not an external source checkout.

## Observation: argv and a preassigned id

`cursor-agent --resume X` continues a CLI chat. `--continue` picks the last one. The root help holds no documented whole-fork/fork-at-point/resume-at-point launch flags: fork lives inside the TUI. `create-chat` creates an empty chat and returns an id, but launching it was not performed here (not help-only).

`index.js` hides `--new-session-id <uuid>`; `./src/state/requested-session-id.ts` in `8008.index.js` requires UUIDv4, a new directory, and explicitly **forbids combining it with --resume/--continue**. That is a way to a new empty chat, not a preassigned fork. The `/fork` caller generates a randomUUID itself and takes no id from slash args. Conclusion over the available entry points: a fork id cannot be assigned in advance; that is no claim about the internal fork helper, which technically accepts a sessionId.

## Observation: TUI fork/rewind persist in different ways

The [official slash-command list](https://cursor.com/docs/cli/reference/slash-commands) describes `/fork` as a new session and `/rewind` as stepping back. The [CLI changelog](https://cursor.com/docs/cli/changelog), April 2026, describes the timeline and conversation-only restore; aliases `/undo`, `/restore`.

The installed bundle gives the sharper answer. `8008.index.js`, `./src/state/fork-chat-session.ts`, helper `g`: copies **all blobs** of the source store into a new `store.db`, sets a new agentId, createdAt, and the same latestRootBlobId, carries mode/model over, writes a sidecar. TUI `onForkChat` generates a new randomUUID, opens a new AgentStore, switches to it, leaving the old id available for resume. `/fork` aliases duplicate/clone/branch. This is a whole-history fork of the active root, with no point in the slash command.

`./src/history/conversation-rewind-projection.ts`: the point is `turnIndex` plus `UserMessage.messageId`, the anchor is the `UserMessage.conversationStateBlobId` state **before** the turn. `./src/history/rewind-orchestrator.ts`: changes metadata **latestRootBlobId in the same AgentStore** to anchorRootBlobId, then resetFromDb. No new agentId/directory is created, old blobs are not physically deleted. The UI offers files-and-conversation or conversation-only and returns the picked prompt/images to the composer. So rewind keeps the session id but rewrites the active-history pointer; it does not cut JSONL.

## Observation: storage, observability, manual copy

`store.db` is a SQLite KV/blob store; conversation state and messages are serialized as protobuf; latestRootBlobId picks the active history. The CLI uses `~/.cursor/chats/<workspaceHash>/<chatId>/` with meta.json; ACP uses a separate `~/.cursor/acp-sessions/<id>/`. The earlier live 2026.09.15 probe proved these histories are separate; passing an ACP UUID to CLI --resume could create an empty CLI chat with the same UUID rather than move history. A successful --resume does not prove kept context.

Fork is visible by a new directory/meta id and later hooks session_id; rewind by a changed latestRootBlobId and a rebuilt transcript. The orchestrator as read never invokes a separate rewind hook. Immediate delivery of an updated text transcript/SessionStart on fork is unconfirmed by a live probe: the transcript is derived, not resume input.

A custom helper implements an offline fork by copying blobs and metadata, so a consistent store move is technically possible. But **acceptance of a manually copied/renamed store.db by the TUI is unverified**: agentId and sidecar must change, not the folder name; trimming a text transcript does not change model history. Byte-truncating SQLite is no conversation cut.

## Open probes

After separate permission on a personal fixture: `cursor-agent --resume X`, `/fork`, check the new id/directory, hooks, and unchanged source latestRootBlobId; then `cursor-agent --resume X`, `/rewind`, pick conversation-only to the second turn, compare id/latestRootBlobId, exit/repeat resume. For a manual copy — a separate Cursor data home with a full DB copy, new agentId/sidecar; `cursor-agent --resume Y`, check the shown history without a new model prompt. The combination `cursor-agent --new-session-id Y --resume X` is rejected by code; running it for proof is not required.
