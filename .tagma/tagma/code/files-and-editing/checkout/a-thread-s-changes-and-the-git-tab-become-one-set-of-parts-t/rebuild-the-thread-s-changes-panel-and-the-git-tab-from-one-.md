---
id: 01a0d00d-0437-72e1-8ad5-b5c4dcabc620
title: Rebuild the thread's changes panel and the Git tab from one set of parts, with commits, width rules, wrap and file stepping
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cff3-9abb-7fb8-888c-f68f0a033726",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d00c-2ecf-7b08-9009-12944085a12c
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/checkout
---
The client half of [[4085a12c]], built against the shapes fixed in [[3f529b7d]].

Scope: `apps/tagma/app/src/lib/features/checkout/*`, `apps/tagma/app/src/routes/[project]/chat/+layout.svelte`, and the wrap prop on `packages/chat-ui` `ToolDiff`.

- **Shared parts.** Change row, section head, line count, commit list, diff pane and view menu. They replace `PathRow`, `PathWeight`/`pathWeight`, the inline row of `FilesColumn`, `CheckoutSection`'s head, `DiffStage`'s and `CheckoutPage`'s heads, and `FoldedPathsOpen`.
- **Thread panel.** Uncommitted with the standing mapping and the commands fold; Commits docked below; no acts; the count on the header toggle.
- **Git tab.**
  - The branch row with one sync button.
  - The commit box above the list, with Amend only when something is staged. This answers [[71444243]].
  - Sections: Conflicts, Staged, Changes (untracked inside it), Graph as one row.
  - The branch log with graph runs folded.
  - Group by thread, and a stale chip in place of the reading paragraph.
  - The shorter status tenant.
- **Width rules.** The diff beside the conversation when it fits; an overlay panel under 1024px; drill-down in the Git tab under 900px.
- **Keys and wrap.** J and K step files; wrap long lines.

Done when:

- The checkout suites and the typecheck pass, and the tests pin the mapping, the count format and the commit wiring, not layout or copy.
- The claims listed in §8 of the decision are rewritten or retired from the built code.
- The three-model review is done and what held is fixed.
- The work is committed.
