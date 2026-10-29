---
id: 01a0ff2b-54ff-7f7f-91d2-8f52cc7f387c
title: "`search_threads` finds a mid-thread replica of any project's native thread: English and Russian by stem, any language by substring"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a101d9-1575-7f74-94e1-12734860ce23
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/log.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/projection.ts
---
With one `search_threads` call, the agent or the app finds a replica from the middle of any project's native thread — live, archived, or evicted to rollout. The response carries a quote, time, project, and the address by which `read_thread_record` reads neighboring replicas.

## Index

The index lives in machine SQLite next to the thread record: cross-cutting search does not walk project databases.

**Conversational-messages table.** `UNIQUE (threadId, entryId)`, B-tree `(threadId, position)`. Columns:
- the last source position and `runId`;
- the appearance position — the message's first source position, by which recap decides whether the message entered the covered range [[dff5b0dc]]. Replacement does not move it. B-tree (`threadId`, appearance position);
- role: operator or agent;
- the original `occurredAt` (for a fork, the original's time, not the copy's);
- the rewind mark;
- the source text — stored once, fragments built from it.

**The row key is the message time.** `rowid = occurredAt_ms × 2^21 + seq`:
- a 64-bit integer; inside the server a bigint, in cursor a decimal string;
- allocated in the write unit: `base = occurredAt_ms × 2^21`; a new rowid is the max rowid in the bucket `[base, base + 2^21)` + 1, for an empty bucket — `base`. Capacity (`rowid − base < 2^21`) is checked before insert;
- representable milliseconds are `[-2^42, 2^42)`;
- a full bucket, missing or unrepresentable time — the message is not indexed and lands in coverage; moving to neighboring time and substituting now are forbidden;
- replace with the same time keeps the key; an `occurredAt` change deletes the old FTS row, takes a new key, and inserts in the same write unit.

So FTS itself yields matches fresh-to-old, and `since`/`before` is a rowid range inside the index.

**FTS.** Above the table stands FTS5 `tokenize='trigram'` with `contentless_delete=1`: the projection is not stored twice. The extractor writes table and FTS synchronously in one write unit; the `'delete'` external-content special command, as in the graph's `search_fts`, does not apply to contentless.

**The projection** FTS receives:
- normalized text (kit [[4860ce23]]) — for literal search and identifiers;
- then the stems of words whose stem is not contained in the word itself. This is almost only English: happy → happi, skies → sky. Other stems are found by substring anyway;
- projection and query pass the kit's trigram form: two-sign joined-writing words double and become available to the trigram index.

**Scope.** Project is not stored: it comes from the thread record, so move changes scope without rewriting the index. Thread delete cascades its rows away, archive keeps them.

**What is indexed.** Operator replicas and agent answers. Not indexed: system prompt, tools, reasoning, keep-warm, and agent-origin messages (child reports and notices): their text already lies in the source thread.

## Writes

The owner is `threads/journal`. One extractor applies to the index the same semantics as `placeThreadEntry` (`packages/agent/src/transcript/eventFold.ts`):
- append and replace — upsert by (`threadId`, `entryId`) with the last position;
- withdraw — deleting the run's rows;
- rewind and restore — clearing or setting the mark.

The extractor runs on every journal write path — `log.append`, rollout projection, replay — in the same write unit as the event. Retries are idempotent. Eviction (`journal/rest.ts`) does not touch the index, so an evicted thread searches without rehydrate.

One thread's events apply to the index in source-position order. Backfilling an old range does not undo already applied withdrawals, rewinds, and restores: a thread's live writes and backfill do not overtake each other. The builder picks the serialization means.

## Backfilling existing threads

- A resumable pass with a durable per-thread watermark and bounded batches, by the same extractor.
- Threads in the database read from `thread_event`, evicted ones from rollout via `RestedReads`, without rehydrate. Only message rows read from rollout.
- The driver is the server boot. It connects in the same change.
- An unreadable rollout lands in coverage and is not silently skipped.

## `search_threads`

**Input.**
- `query`;
- `projects`: `current` (default), `all`, or a list;
- `since`/`before` — message-time bounds;
- `threadId` — matches inside one thread;
- `limit`, `cursor`.

**Matching.**
- Query words come from kit [[4860ce23]], each reduced to a stem. Joined-writing symbols double as in the projection.
- A message matches when its projection holds every word's stem as a substring. Hence:
  - "Черногория" finds "Черногорию" and "Черногории";
  - "trips" finds "trip";
  - "黑山" finds "我想去黑山旅游";
  - "cafe" finds "café";
  - identifiers and paths search literally.
- A term under 3 symbols, e.g. "AI", does not go into trigram MATCH and is checked by substring among already selected rows. If all terms are short, the query refuses `query-too-short`, and unblock asks for a longer word.

