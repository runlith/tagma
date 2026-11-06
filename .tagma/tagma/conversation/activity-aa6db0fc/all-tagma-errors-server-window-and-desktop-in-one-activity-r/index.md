---
id: 01a179c9-bfb4-76ab-8a43-403ac8860d90
title: "All Tagma errors — server, window, and desktop — in one activity record and one read_faults door: refusal separated from defect at the producer, a storm as one group with a count and a burst"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0c6f0-27d3-71ea-90c2-b3debbed8039
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2abc2918809
  - kind: relates
    to: 01a1554e-6da7-7ec4-8ead-4daf77e3146e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/notices/Service.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Door.ts
  - kind: file
    ref: apps/tagma/server/src/activity/operations.ts
  - kind: file
    ref: packages/activity/src/fault.ts
---
**Why.** An agent taking Tagma's work apart reads errors with the `read_faults` operation, but it answers only server defects. What broke in the window and in the desktop process is invisible to the agent, and the list the operator sees mixes refusals with defects and says neither where nor why. Case 2026-10-26: the status bar showed 1004 errors, `read_faults` returned one line (a `call_hosted_tool` defect) and `lost: metadata-ceiling` on one fact.

## What stands now

1. **Window failures lie outside the record the agent reads.** Server defects are activity `defect` and `degraded` notes ([[8c0ddf3f]]); the live `faults.subscribe` feed and `read_faults` read them. Window failures are other facts (window-code exceptions, its background-work refusals), living in `Notices.faults`: one window's memory, 20 groups, gone on reload. The Errors list glues two records only on screen; `read_faults` never reaches the second.
2. **Two more places write nothing into the shared record.** The desktop main process: project windows and view windows do not listen to `render-process-gone`; the dictation pill listens but only changes its own state (`main.ts`); nobody listens to `uncaughtException`, `unhandledRejection`, and preload errors — a crash stays in Electron's stderr. After the door opens the server holds no process-level handlers (`process.on` stands only before the door, in `composition/attempt.ts`): an exception past every fiber and promise takes Bun's default behavior and lands in `serve.log`. A process death leaves a trace only while open activities existed then: on the next start `orphaned` closes them, while an idle server taken down by SIGKILL leaves nothing.
3. **The window does not know what it was answered.** `Door` turns five different things into one `Refusal`: a server refusal, a server defect (`server-fault`), a link break (`transport`), an unreadable answer (`contract-apart`), and its own pipeline's defect (`catchDefect` → `http` code). `contract-apart` is set on any decoding failure: the window remembers the first server contract it saw but not its own, so a decoder defect or a wrong answer of the same build is indistinguishable from a build divergence. Refusals distinguish a `gate` flag and code strings, and `refusalOf` sets `gate: false` on the `not-found` code. Then `Notices.refusal` makes a refusal with no `gate` and `words` into a "Server error", and `Notices.background` — any refusal into a code-titled error. So the list signed "Defects of the server and this window, not refusals" holds refusals.
4. **A window line with no place.** A window group has a heading, text, stack, and count — no route, project, thread, request, or build. Each repetition writes reactive state (`standing.count += 1` in `$state`, under `untrack`): reading does not subscribe the calling effect, but the write schedules work for everyone reading the list.
5. **`lost` is not about errors.** `read_faults` yields all activity losses over the read window (`lostBetween`, scope `global`, grouped by cause only). `metadata-ceiling` counts every rejected fact — an open, an end, an ordinary note, and a failure note: a failure's message and stack are cut by characters, while the fact's budget is in serialization bytes, with place unbounded at all. Whether a lost fact was a failure cannot be told from the record, and the agent does not know whether the list is complete.

