---
id: 01a1400e-516e-7b8a-bc20-4450eff08817
title: Migrate the workflow-member tests to Effect and the Clock report-collection bound
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/collaboration/collaborationWorkflowMembers.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationWorkflowMembers.ts
---
Migrate collaborationWorkflowMembers.test.ts to it.effect with full tagged doubles and a cast-free ThreadRow; keep the full report text. In collaborationWorkflowMembers.waitForReports, since comes from the Clock when run under the Effect-time norm. Verify the original full-text contract through the public waitForReports; collectReports accepts unread envelope/report regardless of since, so a time filter in the double does not model the product and proves no report loss. Use no StoragePort/factory, keep spans. Serial file test, file-scoped check, law, one Sol+Muse round; evidence to the parent before landing.
