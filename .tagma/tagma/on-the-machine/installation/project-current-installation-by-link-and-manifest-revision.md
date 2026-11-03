---
id: 01a1a257-34d0-7068-8429-0c22bcbeecf9
title: Project current installation by link and manifest revision
ord: 65
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a1d9-8e94-7b5b-8188-aa7a75a98d69",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef5-738e-8ee9-97f36cc306ce
---
Succession and the desktop reader use closure-owned manifest projections keyed by canonical target and manifest revision, with a shared two-entry recency window that retains the active comparison pair without retaining update history. Public-door regressions cover repeated proof, A→B→A reuse, revision changes, missing manifests and mid-proof switching. A delivery-review regression observed both server and window retaining a pruned cold manifest through WeakRefs before the fix; after admitting a third root, forced collection released both cold manifests while the hot pair remained reachable. projection.itest.ts passed seeds 1, 2 and 3, and the server package typecheck passed; joint landing and task completion remain with the integration owner.