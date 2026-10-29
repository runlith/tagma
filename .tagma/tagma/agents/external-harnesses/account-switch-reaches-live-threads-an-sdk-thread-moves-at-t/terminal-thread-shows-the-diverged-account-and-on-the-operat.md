---
id: 01a17e4c-306f-714c-94fa-573cd1c3caa1
title: Terminal thread shows the diverged account and, on the operator's action, continues on the selected one with the same vendor session; every thread's row names the actual account
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17e4d-10dd-7963-8b83-ce3dc51f817f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17e4c-13fe-78eb-a310-2ebe08c44611
---
Parts "Terminal threads" and "Visibility", acceptance 4–5 of spec [[08c44611]]: the actual account of the process in the thread row from the server, a diverged-account mark on the terminal thread (Claude Code, Codex), a "Continue on <selected>" action carrying the vendor session into the new account's folder instead of seeding, and continuing the turn that failed on the limit. The same change corrects [[e412e558]] and the affected #feature records.
