---
id: 01a14c21-a71d-78ec-bf04-79bfa8654e25
title: Effect-style tells a Reference with data from a Service implementation
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c27-7eb0-7cc4-aae4-0e02bf0c220b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66ef5b12dbe8
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: dir
    ref: checks/law/effect-style
  - kind: file
    ref: checks/law/effect-style.test.ts
---
Fix the confirmed service-instance false positive at the checks/law/effect-style check's owner: a Context.Reference<Invocation> with a data class is wrongly judged a Service implementation. Keep detecting real class-service provisions, aliases and memo/snapshot correctness when reading an imported tag. Change no Invocation, work around no spread, add no name-based exception. Proof is the public verdict's red/green for Reference and Service, including the imported CurrentInvocation from platform/cli/verb.ts; green existing checks, narrow typecheck, an independent Sol review and a commit.
