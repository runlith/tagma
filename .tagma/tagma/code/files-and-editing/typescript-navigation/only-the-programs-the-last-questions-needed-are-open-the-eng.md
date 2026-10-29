---
id: 01a161e6-28cc-7d77-80c1-01fc6abda76b
title: Only the programs the last questions needed are open; the engine knows the rest of the tsconfigs by file lists
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation-ts/src/engine/view.ts
  - kind: file
    ref: packages/navigation-ts/src/engine/workspace.ts
---
`tsc --api` memory grows with the count of distinct parsed files, not with the program count: a file shared by several tsconfigs parses once. So keeping every checkout program for a rare question is expensive (on runlith 112 tsconfigs are 15 thousand files, 2 GiB of live heap, of which 0.8 GiB are files of programs no ordinary question series touches).

At startup the process builds all programs once, only to write their file lists, `.d.ts`, and problems into the catalog. The first question closes programs needed neither by it nor by the last questions — the same window repeated when warming a new snapshot. The window holds the last twelve `locate` plus twelve `judge` each: a question about a frequent owner sends `locate` per owner — declared and imported from each module (`uses Layer.effect` on runlith is seven) — and in a shared window two such questions' `locate` calls pushed the first question's `judge` programs out, so repeating it reopened dozens of programs and cost as much as a cold one. An identical question stands in the window once: otherwise its repeats would occupy the window, and warming a new snapshot would repeat it once per repeat. A question needing a closed program reopens it: files shared with open programs are already parsed, and it pays with that program's cold checker. Closing never touches other programs' checkers — TypeScript carries their programs into the new snapshot as is.

Which program judges a file (coverage, `linked`, degradation) is decided from the catalog lists, not from open programs: otherwise a verdict would depend on which questions came before. For the same reason a stale list can never prove a symbol absent from a program: editing a closed program's list file or a file in its directory marks it stale, and a question whose candidate or declaration touches such a program first opens and rewrites its list. Otherwise an added import of the target in a closed program would yield a confident "another symbol". `rescan` opens all programs, and a changed base lockfile marks all closed programs stale: their dependency files may have changed. A file landing in a closed program through outside its directory (`include` with `../`) never finds that program before it opens.

The catalog is immutable and belongs to its revision: an edit, a stale-program opening, or a forgotten tsconfig yields a new catalog, and a held old revision judges by its own. Opening and closing change the TypeScript snapshot but not the revision: file contents are the same. Only a question to the serving revision closes programs; a question to a held old one only opens what is missing, and its old snapshot closes once neither a revision nor an ongoing question holds it. Each checkout has its own window, and the base's window also includes the questions of the worktrees it still serves: otherwise the next question to the base would close their programs.
