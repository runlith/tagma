---
id: 01a17adc-0b73-7652-a40b-bc8da9ddeb9f
title: submit_work refuses walk-cut "does not parse" for a file whose lines a file-tool round trip left partly as nobody's
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "refused[walk-cut] \"packages/mcp/src/sdk.ts: does not parse at line 374: Unexpected token\" with unblock \"ask again on a busy server\"; read_changes showed \"nobody +0/−10 (written outside the record)\", and only whole: [sdk.ts] landed it.",
    "command": "submit_work {subject: \"Give MCP servers the project's places as roots…\"} in ~/runlith/tagma after write fromFile HEAD versions of packages/mcp/src/sdk.ts, bun test, write fromFile back",
    "expected": "The session's own lines of packages/mcp/src/sdk.ts land, since every write to it went through the write/edit tools of this session."
  }
---
Filed from project `runlith`.

Session 01a17ab1-c65f-7741-a3d3-0fcb142a861b. To prove a red test on HEAD code, the session replaced six files with their HEAD text through `write fromFile`, ran a bun test command, and restored its own versions through `write fromFile` (files byte-identical to the saved copies, checked with cmp). The record then judged 10 removed lines of sdk.ts and 1 of native-harness/tools/mcpServers.ts as nobody's, "written outside the record". The walk built a tree without them, which did not parse, and the refusal named a parse error at a valid line and a busy-server retry as the way out; the real exit was `whole`. Two faults: the attribution of file-tool writes to nobody, and a walk-cut reason/unblock that does not name the nobody's lines that cut it.