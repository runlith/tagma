---
id: 01a111ce-3737-7517-8b69-f7489b7f62ff
title: Native command changes are recorded on the session by process lives; produces and the observation road go away
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111ce-9258-7e91-9b9e-88c34ecfc378",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ab-9639-7730-81d5-593018d06fb3
sources:
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
---
Build the core of [[18d06fb3]]: everything the native `bash` command moved in the checkout is recorded on the session by process lives, and `produces` and the observation road go away. One change, with no second form beside it.

Includes:
- rules 1–10 of the spec: decision by bytes, mtime from the "after" snapshot stat (carried through `Working`, frontier, and `Measured` in `packages/files/src/working.ts` and `CheckoutBaselines.ts` without a new call), the in-memory per-checkout registry of process lives on the server (`ShellRun.opened()` and `run.result` resolution, wall clocks; record closing in the finalizer, including on `observerLost` paths), the "shortest life" decision, the deferred decision with wakeup, `submit_work` deciding its own session's deferred paths immediately, the version chain with breaks, duplicates, the "before" text, the "after" bytes from the snapshot;
- recording lines with a background queue: `ObservationQueue` becomes the queue recording command edits, the `settled()` barrier is per session; the command answer carries only the in-memory decision;
- the whole "What goes away" section of the spec: `produces` and its preparation and recheck, `declared-subject-changed`, `path-held` in `import_output`, doctrine and answer lines, the observation road with the `workspace_observation` table (drizzle migration);
- from the "One form on every platform" section: an unreadable file is skipped and named with only its own frontier record reset; symlinks go through lstat and are recorded whole as link text; the path is as git names it, edit lookup honors `core.ignorecase`.

The "before" text for a clean path is read in git working form from [[435f5333]]; until it lands, take `textsAt` and switch over when it appears.

Done when the "Done when" points of the spec hold, except the CRLF point (it belongs to [[435f5333]]), typecheck and the affected tests are green, and `bash` answer time on a command with no changes is measured before and after and has not grown.
