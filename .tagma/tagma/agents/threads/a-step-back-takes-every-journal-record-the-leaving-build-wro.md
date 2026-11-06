---
id: 01a1ad93-2710-787d-8cba-111850881cc3
title: A step back takes every journal record the leaving build wrote back through the back forms of the steps the previous release lacks
ord: 168
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a126f6-6c5e-795a-b256-2e311e57a53b
  - kind: relates
    to: 01a1ad3a-f8a3-7ca8-ac2e-6d6fdef31b76
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutReturn.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/journal/rolloutEntryForms.ts
    symbol: returnedRollout
  - kind: symbol
    ref: apps/tagma/server/src/installation/process/returning.ts
    symbol: stepsCarried
---
The previous release is frozen and reads only the forms its own steps produce, so the leaving build — the only one that knows its newer steps — takes its records back through each step's `back` forms before that release starts.

- **Which steps go back.** A step whose name the previous release's server bundle holds is one it carries; every other step of the leaving build is undone, newest first. An issued release declares its steps nowhere but in its code, and a name that sits in a bundle without being a step there does not occur.
- **Every stored record, not only the threads it cast.** Maintenance shapes rows of threads whose mark lags into the current form and stamps nothing, and a run on a lagging thread writes before its cast lands, so no mark or time tells which rows hold a newer form. The return therefore passes each column holding a record kind a back form touches — event payloads, entries, run tails, parked questions, context readings, inbox items, and the history-item and entry columns the native part declares as its own — in bounded batches. A back form declares in `holds` the text every record it changes contains in its JSON, which the contract suite requires and checks on its sample, so SQLite selects only the rows holding one of those texts and the cost follows what the leaving build cast, not the size of the store; a back form declaring none has every row of its columns passed. A back form returns null on a record already in the older form, so an untouched record stays byte for byte.
- **Files.** A rollout file or transcript changed since the leaving build was installed is cast back through the same staging, publication and commit as a forward cast, and its transcript is removed so the previous release folds its own. A mark past the previous release's last carried step comes down to it, a lower one stays, so that release recasts on access whatever its own steps still owe. When no reversed step has a form for what a rollout file holds — events and meta — no file is cast: only the marks past the previous release come down, and files and transcripts stay as they are.
- **What stays.** A step that declares no `back` keeps its records; a back form that refuses while a thread's file is cast back, or a thread in use, leaves that thread as it stood. The leaving server names each in its log, and the step back goes on: the stores still return, and the previous release reads such a record as it reads any record no kind of it reads. A back form that refuses on a stored row leaves that row as it stood and names its thread; every other row, column and file still returns.
- **Where it runs.** Only a composed server holds the lanes, the worker and the publication a cast needs, so the leaving build returns the journals in its server after the runtime is composed and before its door opens, with no run recovered and no maintenance open.
- **Recorded for the restart that follows.** The step-back record marks the journals returned just before the restart onto the previous installation. A restart that fails takes the mark back: the leaving build then serves and writes newer forms again, and a mark left standing would let the next start carry the stores without returning those records.