**Three lines of the case.**
- `not-found` — "No checkout of a project on this machine answers to …": a background read via `Failure.report` → `Notices.background`, the refusal's code as heading; the refusal came from `workspace/checkouts/reads.ts`. The window asked for a checkout the server does not know. This is an answer, not a server defect.
- `page` — `https://svelte.dev/e/effect_update_depth_exceeded`: the `page` boundary in `Shell` caught a Svelte exception — the effect restarted past Svelte's per-flush limit. The release message is only an address, the stack — the minified Svelte scheduler; the boundary names neither component nor place. Hence the stack the window copies.
- `Server error ×1001` — "… is not a registered checkout": `not-found` from `workspace/subjects.ts` reached `Notices.refusal`, became "Server error" over `gate: false`, and counted 1001 with no stack. Hypothesis: the count is around Svelte's per-flush limit, and it is the same cycle as the `page` line, with the source in Git-tab effects calling `notices.refusal` from a standing request error ([[e1d4c1f1]]). The record does not prove it: the window saved neither component nor the link between lines.
- 1004 = 1001 and three lines of one each.

## What the error window takes and what it leaves

Taken:
- client failures leave in batches where the operator reads them, on a timer and on page leave; the client folds repetitions before sending, the server counts and groups;
- the failure kind is decided by values, not text: `Door`, the answer's producer, decides it;
- context is added by the runtime, not the call site: build, query-less route, session;
- the window's last-steps trail — transitions, `Door` calls (operation id, kind or outcome code, ms), identical polls folded ×n, no page words — only at the group's sample;
- every field has a ceiling and a cut order (trail first, then the stack's tail); what did not fit or was not accepted is counted, not silent.

Not taken:
- a separate in-process journal with its own lifetime: Tagma has activity with retention and loss accounting, a second journal would become a second owner;
- address limits, dropping others' builds, visitor counting: that guards a public door, while Tagma's door is its own user's local server ([[06e41b6f]]);
- a client dedup window that sends the first report and mutes the rest: the count vanishes, while Tagma sends the count;
- reception-side classification by trail: Tagma's window knows what it was answered;
- symbolication on read and chunk probes: release maps of Tagma lie outside the install and are read by `tagma:stack`, and window and server are one build. The record carries the build version for `tagma:stack` to find the map.

## Design

### One record, one door
The server writes window and desktop failures into activity — where server defects are. The Errors list, its feed, and `read_faults` read only activity. `Notices` stops owning failures and holds only cards.

**Clear** — the old mark on the server. It removes everything the server accepted before it — exactly what the server part of the list showed in any window — and the not-yet-delivered groups of the window where Clear was pressed. A group the server accepted after the mark appears, however old the failure: nobody has seen it yet. A line's time is the server's clock: a note lands with reception time, and when the failure happened the server derives from the group's age by the window's monotonic clock (how long since the first and last repetition before sending). A phone's or another machine's clock decides nothing.

### The failure kind is decided by the producer
A `Door` refusal carries the kind and the request that failed:
- `refused` — the server answered with a refusal with a code and ways out, `not-found` too;
- `server-fault` — the server broke on the call and itself recorded a defect;
- `lost` — no answer;
- `apart` — the answer does not read, and the server's contract differs from the contract the window was built with (the window knows its own);
- `defect` — the window code that built the call broke, or the answer does not read under the same contract.

A `Live` subscription failure carries the same kind and its feed's id. The `gate` flag and code comparisons leave consumers. A consumer decides by kind:

| kind | answer to a user gesture | background work with no place of its own |
|---|---|---|
| `refused` | refusal card | window `refused` line |
| `server-fault` | server line already exists, the window writes none | same |
| `lost`, `apart` | its own card | link or reload state, no line |
| `defect` | card and window `defect` line | window `defect` line |

`refused` in the list is not the server's error but the window's failure: the window itself, with no gesture, asks for what the server lacks. The line names the operation, the code, and the window's place.

### Window accounting
Window failures are taken by one window service at the application's root, shared by desktop and mobile shells: part boundaries ([[d83d0722]]), `error` and `unhandledrejection` events, `Failure.report`, and background refusals.
- **A repetition costs O(1):** fingerprint, a count increment in a plain `Map`, a place-context update, and a burst counter — the most repetitions per one window task, reset by a microtask. No reactive write, no request. Place (route, project, thread) is read with no subscription of the calling effect. So a reporter cannot become part of the cycle it reports. A burst of 1001 per task names a synchronous cycle, 1001 per hour — a poll.
- **Sample.** The group's first repetition after its last send takes the stack: an error's stack, a refusal's — the message-reporting place's stack (inside an effect it names the component). Place context — of the last repetition. The trail is taken at send time and also shows the storm itself, folded ×n. Reading a group names it thus: the batch's first repetition's stack, the last one's context.
- **Fingerprint** is counted by one pure kit activity function shared by window and server ([[dd380bf6]]): origin, place, and message with ids and numbers replaced by `#`.
- **The sender holds one batch in flight.** The next assembles only after the previous is answered — accepted, refused, or link-broken; while no answer, repetitions fold into accounting. A new group leaves within 2 s; an already-delivered group's count growth — with the nearest batch, but at most once a minute, with an updated sample. An accepted batch is subtracted from accounting, an unaccepted one returns into it with the same count; a batch retried after a break carries the same activity ids the window minted, and doubles nothing. On window leave the remainder leaves with `keepalive`.
- **Accounting memory is capped** by a groups and sample-bytes ceiling together with the in-flight batch. Repetitions of known groups only add count; new groups past the ceiling count as a window loss and leave as a loss line.
- **The Errors list** is the server's feed and not-yet-delivered accounting merged by fingerprint: one line per group, server count plus undelivered. How a line shows origin and kind is the Tagma design language's work job.

**Context:** origin (`window` or `desktop`), window session (one load), host (desktop, browser, phone; OS), window build version (`<html version>`) and the seen server contract, query-less route, place's project and thread; for a request — the operation id, lens, and code; for a subscription — the feed's id; for a boundary — its id.

**Trail** — the window's last 20 events: route changes and `Door` calls (operation id, kind or outcome code, ms); consecutive identical ones folded ×n. No inputs, no page text.

### The server writes and serves
- **`report_faults`** — the activity module's operation for the operator: the window and the desktop main process call it. The entry schema holds ceilings derived from the fact's budget. Per group — an activity `window-fault` with the `operator` actor, the thread and project from context, and one group-kind note; the server counts the fingerprint. The operation answers after `ActivityLog.settled`: every batch fact by then is a list line or a failure-kind loss with the sender's origin, which `read_faults` yields in `lost`. When storage is unavailable (its health), the operation refuses `activity-unreadable`, and the sender holds groups at its own.
- **A failure note** receives `origin`, `count` (1 by default), `burst`, `firstAt` and `lastAt` (from age), `context`, and `trail`; a new note kind — `refused`. A failure note is fitted to the fact's budget in serialization bytes — by the server for its own defects, by the window for its own (trail first, then the stack's tail, then message and place) — so the ceiling never rejects it.
- **The owner holds groups incrementally.** A group's line — fingerprint, count sum, first and last time, last note — changes in the same transaction that writes the note, and when retention deletes a note; Clear resets the projection. The `note_fault` partial index and queries change together. A page reads from the projection — O(shown groups), not O(notes over the retention period). The feed counts a frame once per change and yields it to all subscribers ([[51c66cb6]]).
- **A loss names what is lost.** The writer, rejecting or losing a fact it holds, writes the note kind or activity kind and the failure's origin into the loss line. A fact of unknown kind — a package write failure, pre-parse overflow — stays `unknown`.
- **`read_faults`:** a line receives `origin`, `kind` with `refused`, `burst`, and `context` (no trail); selection by `origin`; `fingerprint` answers one group whole, with the last note's sample and trail. `lost` answers only losses that may hide list lines: failure-fact losses by cause and origin, and unknown-kind losses. Losses of facts of a known other kind do not enter it. The operation description names origins and kinds; the `FAULT_ROWS` line ceiling is re-measured with context.