**Results.**
- One row per thread: project, `threadId`, title, parent, the archive mark, and the last match — `entryId`, position, `runId`, role, `occurredAt`, a source-text fragment around the match with highlight bounds.
- With `threadId` the results are one row per matched message. The mode is a predicate of the same search. The builder picks scanning one thread's messages over FTS only by measurement on a long thread: a frequent word, a rare one, and an empty result.
- Order: by the last match's `occurredAt`, fresh first, ties by id. No bm25, no title boost.
- The calling agent's own thread is excluded unless `threadId` names it explicitly, and the response names the excluded thread. Archive is always included.

**Paging.**
- Walks matches fresh-to-old until it collects `limit` rows or hits the per-page viewed-matches limit. A row is a thread, with `threadId` a message, with no per-thread dedup then. The limit is derived, not set in the spec. On hitting the limit it returns a partial page with a cursor and a mark. Out-of-scope matches count toward the limit: foreign projects, one's own excluded thread.
- `cursor` is short and opaque. The server holds the rowid bound and the issued-thread set as a held read through the `EvidenceReads` port (`threads/contract/service/evidence.ts`). A new held-read kind, not a new module. The next page does not reread what was passed.
- Held read lost — the answer is `cursor-stale`, with no history rescan. For another query or scope the cursor refuses the same.

**Response.**
- `total` — the row count after all filters (distinct threads, with `threadId` messages) if the count fit its limit. Otherwise `total = null`, with `atLeast` and a reason beside. A lower bound is never passed as an exact number.
- `coverage` — a fact separate from count completeness: either complete or the number of unindexed threads in scope (backfill not done, rollout unreadable, time unrepresentable, foreign-CLI thread). An empty response under incomplete coverage is labeled so.
- Page size derives from the paged-read rule. The 20 in the measurement below is a sample size, not the operation's size.

**Consent.** Scope wider than `current` needs the same consent as reading another project's threads: `search_threads` joins the `read-beyond-project` list (`native-harness/capabilities/threads.ts`). Invocation decides, before content is served.

## Conversation window

`read_thread_record` with `conversation: true` counts `around` in conversational messages, at most 25 per side, and reads them from the index by (`threadId`, position): the window does not depend on rowid. A larger `around` refuses `selection-shape`. The address comes from the `search_threads` hit. Today's `where.at` will not do: `ThreadIntrospection.ts` starts reading at position 0 and filters what was already read.

## Doctrine

The `threads-as-evidence` section gains rules:
- conversations are searched via `search_threads`;
- "today" and "yesterday" translate into explicit bounds in the operator's time;
- with no match, the agent tries other words;
- complete coverage allows saying "no matches for this query in this scope"; that no conversation happened does not follow.

## Cost

SQL sample of 2026-10-03 on this Mac (bun:sqlite 3.51, direct, no `sqlite-process` IPC). Corpus — all replicas lying in `thread_event`: 28,083 messages, 23M symbols, 2274 threads. Plus ×4 synthetic. This is a measured result, not a gate on a specific machine:

| | 28K | ×4 |
|---|---|---|
| Page (20 threads), any word, p50 | 0.2–1.2 ms | 0.2–2 ms |
| 2-day window | 0.3 ms | 0.3 ms |
| Exact total, most frequent word | 30 ms | 507 ms |
| Message write | ~0.25 ms | ~0.25 ms |
| Index size | 148 MB | 582 MB |

- A full count of a frequent word grows faster than the corpus — hence total is bounded.
- A sort-after-search schema cost 13 ms and 61 ms on the most frequent word — hence the row key equals time.
- Storing the projection grew the size by 55% — hence contentless FTS.
- Unmeasured: the full operation through `sqlite-process` and backfill from 11 GB of rollout files (2484 files).

## Acceptance

- Scenario: in another project's thread with a random name, the phrase "поедем в Черногорию" stands in the middle, other things discussed after; the thread is archived and evicted. A `search_threads(query='Черногория', projects='all', since, before)` call returns this thread with the source fragment, time, and address, and `read_thread_record(conversation: true)` by the address yields neighboring replicas.
- An English word form is found both ways, a two-hanzi Chinese word is found, Latin diacritics do not hinder.
- A match in tool output or reasoning alone does not find the thread. A child's report is found in the child's thread, not duplicated at the parent.
- Restart, eviction, rehydrate, compaction, and replayed replay change neither results nor duplicate rows. Delete removes the thread from results, move changes its project.
- While backfill runs, an empty response is labeled with incomplete coverage.
- A withdrawal written live before backfill reached that run is not brought back into the index by backfill.
- Same-millisecond messages from different forks get different keys. A replace with a time change moves the row leaving no trace of the old.
- Two pages, when one thread has several matches, yield it once. A later page does not reread what was passed.
- A frequent word's total on this machine's corpus returns with `atLeast`, not a long count.
- The full-operation query time is measured on this machine's journal and reported as one sample.
- Checks go through owners on a real database: write, eviction, backfill, query.
