---
id: 01a164ac-5375-72c2-88f0-87a20c6f0a9e
title: A commit carries the changed files a carried file needs, as far as a language adapter can see; a false match enlarges the commit by one file and the importers its writers hold
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/closure.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/dependencyWalk.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/dependencies.ts
    symbol: neededPaths
---
Whole files are right in every language, so this walk is not what makes a commit safe: it keeps a landing from carrying a use without the declaration that exists only in another changed file — the broken HEAD that reached a checkout build. It can err toward a larger commit, never a lost file: a false match carries one more file whole, with the joined file's lines of other writers and those writers' changed files that import it; the rules judging the larger tree can then refuse on a crossing the caller never wrote.

The walk starts from each carried file that a code-facts adapter parses (JS/TS/Svelte today). It reads the file's imports from the working text and keeps the targets that are changed, carriable files not yet carried; a landing whose carried files import no changed file runs no parser beyond the import list. A changed target joins when it declares a name the carried file uses that HEAD lacks, and a target whose declarations cannot be read joins too. Imports are followed through re-exports and through the changed files reached on the way. Member and property spellings (`length`, `.map`) are matched by name, and a checker over the importer and the files it reaches narrows those matches before they count; a spelling it cannot settle still counts. A carried file whose own imports cannot be read adds nothing.

Joined files are carried whole and become roots of the next round, together with the changed files of their writers that import them; the other uncommitted files of a writer ride only when the writer's lines stand in a file the caller selected, as the Holdings judge answers it: a row still held whose text was overwritten, or a command observation, makes no writer. A judge that cannot answer counts every holder of a held row. The closure repeats until nothing joins. This is no typecheck: names reached only through unchanged intermediate files stay out of range, a language without an adapter adds nothing, and the rules and hooks judging the built tree remain the safety net.
