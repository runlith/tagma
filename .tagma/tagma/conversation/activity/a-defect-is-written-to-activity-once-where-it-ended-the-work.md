---
id: 01a1555f-65b1-7c70-bd34-9cb28c0ddf3f
title: A defect is written to activity once — where it ended the work or became the answer — and the error list reads only these notes through a partial index
ord: 25
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1554e-6da7-7ec4-8ead-4daf77e3146e
sources:
  - kind: file
    ref: packages/activity/src/fault.ts
  - kind: file
    ref: packages/activity/src/store/faulting.ts
  - kind: symbol
    ref: packages/activity/src/Activity.ts
    symbol: defected
  - kind: symbol
    ref: packages/activity/src/Activity.ts
    symbol: degraded
  - kind: symbol
    ref: packages/activity/src/Activity.ts
    symbol: degradedSync
---
The operator's error list reads only `defect` and `degraded` notes in activity. So where and how many times such a note is written matters.

- **A defect is written once.** The `defect` note is placed by the close of the innermost activity the defect ended. Outer activities the same error object passes through skip it: `fault.ts` remembers objects already recorded. Without this, one bug would count as many times as the activities it crossed. A defect the code turns into an answer or a typed failure closes no activity as defective. These places call `defected` themselves: the tool door (the model's answer about a tool refusal), the step loop (a run failure), operation calls over HTTP and socket (`performByIdIn`, place — the operation id, context — [[ab91b910]]), HTTP-door and socket steps outside a call, the ACP session drive and the CLI terminal-session drive. A live socket writes a handler death that executes no operation in the `CallLog` middleware with the original cause, so a defect already recorded by an activity inside the handler is not written twice. A response-encoding failure of RpcServer turns itself into an `Exit` with a defect, and the handler never sees it. So `send` records an `Exit` with a defect only if the request handler ran and did not die. A request that never reached the handler — an unreadable payload, unknown tag or id — RpcServer also answers with a defect. That is a client error; it does not go on the list. The ACP session drive calls it on any failure but interruption: that failure becomes the `uncertain` state. The CLI terminal-session drive (place `terminal drive`) writes only the defect: a failure before the start send ends the session `failed`, after it leaves `uncertain`, and a typed failure in both cases is session state, not a server error. Otherwise these defects would vanish from the list.
- **`degraded` catches only a defect.** A typed failure is a condition; it is handled by type. An interruption must stop the work. A mandatory `why` is a best-effort declaration with a cause, required by [[ea465bed]].
- **`degradedSync` is for synchronous ports** that cannot wait on Effect, e.g. a hosted-call display under the ACP driver lock. It writes its own `fault` activity under the run, because a synchronous call has no current activity. `toldDegraded` writes that same activity for a caller that already survived the failure, such as a stored record a read degraded (`threads/journal/readWitness.ts`).
- **The group fingerprint is place plus message,** with ids and numbers replaced by `#`. This is how repeats of one bug with different rows and ids converge into one group. A message that varies in words splits into several groups.
- **Reading costs O(error records in the window), not O(all notes).** The partial index `note_fault` gives it. SQLite takes a partial index only if the query repeats its expression `json_extract(body, '$.type') in ('defect', 'degraded')` verbatim. A new error-note type changes the index and the query together.
- **Clear is a `mark` row in the store:** one per server, shared by all windows. A read window starts at the later of two bounds: the Clear mark and the activity retention. The store reads the mark once at open and keeps it beside the row, so `ActivityFaults.since` answers that start synchronously to a witness deciding whether its earlier note still shows.
- **`changes` ticks on a new error, on Clear, and on an error aging out of retention.** The deadline is checked on every upkeep pass, before retention deletes the note. So a row drops out of an open window no later than the upkeep interval, not at the next error.
- **Pages turn by the `lastAt`, `fingerprint` key, newest first.** A group receiving a new repeat while the reader pages moves to the top: later pages will not have it, and on pages already read it stands with the old count.
- **The stack is cut to 3000 chars, the message to 1000.** A note is metadata with a third-of-a-page-envelope ceiling. A longer note would be rejected whole as `metadata-ceiling` loss.
