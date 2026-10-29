---
id: 01a13c1e-3bfc-7396-8fbc-1442d86aeced
title: enforce_law patch returns the whole allowance list instead of a bounded result
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "Patch applied, revision e960a33838c0; the response ran 131638 bytes and 664 lines, listed every allowance in the repository and was cut off. Moving two keys does not need the whole engine.",
    "command": "enforce_law({blockId:\"ea465bed\",base:\"d879186294f5\",strictness:\"gate\",inspection:{patch:[{builtin:\"swallowed-failures\",list:\"allow\",put:[{path:\"apps/tagma/server/src/workspace/repositories/registry.ts\",symbol:\"makeRepositoryRegistry.holds\",form:\"catch\",site:\"6f61e9a7\",why:\"A link that cannot be read counts as held unless the failure is NotFound, so a repository is never taken for free.\"},{path:\"apps/tagma/server/src/workspace/repositories/registry.ts\",symbol:\"makeRepositoryRegistry.link\",form:\"catch\",site:\"7830d87d\",why:\"A path whose existence cannot be read counts as held, so nothing is registered over it.\"}]}]},background:true})",
    "expected": "Change two existing allowance keys and return the revision, the measurement result and the changed records; the full engine is read separately."
  }
---
Filed from project `runlith`.
