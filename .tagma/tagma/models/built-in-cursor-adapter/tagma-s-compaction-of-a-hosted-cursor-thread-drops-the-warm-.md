---
id: 01a19552-4445-7626-9b10-6331a5831132
title: Tagma's compaction of a hosted Cursor thread drops the warm Cursor session and rebuilds it from a text fold, though Cursor compacts itself
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19555-adc0-7097-ade6-72848474a53d",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a10a1a-ee85-7fd6-b885-d18d92391518
  - kind: relates
    to: 01a1646a-30fe-70a6-aa96-25c09d6cee47
sources:
  - kind: file
    ref: packages/hosted-runner/src/profile.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/choice.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/policy.ts
---
A Cursor thread on the hosted runner declares `compaction: 'foreign'` (`clientProfile` in `packages/hosted-runner/src/profile.ts`). For such a thread every Tagma compaction — the fill threshold after a turn and a manual `/compact` — takes the foreign-model road ([[92391518]]): `summarizersOf` (`apps/tagma/server/src/native-harness/compaction/choice.ts`) picks the configured summarizer chain regardless of cache warmth, a model from that chain retells the Tagma journal, and `TransportHistory.restore` stops the runner and drops the Cursor session; the next turn opens a new SDK session from the folded journal sent as text blocks.

What that costs on every long Cursor thread:
- the warm Cursor session and its prompt cache are thrown away instead of being folded in place;
- the retelling is a full uncached read of the history by another model;
- the turns kept after the fold reach Cursor as text, so their tool calls and results lose their structure.

Why it was built so: the public `@cursor/sdk` (1.0.40 in this checkout) exposes no compaction method, so Tagma cannot ask Cursor to fold its own session. The published wire carries summary events, but SDK-local autocompression and its threshold are not established. SDK 1.0.40 hides the summary markers from `onDelta` and exposes only undecoded checkpoint payloads; its compression is invisible to Tagma ([[81aee933]]), so the runner must not invent a boundary.

The defect is that Tagma starts a reset where the vendor would have folded the session itself. Fix it at the compaction policy owner: on a hosted transport whose vendor compacts its own session, Tagma's automatic threshold does not reset the session, and the vendor's own boundary is what the thread records; decide what a manual `/compact` does there (the reset road stays available only as an explicit choice, or the act refuses naming why), and make the profile say which of these the transport is rather than lumping it with transports that cannot compact at all. Whether Cursor's own compression actually runs in SDK local sessions, and at what fill, is unconfirmed live (the open live check of hosted Cursor); establish it before relying on it. OpenCode's hosted profile shares the same `foreign` road with its engine's auto-compaction switched off (`compaction: { auto: false }` in `packages/adapter-opencode/src/runner/sdk.ts`); check whether its engine offers its own summarize call, which would give it the `session` road instead.

Done when: a Cursor thread crossing Tagma's fill threshold keeps the same Cursor session (no `restore`, no new SDK session), its next request reads the cached prefix, and Cursor's own compaction lands in the journal as a boundary; a manual `/compact` behaves as decided and its behaviour is stated in [[92391518]].
