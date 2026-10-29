---
id: 01a17d65-b4e3-7b4c-a251-2f00706cd058
title: "A vendor ACP call gets the native form by tool kind: reading is a file, execution a command, search a list"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d66-7969-76b0-ae46-dc4f6e7e48a6",
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/calls.ts
---
A vendor ACP call (Claude Code, Codex) became the `text` or `diff` form (`external-harnesses/protocol/calls.ts`, `displayOf`): file reading went with no highlight or numbers, a command with no `command` form and no outcome in facts, raw `rawOutput` as JSON. The same Tagma-agent call renders in `code`, `command`, `list` forms. The decision is in spec b7bb8a8f: ACP threads behave like native.

The ACP adapter maps a vendor call to the native form by ACP kind (`ToolKind`) where the vendor frame unambiguously carries what's needed: reading is `code` with path and language, execution is `command` with command, output and outcome, search is `list`. Where the vendor frame carries none of this unambiguously, the call stays `text`, and the adapter's code names this as a transport property.
