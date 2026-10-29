---
id: 01a102d6-f015-7047-a856-e5f09704eda8
title: "Evicted thread: the transcript window reads from the addressable `<rollout>.entries` projection, not from the rollout's full fold"
ord: 2
---
After eviction the thread transcript lives beside the rollout in the `<id>.jsonl.entries` file. It is a folded projection addressed by ord, and the window reads from it without the rollout and without model history.

**Format.** Entry JSON rows in ord order (0..n-1, as the former full fold), then n 16-byte slots (body byte offset, wire weight), then the open-question table — 24 bytes per `question` record with `open` status, in ord order (ord, body start and end) — then a 48-byte footer: n, body end, open-question count, key — the `thread_rollout_cursor` (`nextByteOffset`, `nextPosition`) of the rollout the projection was folded from — and the file form number. Weight is counted at write; the reader never serializes JSON. A reader treats a file of another form (the former 32-byte footer) as missing and rebuilds it.

**Who builds.** The fold is built by a worker (`rested.worker.ts`), not the event loop: it reads the rollout in any form, plain or `.zst`, and writes through `<projection>.partial` + rename. The `.partial` name is one per rollout; builds of one file inside the worker run in turn, so the remainder of a failed build is overwritten by the next. Eviction builds the projection before its transaction, inside the thread's journal lane; if it cannot, the thread stays (`kept: unreadable`). A reader missing the file, or whose footer key mismatches the cursor in SQL, rebuilds it with the same worker; concurrent rebuilds of one file join. This covers threads evicted before the projection appeared, snapshot restore, and repeated eviction after rehydrate.

**Reading.** The window (`RestedFolds.window`) reads the footer, the `[before − limit, before)` slots, and the taken entries' bodies in a single range — O(window) bytes. A run's open questions (`openQuestionsOfRun`) read the table and only its bodies with one descriptor — O(open) bytes, however many closed questions have accumulated. The whole transcript, `byId`, and `ofRun` read the projection bodies. Model history for an evicted thread is folded by the same worker on request, with a byte LRU.

Removing a thread (`releaseRollout`) removes the projection too. Compressing and opening a rollout do not touch it: the key does not depend on the file form.
