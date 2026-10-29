---
id: 01a15a0d-c80e-7487-bdcb-0c85935c9fc0
title: Replace the notes catalog with knowledge and keep installed graphs
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a0d-309b-732c-9b73-a059f17930cb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/knowledge.ts
  - kind: file
    ref: apps/tagma/server/src/catalogs/contract/wire/registry.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graph/vocabulary/knowledge.itest.ts
---
The knowledge catalog is installed: decision, person, meeting and source; a plain note is an untagged block. A decision stands until replaced through core supersede, with no independent lifecycle field. Installed notes transition through a settings migration and a graph step before the installer: UUIDs, keys and user edits are preserved; former note/recipe become local types. Boot does not update the vocabulary of old or unknown rows before the lazy switch and graph steps. The new-project dialog takes the catalog from graph.catalogs, with no separate list in the UI; the feature description is updated.

Public checks covered writing, the mandatory meeting date, person participants, the source address, the decision chain, catalog installation, preservation of old data/refs/queries/amendments, and the full boot→switch→migration→installer. Main suites: 67 catalog and consumer checks, 9 migration/sequence; after fixing the order, 33 checks of affected owners and a separate focused boot run. The independent [[01a15a18-3d50-7eda-90b3-1f4c35ac4be5|reviewer]]'s single P1 — premature installation at boot — was confirmed by a red test and fixed at the producer. Full typecheck is not proven: the last bun run typecheck ended "Found 7 errors in 1 file, checked 5,202 files"; the remaining errors in native-harness/voice/graphDisplay.test.ts concern optional facts.value outside this delivery. The live UI and the operator's server update were not checked; the server was not restarted.

Commits: 41505d01e6 — catalog and consumers; ef681e263f — installed-graph carry-over; 57f6ab5560 — machine-install order and GraphSteps wiring. No uncommitted own lines.
