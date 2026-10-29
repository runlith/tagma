---
id: 01a16659-b89a-722e-9843-59aa8ae259eb
title: Only live-capture acts await the record carrier's answer with no deadline; the stream end, process exit, suspend, seal or a waiter interrupt set theirs
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16642-c9b6-7f42-842c-a9b29a8bc9e2
sources:
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.closeEnded
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.seal
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.suspend
  - kind: symbol
    ref: packages/execution-host/src/RecordWriter.ts
    symbol: makeRecordWriter.answered
  - kind: symbol
    ref: packages/execution-host/src/RecordWriter.ts
    symbol: makeRecordWriter.hurry
  - kind: symbol
    ref: packages/execution-host/src/registry/adoption.ts
    symbol: one
  - kind: symbol
    ref: packages/execution-host/src/registry/work.ts
    symbol: observeExit
---
A slow but answering carrier — the host main loop stalled for seconds, the disk packed with someone else's copy — is no reason to end capture. While the capture write is in flight, capture awaits its answer while the child pushes against a full pipe: not one byte is lost. A deadline on every act would fence the stream under such a carrier, and the pipeline would stop reading the live process's pipe.

Only capture acts (`capturing`) wait this way: appending, evicting and segment change. Open, reopen and a resize's journal grid line keep a deadline: neither the stream end nor suspend releases their callers. Reopen runs in adoption before the host publishes its services, and one record would hold the whole boot. Resize holds the input-intake permit, which the logic's departure takes ahead of suspend.

Capture acts get their deadline from paths that must never hang on a never-answering carrier: the stream end, process exit, suspend and seal hurry (`hurry`) their stream or all. An in-flight act gets its deadline from this minute, each next stream act from its own start, so the output remainder after process exit appends under deadline already. Exit needs its own signal: an execution frees only after the pipelines end, and a pipeline ends the stream only after its act answers. Interrupting the awaiting fiber deadlines only its acts, not the stream: the scope-closing owner interrupts capture before the finalizer starts seal. So the carrier runs in its own fiber while an interruptible await waits on it: an interrupted await never cuts the write short of its deadline. Giving up, the await at once releases the caller and interrupts the carrier without awaiting its end. An act the platform never interrupts would otherwise hold the stream end, suspend and seal alike: `open` goes under an acquire mask, and the journal opens a file per line. The handle such an `open` hands over later closes at once: its segment's scope is closed by then.

A torn filesystem write can still land later — the platform has no cancel. After a torn append the frontier cuts back and the stream fences, but the segment file can grow past the frontier again. So suspend ends the fenced stream in the journal with error at the confirmed frontier, and the next logic never continues it by payload length. If the carrier never takes even that journal line, the execution store knows the stream's end: the pipeline, having ended the stream in error, writes it into the execution state, and adoption hands such streams to reopen. The next logic never continues by payload a stream the store calls ended-with-error while the journal holds it open; it ends it with error at the journal frontier. The confirmed bytes of its open segment are lost in the process, but not one unconfirmed byte does it take. The pipeline writes the stream end into the store only once its act returns, and at the logic's departure the act may never return before the store passes to the successor. So suspend answers with the streams whose ends the journal never took, and the departure writes them into the store before handover.
