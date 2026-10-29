---
id: 01a12877-1313-746d-9a8b-c883865fed08
title: A single ProcessWitness and neutral refusals keep process and adopted-job identity
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
---
Move wire, host ports, the POSIX adapter, and consumers to a single ProcessWitness { pid, birth }, where birth stays an opaque OS value; the wire holds identity comparison, birth ordering stays with ProcessReader. Remove errno from ports and the core, passing Gone/Unreadable and the adapter's meaningful refusals. Fix adopted-job observation: a foreground refusal no longer hides an exit, and a reused pid no longer keeps the old session. Completion is proven by narrow contract checks and a landed delivery; unverified OSes named separately.
