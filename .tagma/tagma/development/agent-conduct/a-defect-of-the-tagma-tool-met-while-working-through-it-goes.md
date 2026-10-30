---
id: 01a1282c-6b3c-733c-a51a-03fa35be02f0
title: A defect of the Tagma tool met while working through it goes to an agent at once; a blocking one is fixed or worked around in one direct way
ord: 5
tags: ["rule"]
edges:
  - kind: supersedes
    to: 01a1615d-996e-7c2b-b77f-ee5e6dd14633
---
Record it as a reflection or a task; an agent picks it up in the same turn while the current work continues, and where no agent can be started, the finder fixes it right after the current work. A defect that blocks the work is fixed in Tagma's own sources or worked around with one direct action — no repeated calls, rewritten files, extra procedures or agents around it.

A commit that `submit_work` refuses because of a Tagma defect never stops the work and is never taken to the operator: keep working and land later or with a plain `git commit`; never wait on a server restart, a fix or an operator decision because of it.