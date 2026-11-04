---
id: 01a1693e-8edb-77f9-ae63-e21678f606d3
title: "A new project's root is recorded as the physical path: identification reduces a git-less folder spelling to realpath"
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16920-ce52-7433-add7-f4f9371cd107
sources:
  - kind: file
    ref: apps/tagma/server/src/projects/identity.ts
---
A project root is its identity for everyone comparing places as strings: the rule remeasure compares checkouts by root (`checkoutKey`), `Coverage` and the place index return paths after `realpath`, serving returns `rootPath` as the main graph's checkout. A root recorded in the spelling it was named with (`/tmp/x` instead of `/private/tmp/x` on macOS, a path through a symlink, different case on a case-insensitive FS) diverges from them: after `enforce_rule` the remeasure treated the checkout as gone and after a restart did not measure the rule.

Git registration already yields a physical path (`--show-toplevel` and `--git-common-dir`). For a folder without git the key and the root are the path itself, so `ProjectIdentification` reduces it to its physical spelling; for a nonexistent tail the nearest existing ancestor becomes physical. The global root is written before its directory is created and is reduced the same way. Rows recorded earlier keep their spelling: the stealth-tree path and mirror (`stealthTreeName` and `mirrorPath` hash the spelling) and the coverage stamp depend on the root, so rewriting a row at start would orphan the journal and the mirror trash, and coverage would answer `moved`. Such a row transitions in a separate migration with its storage; until then the registry compares row roots by physical spelling (root search and resolving a project by place), memoizing it until the next registry change, so an old row is found and returned as the same project.

Rejected: comparing witnesses or calling `realpath` in every consumer. Consumers are many (remeasure, serving, resolving a project by cwd), and each would repeat one compensation; the registry already carried two of those — in resolving a project by cwd and in returning a folder deleted before the first commit — and they are removed.

Boundary: the registry does not canonicalize the call place (`cwd`, a path in an operation). A path named through a symlink finds the project through place identity (`placeAt`), while consumers that attribute a path to a root as a string expect the physical spelling.
