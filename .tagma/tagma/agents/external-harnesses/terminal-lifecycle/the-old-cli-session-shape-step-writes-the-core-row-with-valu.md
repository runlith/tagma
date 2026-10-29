---
id: 01a1526e-66c9-72d0-9449-56cab8eb6819
title: The old CLI session shape step writes the core row with values as of the step's day, not from live adapters
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/steps/sessionMeta.ts
---
The old rollout copy kept transport, host, model choice and proven capabilities in the external session facet. The `sessionMeta` step carries them into the core row (`native` in meta) and brings the facet to its current shape. Vendor values — provider, web, call deadline, `continue`, `usage`, `aside`, terminal law — are written into the step as constants taken from the adapters on the step's day.

The step translates the stored shape: live code does not import it, and it must not load vendor lines into the manifest. Besides, an adapter change must not change what an old copy turns into: the next shape step decides on its own how to bring an already formed row. A repeated step on the current shape returns `null`, so files that already passed it are not rewritten.
