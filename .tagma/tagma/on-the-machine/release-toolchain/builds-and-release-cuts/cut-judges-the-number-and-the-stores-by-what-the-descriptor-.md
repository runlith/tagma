---
id: 01a17f40-a762-731a-b2ca-80cc6f5e8d14
title: Cut judges the number and the stores by what the descriptor's publisher answers is published and by the checkout's tags, while the newest release's migrations and steps stay in code
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1361b-0306-7539-b5f1-3cd46c675b20
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/pipeline.ts
  - kind: file
    ref: apps/tagma/server/src/cut/published.ts
---
- **The published is what the descriptor's publisher answers** as its latest feed, together with the checkout's `v<n>` tags, which remember numbers the publisher no longer lists. The release number sits above them all: a release that may stand on people's machines never gains a double under the same number. With nothing published, the first number is `0.2.0`: `0.1.0` was issued outside the feed. A distribution without a publisher judges the number by the checkout's tags alone, and with no published feed it declares nothing irreversible.
- **Store chains are eternal.** The cut refuses when it lacks a migration or step from the `stores` of the latest feed's newest release: only every step of its keeps translating a database that release wrote. The cut never requires folding the carried `machine-store` migrations into the baseline: on a database that skipped a release the folded chain refuses `BaselineNotReached`, while the channel offers only the newest release, and such an installation would never update. The check sees only the latest feed: a migration carried by one withdrawn release is never found.
- **Irreversibility** is judged by the same feed's newest release; a release with no published predecessor is declared irreversible to nobody.
