---
id: 01a17f40-a762-731a-b2ca-80cc6f5e8d14
title: "\"Cut judges the number and the stores by the published: the number follows every published release and checkout tag, while the newest release's migrations and steps stay in code\""
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1361b-0306-7539-b5f1-3cd46c675b20
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/pipeline.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/published.ts
---
- **The published is read by `gh`:** the Latest release feed and the numbers of all published releases, prereleases too. The checkout's `v<n>` tags remember numbers GitHub forgot after a release was deleted. The release number sits above them all: a release that may stand on people's machines never gains a double under the same number, and after a release is pulled the next one never repeats its number. With nothing published, the first number is `0.2.0`: `0.1.0` was issued outside the feed.
- **Store chains are eternal.** The cut refuses when it lacks a migration or step from the `stores` of the Latest feed's newest release: only every step of its keeps translating a database that release wrote. The cut never requires folding the carried `machine-store` migrations into the baseline: on a database that skipped a release the folded chain refuses `BaselineNotReached`, while the channel offers only the newest release, and such an installation would never update. The check sees only the Latest feed: a migration carried by one pulled release is never found.
- **Irreversibility** is judged by the same Latest feed's newest release; a release with no published predecessor is declared irreversible to nobody.
