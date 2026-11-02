---
id: 01a19da5-4405-7eb2-931b-5c1669f4026f
title: A protocol journal key conflict exhausts a native run's crash recovery
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "Run cut after 2 crash-recovery attempts and 438.757 seconds; its last failure was ThreadCallBroke → ThreadStorageFailed → ThreadActReusedError in protocolJournal.opened, saying the key already names another act.",
    "command": "native run 01a19d96-a1ff-7640-9ff9-12214130a846: protocolJournal.opened",
    "expected": "The native driver opens its protocol journal with a valid act identity and continues the existing run without exhausting crash recovery on a journal-key conflict."
  }
---
Filed from project `vigla` at the lead's request. The receiving server has been up since 2026-11-02T13:07:41.566Z from dd2bd38.

The run ledger for [[01a19457-e130-796d-8f16-56fc8fa1a3c9|transitions]] records run `01a19d96-a1ff-7640-9ff9-12214130a846` on `muse-code/muse-wonder-full-1.0`, created at `2026-11-02T18:47:37.218Z`, cut at `18:54:55.975Z`, with `resumes: 2`. Its complete failureReason reports exhaustion of two crash recovery attempts without durable progress and this last failure chain: `ThreadCallBroke: Thread storage failed in protocolJournal.opened` -> `ThreadStorageFailed` -> `ThreadActReusedError: Thread 01a19457-e130-796d-8f16-56fc8fa1a3c9: this key already names another act, so a changed request needs a new key.` The run lasted 438.757 seconds; this is wall time, not an isolated measurement of the last journal failure.

This reading does not expose the opening request/key, establish the actor behind preceding model changes, or prove both recovery attempts had the same cause. A later already-queued run, `01a19d9d-70f9-7cb8-91b1-bd41a13d0052`, completed at `18:56:49.741Z` and returned the proof hunk packet. This occurrence therefore describes the specific cut run, not a permanently stopped thread. Main WIP remained intact; the lead transferred the eventual main landing to the parent while registered proof work continued. No manual retry, worker model change or server restart was performed to investigate this occurrence.
