---
id: 01a13ba4-c799-75e6-9095-2e55a7bccf5c
title: submit_work names an unattributed path to land via `paths`, then answers `nothing` for exactly that call
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "\"nothing to commit — this session holds nothing the branch does not already carry\", while `git diff bun.lock` showed 7 uncommitted lines; only a third call with `whole: true` landed it (lines shared with another session's install). Cost: one extra call and a git inspection.",
    "command": "submit_work {paths:[\"bun.lock\"]} after a landing answered \"not in this commit — 1 path this session's commands changed without attribution still stand: bun.lock; submit again naming them in paths to land them\"",
    "expected": "The recovery the first answer printed lands bun.lock (the change `bun install` made for this session's package.json edit)."
  }
---
Filed from project `runlith`.

The bun install command's write was recorded as an overlap with another session's lines in bun.lock. The bash notice said "name their files ... with whole: true", but submit_work's own `left`/unattributed hint said only "naming them in paths", and the follow-up answer `nothing` contradicted the working tree instead of refusing with `lines-held` or pointing at `whole`.