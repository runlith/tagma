---
id: 01a0d007-1972-7d2e-b63b-4185c94540ce
title: A cut inside a turn keeps that turn's opening user message verbatim after the checkpoint head, when it fits the host's figure
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
## 1. Outcome

When the host's selector retains the newest turn only in part, the turn's opening user message — the task the run is working on — is kept verbatim right after the checkpoint head, instead of surviving only as the summarizer's words.

## 2. Problem

A turn too large for the retained tail splits inside itself at the first boundary whose remainder fits ([[c86a7ee4]]), so its opening message falls into the covered prefix. The summary template asks the summarizer to preserve the user's objective, but a paraphrase is not the brief: identifiers, constraints and acceptance criteria written by the operator or a parent are exactly what a summary shortens. Requested mid-run compaction ([[6ad506f4]]) makes this split the common case on a long single-turn thread — the case that motivated it. Codex keeps recent user messages verbatim after a compaction, up to 20k tokens, for the same reason.

## 3. What holds now

`selectThreadCompactionPrefix` (`thread/compaction/prefix.ts`) answers a covered count that may land inside the newest turn; `threadCheckpointHead` (`thread/compaction/projection.ts`) builds the head as a user marker and an assistant summary, carrying the covered prefix's skill locks and deferred-tool inventory ([[03219239]]); nothing of the covered prefix is carried verbatim.

## 4. Target model

- When the cut lands inside a turn, that turn's opening user message is copied into the head after the summary, so the projection and the committed fold both read: marker, summary, opening message, retained tail.
- It is pinned only when it fits a host figure — a new field of the compaction policy, stated by the host like every other figure — which stands beside the retained tail's budget, not inside it: Tagma caps that tail at 8,000 tokens (`maxRecentTokens`), so a brief charged against it would push the run's newest steps out. The pass's own fit check after the cut still bounds the whole request. A message over the figure is not pinned: a truncated brief would pass for the whole one.
- The pinned copy is a user message, so a later selection reads it as the opening of the same turn, and a second compaction carries it on or covers it by the same rule.

## 5. Owners and boundaries

The selector and the head, in `thread/compaction`; the figure in `ThreadCompactionPolicy` and in Tagma's `compactionPolicy.ts`. Out: a deployment's own compaction form ([[560ccc00]]) decides what it preserves, and is not touched.

## 6. Rejected alternatives

Truncating an oversized opening message to the figure, as Codex does: it hands the model part of a brief as if it were all of it.

## 7. Acceptance criteria

1. A cut inside a turn whose opening message fits the figure yields a projection and a committed history of marker, summary, the opening message byte for byte, then the tail; the request still fits the budget it was cut for.
2. An opening message over the figure is not pinned, and the head is as today.
3. A cut on a turn boundary pins nothing.
4. A second compaction over a pinned history neither duplicates the pinned message nor loses it while its turn is retained.
5. Provider pairing holds for every tail start the selector can answer: marker, summary, pinned user message, then the tail's first message.

## 8. Standing claims and tasks

[[c86a7ee4]] gains the pinned message; [[03219239]] is rewritten for the third head message; [[7f9ebe28]] holds.

## 9. Order of building

After [[d2a7785c]]: [[46232f35]].

## 10. Contract

out: no operation or wire shape changes; the policy gains one host-stated figure.

## 11. Stored data

A committed fold carries one more head message; histories written before read as before. out: no migration.

## 12. Who may do what

out: no authority is involved.

## 13. Long-lived things

out: nothing long-lived is added.

## 14. Bounded resources

The pinned message spends request budget up to the host's figure, beside the retained tail, and nothing when it does not fit.

## 15. Rollout

out: the change applies at the next compaction; running work sees nothing else.

## 16. Failures

out: selection and head building are pure; nothing new can fail.

## 17. Observability

The compaction fold's head, readable through `read_thread_record`, shows the pinned message.
