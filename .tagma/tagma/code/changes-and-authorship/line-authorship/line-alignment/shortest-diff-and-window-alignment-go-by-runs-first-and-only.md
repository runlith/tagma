---
id: 01a168f5-9ec1-79f1-9105-e3f102f97102
title: Shortest diff and window alignment go by runs first, and only by paired lines once the walk outgrows its sides
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/alignment.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/intervals.ts
    symbol: minimumOf
---
Myers costs O((N+M)·D), and almost all of D after a large migration is lines with no equal on the other side: a re-indented test wrapped in `describe`. Such a line enters no longest common subsequence, so a walk without it gives the same distance and costs only as much as the lines that can match at all. Without this, the folding budget went to the neighbor migration's square, and a three-line edit next to it ended in `walk-cut` with reason `budget`.

First comes the old walk — `minimumOf` over runs of shared origin, window alignment over the whole pair of sides — capped at N+M steps. The cheap case (a small edit to a large file) keeps the run-based cost and the earlier choice among equal alignments, which authorship depends on. Only a walk that outgrew the cap repeats over lines with a pair. The choice among equal alignments there may differ from the old one. The distance stays minimal, and `netOf` still reconciles windows against it. The steps spent on the first attempt stay in the budget, so the cost is at most min(old, N+M + narrowed) + N+M.
