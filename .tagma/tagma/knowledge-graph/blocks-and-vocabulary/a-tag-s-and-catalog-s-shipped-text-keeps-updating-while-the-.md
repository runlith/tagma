---
id: 01a14bc5-0df5-77c8-b1a2-6931aa11ec2c
title: A tag's and catalog's shipped text keeps updating, while the project appends its part, edits sections as a layer, or takes a fork
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6930741af75a
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/sections.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/candidate.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/findings.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/layers.ts
    symbol: applyLayer
---
**Value.** A project appends its own rules to a shipped tag or catalog guide and keeps receiving Tagma improvements instead of freezing on an old text.

**How.** A `#tag` or `#catalog` node's fields and body: its own part appends after the shipped text, a layer edits its named sections, a fork records a conscious divergence. Findings show in `read_tags` and on the `#tag` node's page.

**Behaviour.**
- While the local text is the shipped text plus its own part or an allowed layer, new releases land by themselves, and its own part stays.
- Any other rewrite stops that declaration's updates and leaves a finding: return the shipped text or declare a fork.
- A finding also shows when a release moved ahead after a fork, when a layer edits a section the release changed, and when a new release failed to land. In all these cases the earlier release stays in force.

**Limits.** A layer edits a section only as the section allows, and only over a shipped type.
