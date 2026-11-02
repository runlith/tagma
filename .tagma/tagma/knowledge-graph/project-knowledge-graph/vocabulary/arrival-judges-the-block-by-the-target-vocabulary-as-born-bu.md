---
id: 01a1794c-172c-7731-9aab-3eda4fb42583
title: "Arrival judges the block by the target vocabulary as born but does not repeat turns: status, holder, and operation fields pass as state"
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1410d-c9d2-795d-a7f8-9eabc82c927b
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/arrival.ts
---
Status, holder, and operation fields were earned by the block through turns in its source graph, and the move does not repeat them. The target checks the state as at birth:
- tags are declared;
- fields, including the status word, pass its declarations;
- required fields stand, the body is within bounds, ref fields point at allowed targets;
- each edge's kind and target are allowed by its tags;
- sources are allowed, a symbol stands in its checkout.

Turn gates (`transition`, `open-children`), standing, and the wait cycle on edges do not repeat: they judge a turn, not a state, and a repeat would refuse a finished task implementing a closed spec.

Missing tags are named by one refusal, all at once, with a "switch the catalog on" exit: in a new project without a catalog that is the first thing a user meets.

`#tag` and `#catalog` nodes never arrive: the declaration holds the whole source graph's nodes, and the target's vocabulary is set by its catalogs and its `#tag`.

The target's address edges and unresolved local edges into arriving blocks become ordinary and are judged against the arriving block: in the target vocabulary it may hold other contracts, and waiting on a block that is not work in the target would hold the task forever.

`session`-type fields translate through the target's session register, as in [[5fead709]]. Arriving bodies' `[[…]]` references sync after the whole subtree is inserted, so a reference to a later-inserted block is also found.
