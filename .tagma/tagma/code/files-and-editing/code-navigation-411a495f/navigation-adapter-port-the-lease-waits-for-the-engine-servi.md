---
id: 01a16166-d112-7630-a334-43ed24ff5432
title: "Navigation adapter port: the lease waits for the engine serving the snapshot or refuses with a cause; positions from the root in UTF-16, verdicts in order, the kit sets the 'snapshot/language' causes"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/navigation/src/adapter.ts
---
The `Engines` port is filled by the engine holder: `lease(root)` by the checkout root's absolute path hands over an engine when it serves the snapshot — the question waits for its loading, for room for it, and for a new generation after a crash — and holds the lease until the question's scope ends. Switched-off navigation is `EngineDisabled`, which the operation answers as `navigation-disabled` with a suggestion to switch the setting on; the lease does not raise an engine. An engine that cannot be waited for (crashes again and again, the checkout is not served by it) is `EngineFailed`, and the question refuses with `engine-failed` and a cause. There is no ripgrep-candidates answer “without an engine”: a grep-level answer instead of waiting is useless to the agent — they asked for the exact one.

All paths inside the port and in the answer are from the checkout root; lines and columns count from 1, columns in UTF-16 units, as the ripgrep kit ranges. `Subject.id` is an opaque adapter reference, valid only at the snapshot revision it was issued at: the kit does not keep it between questions.

`judge` returns exactly one verdict per position in the same order. The “unreviewed” verdicts “changed after snapshot” and “no adapter” are set only by the kit: files from `Snapshot.changed` and files outside `Capability.extensions` never reach the adapter, because their text is newer than the snapshot or the engine does not know the language. The adapter sets the remaining causes. `locate` is the exception: the kit passes the question point from a changed file too, because the agent asks about just-edited code, and the adapter looks for the name near the line, and failing that — in the whole file, nearest to the line first (another's edit above shifts the line by any number of lines); finding no name in the file, the kit refuses `missing` and names that the file is newer than the snapshot. Besides subjects, `locate` answers `resolved` — whether the point's name resolved in the file (for `member` — the owner with a type, not `any`): by it the kit stops walking same-import files. The kit downgrades declarations from changed files to “changed after snapshot” in the `definition` answer. If ripgrep did not read part of the tree, the answer carries `summary.partial`.

`aliases` are only aliases under a different name: the kit searches each such name in a separate ripgrep pass and asks `judge` with the alias's id, no deeper than two hops; the adapter recognizes a same-name alias itself among the positions already passed. `basis` are the files whose types the answer relied on: the kit names their post-snapshot change in `stale`, as it names a change of a file from `Capability.manifests` — verdicts in the other files may be stale. A changed manifest warns only if it lies in a directory above a file the answer read: a target's declaration, a `basis` file, or a file with an engine verdict; a `package.json` in a directory where no such file is read (or all files there are “no program”) changes no verdicts.

An engine process crash mid-question is `EngineLost`, and the question refuses `engine-lost` instead of downgrading to “unreviewed”: the spec requires it. The next question waits for a new generation.
