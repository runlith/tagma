---
id: 01a132e0-398e-70fa-a3f6-d7fb30a50401
title: An unchanged HEAD on refs/head refreshes metadata but does not invalidate tree-input consumers
ord: 13
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a132b7-5d62-766a-aceb-e338e97fcd17
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
    symbol: makeGitCheckoutRows
---
Shared refs also move from someone else's checkout, so such a mark alone does not prove a staged, unstaged, or untracked change. Git-operation markers do not change source files either: a lone `operation` movement updates only sequencer metadata, keeping the tree snapshot and not notifying tree-input consumers; tree, index, or its own HEAD-shift movements accumulated with it keep their invalidation. The workspace rechecks its own HEAD and branch name: when they are unchanged it keeps the tree, and `onMark` does not report a false unnamed input change to consumers. A HEAD/branch change or a failed check passes full invalidation; config, index, and unknown rescans keep the full path. Comparison uses already-read oids so a ref movement between reads does not mix it with another HEAD.
