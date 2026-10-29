---
id: 01a16e52-83e9-73ac-a8f0-41a25c8b3051
title: Commit exclusion in the git kit judges the paths a commit changed, read in one log pass
ord: 111
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16e50-3c93-75ed-bf4d-1eb8361face6
sources:
  - kind: file
    ref: packages/git/src/history.ts
---
`excludeConfined` on `logAt` and `unpushedAt` is a predicate over changed paths: a commit leaves when every path it changed satisfies it, so a commit is judged by what it did, never by its subject or author. A caller's own convention (a subject template, `git log --grep`) would match message lines rather than changes — a body line looking like a graph subject once dropped user work at the branch-deletion decision.

Paths come from the same `git log --name-only --no-renames -z` pass that lists the commits, framed by the empty field each record's leading NUL leaves: no process per commit. A commit with no changed paths — empty, or a merge, which prints no files of its own — is confined, and a rename counts both of its paths.

`logAt` reads unfiltered records in windows growing fourfold (from `max(64, 4 × (skip + max))`). It filters first and only then cuts `skip` and `max`. Rereading the prefix as the window grows costs at most 4/3 of the last window in total — linear, not a paged walk over `--skip`. The `unpushedAt` count reads the paths of every commit in the range: the count already walks the whole range.
