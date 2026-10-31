---
id: 01a14890-0641-7225-9ac6-150e8cea6021
title: "Thread rollout-file meta for code does not migrate to developer: a thread restored from a rollout with no database row is born with agentId code"
ord: 118
tags: ["task"]
fields:
  {
    "holder": "tagma:01a149fa-30c4-741e-ac91-360dfb76dfdc",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/developerRollout.itest.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/steps/developerForm.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutEntryForms.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutMeta.ts
---
Cause confirmed: the SQL migration changes rows, while full export and appendMeta write current rows only on the next write; a never-re-exported file with no database row kept agentId code. The existing form steps gained a meta kind; native-harness declares a code → developer step with the same profile rights as the SQL migration. The shared form owner before bring rewrites the header and trailing meta entries of a row-less file without setting a premature SQL mark; import gets no separate fallback. The regression owner integration gave Expected developer / Received code, and after the fix verified a native file without a tail, a hosted file with a tail, preserved capabilities and restored rows. Narrow checks — 16/16, `bun run tagma:typecheck` — exit 0; one Sol xhigh review with no findings. The flat meta branch was verified by code reading, with no separate integration run for it. The operator server was not restarted.
