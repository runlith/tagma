---
id: 01a11cc4-66ff-7154-8257-e70bc5cc143d
title: A tool call over ACP is recorded with a native typed record, and the vendor's raw record stays in toolOutput
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a11caa-42ff-703c-82f5-4128b0dc848c
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/calls.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/protocol/projection.ts
    symbol: standingIds
---
The vendor tool call over ACP is recorded with the same `ThreadToolEntry` as on native: the protocol projection (`protocol/calls.ts`) translates the frame before ingress, and the client and kernel do not parse ACP forms. State and outcome come from the shared `settleTool`: `completed` — a reply, `failed` — `output-error` with the text the agent gave (words from `content`, else `rawOutput`), `pending` and `in_progress` — `input-available`. ACP does not tell a domain refusal from a failure, so it never has `output-refused` or `output-denied`.

Queue and start are the record's `execution` field, the agent's testimony: `pending` — `queued`, the first `in_progress` — `started` with the moment of the step that recorded it. The start is held until the call ends: the next frame and the final record take it from the standing journal record (the driver reads it point-wise for a frame without its own `ToolCallStarted` in the same step) rather than stamping a new moment. A call that ended without `in_progress` carries no field: the agent never said when it started. An open call's status change is a driver durable step, though the ACP machine counts such a step as live: otherwise the start would not reach the journal before the call ends.

`toolOutput` stays the vendor's record `{content, locations, rawOutput}` in any call state, including a call still running: a late `tool_call_update` arriving after the call end merges into it by ACP rules (a field absent from the update does not change), and the display is rebuilt from the merged result. So vendor forms from `toolOutput` are read by this file alone. A record that has `toolOutput` but not in this form is not changed by an update: the projection writes an interruption into the feed rather than overwriting the old. For a Tagma operation reply, `invocation` delivers the declared result display into `_meta.toolDisplay`; ACP reads it at the protocol boundary, keeping the raw reply in `toolOutput`. For other frames the display is built from `content` and `locations`: a `diff` with the file for each agent diff in frame order; else `text` from the agent's words; else `text` from `rawOutput` if there are no terminals; else `none`. A failed call already has these words in `toolError`, so its non-diff display is `none`: the feed draws the error from `toolError` plus the display text, and otherwise the same words would stand twice. Places (`path:line`) and terminal ids go to `details`, paths under the session cwd show relative, `mutates` marks the `edit`, `delete`, `move` and `execute` kinds. The patch is counted by the shared `toolFilePatch`, which native uses too; the agent repeats the diff in following frames, so patches of the latest diffs are remembered by value and not counted twice. A call that Tagma itself executes gets only the initial record here — with the display that hosting gives, not from a frame; hosting writes the final one. The vendor call's tool-result for the model history is also gathered here: whole words from `content`, without the display limit, else `rawOutput`. Tagma has no limit on it deliberately: these are exactly the words the model already holds in its context, and Claude Code set the measure — a cut result would diverge from what the model saw.
