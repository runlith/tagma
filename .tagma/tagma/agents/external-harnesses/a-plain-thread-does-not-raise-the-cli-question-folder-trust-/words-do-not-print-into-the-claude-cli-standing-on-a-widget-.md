---
id: 01a14279-4e36-79fc-9c92-411f051da475
title: Words do not print into the Claude CLI standing on a widget; the question arises with no open run either
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141bd-4d86-7052-9111-958c8dc139ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1424a-e721-7e2c-8986-a0532e5f9389
---
Live check 99e9d6d5d4 on witness thread 01a14246 (polygon): after restarting, the CLI stood on the trust dialog with no open run and no question; send_task opened a run, words with Enter went into the widget, Enter picked "No, exit", the CLI exited, and the run was dismissed as "closed unread" in 0.4 s.

To do: a screen question rises even with no open run (an adopted process, a question from a dismissed run); word delivery does not print into a CLI standing on a widget; a process exit is not reported as "unread". Proof: a system test of a plain thread with a widget before the first run, typecheck, Sol xhigh review.
