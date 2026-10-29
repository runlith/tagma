---
id: 01a12407-ec8a-7eeb-afc9-5c62ef14d8ee
title: TypeScript package copy in the cut holds a symlink back into the checkout and fails verify
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1240a-aebe-72bc-83af-af69582a9976",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a123e5-3ec9-72a5-abd7-a93782682ab7
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/closure/read.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/packages.itest.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/packages.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/release.ts
---
Two cuts from one checkout reached swap and raised servers, but `--verify --no-restart` refused on `node_modules/typescript/typescript`: the link leads into the original Bun store outside the closure. The source package genuinely holds a nested `typescript` link, while release copies the package directory whole; the npm package's `files` field does not declare this link. Start at nativeCarried/copy in `installation/cut/release.ts` and the portable-link policy at closure. Done when a new cut passes verify and the move leaves no dependency on the source checkout.
