---
id: 01a17840-e1b7-7cec-8268-b118346e149c
title: "An execution of a replaced host generation reads as an empty reference: waiting for its end resolves at once, custody is dropped as generation-ended"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/endings.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/terminals/custody.ts
    symbol: makeTerminalCustody
  - kind: symbol
    ref: apps/tagma/server/src/executions/terminals/discharge.ts
    symbol: makeTerminalDischarge
---
The host answers a live read of a past-generation execution with a `HostUnavailable` refusal ("generation N was replaced by M"), and an `Ending` with no recorded end with an empty answer. Neither will ever change: that generation's execution left with it. So `Terminals` itself decides by generation fact: a `state` refusal for a reference below the current generation reads as "the host holds nothing" (`state` answers empty, `wait` answers `Unwatchable`, as for any reference with an empty host under it), and custody is dropped by the same `dischargeReplaced` as stop and the load-time pass: `TerminalEndings.follow` — right after the `Unwatchable` decision, `Discharge.ended` — when the replaced generation has no recorded end. An already dropped `dischargeReplaced` obligation is left alone. Without this, a generation changed under a live server would hold custody and uses until the next load: the periodic `disposition` pass looks only at the current generation.

Without this, `TerminalEndings.follow` took the refusal for an unreachable host and asked again without end, and `decided` answered nobody: archiving and deleting a thread with such a CLI session, its end and stop hung until the tool's limit. And `settle` for an execution whose generation changed after the decision would hold custody as `unended` forever.

A refusal with the same tag for another reason (the host is busy handing over, subscriptions exhausted) stays a failure: it is asked again, because the refusal may still turn into an answer. Generation is read only after a refusal, so ordinary waiting pays no extra question to the host.
