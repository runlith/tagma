---
id: 01a16661-9db9-736a-b98a-a82dd60b784a
title: The Holdings batch judge reads version texts only where the fold cannot do without them, and a light input that went opaque re-folds over all texts
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16603-f3c1-7c0c-8092-f25a22d81ba0
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
    symbol: assembled
---
The Holdings batch judge reads version texts only where the fold cannot do without them, and a light input that went opaque re-folds over all texts.

The standing-path judge after restart starts with no fold cache. It used to read every version of every unread line from `workspace_change_content` and prepare each in the walk worker. That is how memory and startup time grew with the edit count of a large file, even a git-ignored one whose lines never land.

Folding a line with a recorded hunk runs over digests, the hunk itself and rope slices, and it needs the version text only on the fallback path. So the batch judge (`deferred`, only with git conversions read) first reads hunks, and takes texts for only four cases:
- the path base, unless the path is evicted from the cache;
- lines without a hunk;
- lines with `reverts`;
- lines whose before does not continue the previous after.

An input with unread texts is marked `FoldInput.partial`. In such an input a hunk that did not fit the window ends `opaque` at a line without its own before text. It is never compared by text against the rope's reproduced bytes: after a change of line-ending rules in git those bytes diverge from the recorded version and would attribute lines to the wrong holder. When a partial-input fold answers `unknown` with reason `opaque`, `foldOf` reads full inputs through `whole()` and re-folds. So the verdict is always the same as on a full read.

Full texts are read at once by:
- a single-path judge through `whole()`;
- rollback (`restore.ts`);
- `introduced.ts`, which supplies its own texts;
- any input whose git conversions are unread: without texts it cannot tell whether a line-ending question (`carriage`) is needed.
