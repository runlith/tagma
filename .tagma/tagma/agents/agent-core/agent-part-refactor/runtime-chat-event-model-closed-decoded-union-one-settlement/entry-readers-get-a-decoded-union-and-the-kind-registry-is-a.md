---
id: 01a11bad-fecd-753d-82bb-1fc0a10fed73
title: Entry readers get a decoded union, and the kind registry is a service provided by composition
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9123ae16171c
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
---
Review [[ae16171c]] remainder (items 12 and 13).

- **Type.** `ThreadTranscriptEntry` (`transcript/rows.ts`) stays an open index-signature type while every ingress already decodes closed. Readers must get the decoded union `ThreadKnownEntry = ThreadEntry | ThreadProductEntry`, and the casts go away: `cap.ts`, `events.ts`, `ThreadToolRecords.ts`, `ThreadLiveFeed.ts`, `feedFold.ts`, `eventFold.ts`, `TranscriptFold.ts`, `ThreadEffectSettlement.ts`, `ThreadIntrospection.ts`, plus about 80 more files that read entries.
- **Registry.** `threadEntryKinds()` is a mutable module singleton that `composition/manifest.ts` sets as an import side effect. It becomes an explicit service or Layer that composition provides, and decoding without an installed registry is impossible by construction. Tests get the registry from the Layer instead of resetting a global.
- **Worker.** The rested-transcript worker currently decodes only payload edges while entries are decoded on the main thread when the transcript file is read. With the service registry the worker gets the same kinds the same way.

Both change the same entry-reader path, so they land in one cut with no halfway state.

Proof: typecheck with no casts to `ThreadToolEntry` and the other members in the listed places, decode without an installed registry does not compile, and ingress tests pass on the Layer registry.
