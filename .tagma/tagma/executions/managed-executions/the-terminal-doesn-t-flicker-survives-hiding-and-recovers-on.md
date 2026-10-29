---
id: 01a15cb5-1ba9-7d15-8785-47b6f562b511
title: "The terminal doesn't flicker, survives hiding and recovers on its own: no \"Watch again\" and no error banners over the terminal"
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15c60-10a8-767a-a5e0-ab328f30aece",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c5c-d764-7aca-9b65-9090251c93cd
  - kind: relates
    to: 01a15c49-6c0d-7317-893d-d54d0c39e069
---
Found by the operator after [[251c93cd]]:
- the right-area tab's pty terminal periodically flashes white — that never happened before;
- after hiding and reopening, the terminal is covered by a `terminal-host-refused-HostConflict: RecordReadFailed … UnknownExecution` banner, and "Watch again" does nothing; two of the operator's fresh shells (`4693e2d4…`, `2307c38f…`) exited with code 1 although nobody wrote in them.

The operator's decision: the terminal works with no recovery buttons and no half-screen errors. "Watch again" goes away; the path that now awaits a press recovers on its own, and what can't be recovered the terminal states briefly without covering the content.
