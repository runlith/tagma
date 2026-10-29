---
id: 01a0d136-c307-793f-b058-3703595698df
title: A list row carries a waiting thread's ask with a grouping key, the first line its latest run said, and its context in tokens
ord: 115
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0d136-c1a6-7dbb-b477-8dc4f943c3ed
---
**Outcome.** A list row carries three facts the sidebar needs:
- **`ask`:** what a waiting thread asks, whether it is a Tagma run or a harness;
- **`saidLine`:** the first line of what the thread last said;
- **`contextTokens`:** the context figure in tokens.

Nothing already on the row changes.

**Problem.** The Needs you and Ready sections and the peek of [[f943c3ed]] need these three facts, and the row lacks them:
- A native waiting row says only "waiting on you", because the row projects no question. A harness row already carries `harness.question`.
- A finished root cannot say what it answered.
- Identical asks cannot be grouped.
- The peek cannot print tokens, because only `contextShare` crosses the wire.

**Holds now.**
- `ThreadStore.summaries` selects `threadListColumns`: every `thread` column except the two system prompts. So `pendingInteraction` is already read into `TagmaThreadSummary`; `wire.ts#wireThread` drops it.
- `pendingInteraction` is the open `ThreadQuestionEntry`, recorded when a run parks on a question (`ThreadTurnRunner` via `recordCompletion`). Its fields: `questionId`, `questions[]` (each `prompt` and `kind`), `toolCalls[]` (each `toolName`) and `occurredAt`.
- `contextReading` holds `usage.totalTokens` and `contextWindow`; `wire.ts#contextShare` divides them.
- The run's transcript is `thread_entry`, indexed by `(thread_id, run_id, ord)`.
- The agent directory's `askPrompt` reads only the harness facet (`ThreadDirectoryStore`). A native waiting agent there also reads without its ask; that gap is outside this decision.

## Target
New optional fields on `TagmaThreadListEntry` (`protocol.ts`), produced in `ThreadStore` and `wire.ts#wireThread`:

- **`ask: { questionId: string | null; text: string; kind: 'confirm' | 'question'; key: string; askedAt: string | null } | null`.** It is non-null only while the row waits on the operator.
  - **Native thread:** read from the open `pendingInteraction`.
    - `text` is the first prompt's `prompt`.
    - `kind` is `confirm` when every prompt is a tool confirmation (the same test the confirmation card uses, [[6684d8d8]]), and `question` otherwise.
    - `askedAt` is the entry's `occurredAt`.
    - `key` is a stable digest of the kind, the sorted tool names and the first prompt's text with whitespace collapsed. Asks with the same words about the same tools get one key; the key carries no thread or run identity.
  - **Harness thread:** read from `harness.question` while its answer is null. `kind` is `confirm` only where the facet marks the question as a permission prompt, and `question` otherwise. `questionId` is null, because a harness is answered through `answer_ask`.
- **`saidLine: string | null`.**
  - For a completed outcome: the first non-empty line of the final answer, meaning the first assistant text entry the outcome run wrote after its last tool entry ([[f2ad6732]]).
  - While a run is going: the first non-empty line of its newest assistant text entry.
  - Cut to 160 characters, with an ellipsis. Null for a harness thread, and wherever no text stands.
  - It is read in `summaries` by one indexed lookup per row on `(thread_id, run_id, ord)`, with the text trimmed in SQL before it crosses to the process. A row is refreshed whenever it is next announced; no new announcement trigger is added.
- **`contextTokens: { used: number; window: number } | null`.** The same reading `contextShare` divides, and null exactly where `contextShare` is null.

**Owners.** [[edd4a99c]]: `ThreadStore.ts#summaries` and `summaryOf`, `wire.ts#wireThread`, and `protocol.ts#threadListEntrySchema`. The kernel records nothing new for these fields.

**Rejected.**
- Reading the question through the snapshot per row: a request per waiting row, off the feed.
- Storing a report headline on `thread_run` at completion: that is a kernel change, and the transcript already holds the words.
- Grouping asks by text alone: two tools asking with the same words are different decisions.

**Acceptance.**
- A native thread parked on a `bash` confirmation shows `ask.kind` `confirm` and its prompt's text.
- Twelve such threads asking the same command share one `ask.key`.
- A completed run whose answer begins "Found 3 issues" carries `saidLine` "Found 3 issues".
- The window read of 50 roots with families takes no more than today's time plus one indexed lookup per row, measured with the performance record on a project of about 200 threads.

**Claims touched.**
- [[d32b1513]] ("A list row says what the thread is doing, never what it last did") conflicts with `saidLine` on a finished row. The builder rewrites it, in [[8847ca6b]], to hold that the row's state fields say what the thread is doing, while `saidLine` is what its latest run said.
- [[4d5be5a9]] survives.
- [[65ee6966]] (UI) is absorbed through [[fd277fc5]].

**Order.** [[8847ca6b]]. It depends on nothing, and [[6baeb699]] waits on it.

- **10. Contract:** three optional fields added to the row schema and to the `list_threads` answer. Old clients ignore them, and the schema is not versioned. A new client reading an old server treats them as absent.
- **11. Stored data:** out, because nothing is stored.
- **12. Who may do what:** the ask's text reaches the same readers the row already does. The row is served to the project's operator and to agents through `list_threads`, whose admission is unchanged. A secret prompt's text is the question, never an answer.
- **13. Long-lived things:** out.
- **14. Bounded resources:** at most 160 characters of `saidLine` and one question text per row. The trimmed text read is bounded in SQL, so a long answer costs no more than its cut.
- **15. Rollout:** running threads gain the fields on their next announcement.
- **16. Failures:** an entry that does not parse leaves the field null. The row stands, because the row is not refused for its headline.
- **17. Observability:** the performance record's span for the window read, and the acceptance cases above.
