---
id: 01a11803-2ce1-7fcd-8e5c-372eb1cf86f9
title: File write checks the standing content immediately before the visible step and writes the symlink target, not the link
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/files/src/replace.ts
---
`replaced` is a CAS write of file content: agent tools, line revert and the operator's edit build their guarantees on it. The new content is first written to a temporary file next to the target, and only after re-checking the standing bytes (`stillStanding`) and that the name still leads to the same target (`realPath`) do rename, link or remove go ahead; a check from before the temporary-file write does not count — between the two, the file gets changed or the link redirected in time. Without this, the write silently overwrites someone else's edit or another file. A file that vanished before the write is a check miss (`false`), not a failure.

Staging file names belong to the `replace` format; `isStagingFile` recognizes them even after deletion, regardless of the parent path spelling and the writing process. Command snapshots exclude such untracked files, including files inside new directories: otherwise a temporary write and its cleanup would become a nobody's edit of a command running nearby. A tracked file with such a name stays an ordinary project file.

Creation exclusivity is held by `link` of the temporary file: a taken name answers `false`, not by overwriting. A file with several hard links or a foreign owner is written in place, because rename would tear it away from its other names; the mode is then set before writing. Replacement through a temporary file preserves mode, owner and group. For a symlink, its target is written, the link itself stays. `resource` ties the CAS to the address at which the caller already received queue and approval: a link change cannot write different bytes under the old fact.

`publishing` is called exactly before the visible step and returns the rollback that fires if the step fails: so a write intent in the change journal never outlives a failed write. Everything that can refuse without consequences for content (mode, owner) is done before the visible step, so its refusal does not roll back already-visible bytes.

The root boundary (that a write does not leave the checkout) is checked by the caller — `replaced` does not know it.
