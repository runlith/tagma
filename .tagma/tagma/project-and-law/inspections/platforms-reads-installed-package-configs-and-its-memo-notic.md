---
id: 01a17b1a-e853-72d9-819f-6df229b75e3c
title: "`platforms` reads installed-package configs, and its memo notices reinstalls"
ord: 37
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17af6-3ba7-7537-a6fe-d15e65ed63b7
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/records.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
---
`platforms` resolves aliases through the same config host as `modules`, but refuses on `extends` into an installed package's config: its tree never hands the host an environment reader (`environment: undefined` in `readSlice`, `apps/tagma/inspection/src/packs/js/platforms/walk.ts`). The reason is that its caches verify validity only against tree objects: memo records a dependency on an installed path as a directory listing that is not in the tree, `Validity` carries validity over the tree diff, and a sliced rule's read is stored by tree. After a reinstall they would serve the old verdict.

To do: a dependency on an installed path is recorded with the fingerprint of its contents and real place, `objects` answers with the same fingerprint, `Validity` never carries an environment-dependent entry's validity across an environment change, and the stored read's key accounts for the environment read. After that `readSlice` hands the host the tree reader, `platforms` limitations and the `rules` skill stop naming the refusal, and [[edd30011]] becomes the exception for `platforms`. Verification is the `installedConfig.itest.ts` scenario for `platforms`, plus a reinstall between two judgments over one cache.
