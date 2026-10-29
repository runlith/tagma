---
id: 01a0ff2b-54ff-7f7f-91d2-8f5114618abd
title: A thread is found by what was said in it and opens with a summary of where it stopped
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The operator and the agent find a conversation by words spoken anywhere in a native thread of any project, and returning to the thread see a summary of where it stopped.

## Why

Measured 2026-10-02 on the question "вчера или сегодня я говорил с агентом про поездку в Черногорию":
- `list_threads` filters only by title and name (`threads/list/select.ts`).
- Contents are searched by substring scan via `read_thread select=entry where entry.text contains`. For 2 days of runlith that is 308 threads and 88,076 records, three calls due to the 30,000-fact ceiling. Only the searching thread itself matched. Reasoning and tool output leak into the results, rows hold no text, no word forms. Each project reads separately, and the machine holds 8.
- `threads.autoTitle` is off by default: 20 of 38 root threads from those days have random names. No position summary anywhere.
- The thread-column filter searches title, name, agent, and model among the current project's loaded rows.

## Shared decisions

- Search is lexical. English and Russian reduce to stems, any other language is found by substring, Chinese and Japanese included. Results order chronologically. No semantics, synonyms, or translation: the agent tries other words. Full index coverage allows saying "no matches for this query", but not "there was no conversation".
- What is indexed is the spoken: operator replicas and agent answers. Tool output, reasoning, system prompt, and derived recap do not enter the index.
- Search does not depend on recap. Only the thread's model writes recap, on a hot cache and only where the operator spoke; there is no cold generation.
- The thread title is stable: recap does not rewrite it.

## Coverage

- Text parsing for search, shared by graph and threads — [[4860ce23]].
- The index, `search_threads`, the conversation window, doctrine — [[cc7f387c]].
- Thread-request capture with the last response — [[e04bf041]].
- Recap: who gets one, hot-cache generation, storage, reading, switching off with `threads.recap` — [[dff5b0dc]].
- Default autotitle — [[2a2eb46e]].
- Column search — [[f07ab3f2]].
- Recap as a feed card and in Peek — [[470336e6]].
- out: stems and normalization for languages beyond English and Russian, including Hebrew and Arabic vocalization. Substring finds them, and a new language's stem goes into [[4860ce23]].
- out: embeddings, semantic memory, synonyms, and translation. Lexical search with word forms covers "where did we talk about X"; what is needed beyond it — [[5ce71527]].
- out: foreign-CLI thread conversations. Their conversation is not stored as addressable messages: `external-harnesses/metadata/words.ts` yields limited operator replicas with no addresses or time. Search coverage calls such threads unindexed — [[8c07bcb3]].
- out: a feed jump to the found message. The feed snapshot is a tail plus `before` (`threads/contract/wire/snapshot.ts`), so a match shows as a replicas window from the index — [[d6589a26]].
- out: a title changing with the topic. Renames make the thread less recognizable in the list, while search finds a mid-topic.
- out: recap history. One last recap with its basis is stored; search finds past topics.
- out: a "day digest". One last recap describes the thread's current position, not a day, and `readerSince`/`readerBefore` refer to the operator's last replica. A digest would need a day-by-day history, deliberately not stored here.
- out: rewind and fork marks in search results. A rewound replica was still said, and a fork carries the original `occurredAt`.
- out: a subagent recap where the operator never spoke. Its outcome is the final report at the bottom of its feed, and children's work enters the parent's recap through their reports.
- out: cold and manual recap generation. An old or cooled thread stays summary-less until the next turn with the operator; search can find it.
- out: foreign-CLI thread recaps: their Tagma cache is unavailable.
- out: compaction changes. It has its own summary for the model.

## Order

[[4860ce23]] → [[cc7f387c]] → [[f07ab3f2]] ‖ [[e04bf041]] → [[dff5b0dc]] (status — after the [[cc7f387c]] index) → [[470336e6]] ‖ [[2a2eb46e]]
