---
id: 01a15a12-1d25-7662-b3bb-730180090fc8
title: Tasks are a separate `work` catalog installed beside any catalog, not part of software-development
ord: 5
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
**Question.** `#task` currently exists only in software-development. A knowledge-project (`knowledge`) user who needs tasks can only get them by installing software-development in full — with `#module`, `#rule` and code checks.

**Opportunity.** Move `#task` (lifecycle, holder, `ready_work`, `waits-on`) into a small `work` catalog. Software-development installs it with itself, `knowledge` and others on request. A task is the same everywhere.

**What decides the choice:**
- what else enters `work`: `#spec` most likely stays in software-development as a development subject;
- how a catalog depends on another catalog and installs with it — whether the installer has such a mechanism;
- transitioning installed projects off software-development, runlith included, without losing tasks and their history.

**Unknown:** whether knowledge users need tasks enough to reshape the catalog structure. The signal is when such a user appears.