### Desktop, phone, and the server process
- **The desktop main process** reports to `report_faults` with `origin: desktop`: `render-process-gone` of every Tagma surface webContents — project windows, view windows, and the dictation pill (cause, exit code, last address), their preload errors, and its own `uncaughtException` and `unhandledRejection`. The sender is the same by device: one batch in flight, a bounded queue, past the ceiling — a `desktop` loss.
- **A phone** reports failures over the remote door with the same accounting: it stands at the application's root. The mobile shell has no Errors list, and this spec does not add one.
- **The server process's end.** Activity storage sets the live-process mark on open with a direct owner write, the end mark on close. An open finding the previous process's mark with no end writes one `defect` line with the `server exit` place: when the previous process started, that it did not close storage, the last note's time, and the count of orphaned activities. This is testimony of an end with no close, naming no cause: SIGKILL, memory shortage, runtime failure, and an unhandled exception look the same.
- **The server process's exception.** After the door, `uncaughtException` and `unhandledRejection` handlers lay a defect with the `process` place into the log, doing no IO at the call site ([[aee8c068]]), wait for `ActivityLog.settled` no longer than the storage's close deadline, and end the process with the same outcome as without the handler. With unavailable storage there is no `process` line; `serve.log` and the next start's `server exit` line remain.

## Storm cost
The window pays per repetition a `Map` increment and a few place-field reads, per group — a stack once between sends; holds one batch in flight and at most the accounting ceiling in memory. A new group — a request within 2 s, a count growth — at most once a minute per window. No render, layout, or request per repetition. The server writes one note per group per batch and patches projection lines in the same transaction; a feed frame — one per change for all subscribers, a page — O(shown groups). A continuous storm of one group in one window yields about 1,440 notes a day, not one per repetition.

