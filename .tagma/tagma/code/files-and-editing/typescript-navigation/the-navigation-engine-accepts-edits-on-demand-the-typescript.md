---
id: 01a165c5-55ad-7011-8249-b7d261d1db53
title: "The navigation engine accepts edits on demand: the TypeScript snapshot updates after a question, and until then the answer names changed files unchecked"
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165ab-b91a-760c-b5ee-a6500fc34062
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
Agents edit the checkout continuously and ask navigation rarely. Each program edit yields a new TypeScript snapshot: new checkers of changed programs and warm-up by repeating the last questions — nearly the whole engine cost under an edit flow. Building a snapshot on every touch would make an engine nobody asked for an hour warm snapshots nobody will ask for.

So a touch only accumulates paths and counts differences through git. Updating the base snapshot, a worktree's own snapshot, or deriving one waits for a question: an answered question yields demand, and then everything accumulated by that step is accepted. Touches arriving during intake wait for the next question. A worktree without its own snapshot updates without a question: it is a cheap difference count without TypeScript. Its question yields demand for the base snapshot it answers with.

Until a path is accepted, the launcher holds it in the answer's `changed`, and the answer carries `warming` when it is a path the engine reads (code, JSON, root lockfile): a graph or docs edit waits for nothing, and lag because of it would tell the agent an exact answer is still ahead when it is already exact. The kit returns occurrences in such files as "changed after snapshot" against the current text, so precision never drops silently. The price is the first question after a lull: it answers from the old snapshot, with every file changed since the last question left unchecked. Intake and warm-up run after the answer, so the next question gets the exact answer.

A deferred base `rescan` counts disk-vs-accepted-snapshot differences before intake, not vs HEAD. Otherwise a file whose edit the snapshot accepted but whose disk returned to HEAD content would drop out of `changed`, and the old snapshot would confirm places in it.

Only the base lockfile is accepted without a question, on touch, HEAD shift, or rescan. `node_modules` dependencies are invisible to the observer, and a worktree with its own snapshot has no path whose answer would call them stale. So a base dependency change and its accepted rescan release such snapshots, and worktrees answer with the base snapshot and their own differences in `changed` until a new warm-up.
