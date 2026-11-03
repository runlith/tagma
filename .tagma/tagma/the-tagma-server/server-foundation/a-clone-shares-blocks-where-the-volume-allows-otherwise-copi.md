---
id: 01a1a2c9-fcbd-749a-8b14-161b255cab8c
title: A clone shares blocks where the volume allows, otherwise copies after a space check; a file never costs a child process
ord: 48
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/durable/clone.ts
---
`cloneTree` serves four callers:
- the release channel's place step;
- the macOS application copy;
- the disk image's staging;
- the read of an attempt's migration ledger.

`cloneFile` is the durable variant beside it and shares the same clone-or-copy step.

- **A file goes through `copyFile` with `COPYFILE_FICLONE_FORCE`.** Where the volume cannot clone (`ENOTSUP`, `EXDEV` and kin), it falls back to a plain copy after checking free space for the source size. A source snapshot copies thousands of files, so a child process per file would cost seconds that the clone itself does not.
- **A tree on macOS goes through `/bin/cp -Rc`, then `cp -R`.** The old code took this path for application bundles, and `cp` carries extended attributes, ACLs and file flags that `fs.cp` drops. `cp -Rc` clones each file with `clonefile(2)`. When it fails part way, the plain `cp -R` overwrites what it left. Elsewhere a tree is a space-checked `fs.cp`.
- **The copy merges into what stands at `to`.** The place step puts the release beside the application copy that already stands in the staged version. Callers own what a failure leaves behind: the staged version's lease, or `.incoming` beside an application.

A refusal is `CloneFailed`. `needed` is set when space ran short, so callers can tell the person how much to free.