## Limits
- A renderer crash loses everything the window did not deliver: with a live server — repetitions since the last batch and the in-flight batch, with no link — everything accumulated. The `desktop` line names the crash itself, not the lost count.
- A window reload while the server answers nothing loses what the window accumulated.
- The execution host and plugin processes do not write into this record; the CLI and the MCP bridge yield their failures to their own caller.
- Messages and routes may carry paths and project names; the record stays on the user's machine.

## Acceptance
The performer's checks:
1. 1001 messages to the accounting about a `not-found` refusal of one background operation in one task yield in `read_faults` one window `refused` line with the operation-place, `count` and `burst` 1001, route, project, build, and message-reporting place stack. No "Server error" line.
2. The `page` boundary catching an exception yields a window `defect` line with the `page` place, route, and stack.
3. Inside `$effect`, 10,000 messages of one group in one flush do not restart that effect, write no reactive state, and yield at most one request.
4. While the server does not answer a batch, no new one assembles, and 1000 new groups do not raise accounting memory above the ceiling; after the answer the window's loss arrives as a loss line.
5. Redelivering the same batch does not change the count.
6. Window A with no link accumulates a group, window B presses Clear, A delivers — the group appears in every window; a group accepted before Clear appears in none; Clear in A also removes A's undelivered groups. With the window's clock an hour off, the failure's time on the line is right.
7. A window failure is visible in `read_faults` and in another window's list and survives window reload and server restart within `activity.keepHours`.
8. A non-failure fact's loss does not enter `lost` in `read_faults`; a past-ceiling window loss enters with `window` origin; a package write failure enters as `unknown`; a failure note with long message and place of escaped characters is not rejected by the ceiling.
9. A refusal on a user gesture, `not-found` too — a card, not a line; a link break yields no line; an unreadable answer under the same contract — a window `defect` line with the operation id, under a different contract — `apart` with no line.
10. `render-process-gone` of a project window, a view window, and the pill yields a `desktop` line with the cause; the desktop main process's exception — a `desktop` line.
11. An exception past fibers after the door yields a `process` line before exit. A server taken down with unclosed storage, with not a single open activity, yields one `server exit` line on the next start; an orderly close yields no line.
12. The `read_faults` page and the feed frame read from the groups projection: the page's query plan never walks notes.
