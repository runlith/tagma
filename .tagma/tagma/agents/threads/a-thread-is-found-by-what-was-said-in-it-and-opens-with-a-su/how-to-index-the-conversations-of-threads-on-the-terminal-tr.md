---
id: 01a0ff2b-54ff-7f7f-91d2-8f598c07bcb3
title: How to index the conversations of threads on the terminal transport
ord: 8
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: how to index the conversations of threads on the terminal transport — Codex, Cursor, Gemini, Grok, plus Claude and Devin on `terminal`. An ACP thread is already indexed: the driver writes its conversation to the Tagma journal, and search coverage counts it like a native one.

Today `external-harnesses/metadata/words.ts` and `Harness.readerWords` yield a limited `string[]` of operator messages with no addresses or time, and no agent answers at all. Candidate: a per-vendor adapter that reads its own session transcript (`transcriptPath`) into messages with address, role, and time and hands them to the same index extractor. The decision depends on whether each vendor's transcript yields the full conversation with addresses and time. Parsing the terminal screen will not do for this.

Coverage misses the terminal stretch of a thread that later moved to ACP: what was said in that stretch is unindexed, while the thread counts as indexed.
