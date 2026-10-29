---
id: 01a15f78-4342-7ed6-9ddf-f12dcff3c7af
title: The login terminal via the official CLI lives in the provider card, and the login outcome is named in place
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f6c-094d-77fa-a795-5f18abf04aa3",
    "status": "done"
  }
---
The external-cli login path (Claude Code, Devin) today takes the operator from Settings → Providers to the shared terminal panel (`SignInFlow.begin` does `router.goto`), the completion poll dies with the card, and the outcome the server-side `settle()` determines nobody shows: the screen keeps "Terminal exited with code 0".

Do per variant A of the agreed layout: the login terminal mounts into the card's pending block with the existing `terminal/View.svelte`, navigation goes away, on finishing the card shows the verdict — the signed account by name or "login not finished, nothing added" with retry and the CLI output. The same login surface in ConnectCard shows the terminal at itself instead of taking it to the panel. A login failure (the pending line vanished) is recognized as a failure, not a success.
