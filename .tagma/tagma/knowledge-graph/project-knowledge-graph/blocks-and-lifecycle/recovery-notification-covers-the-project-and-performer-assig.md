---
id: 01a11c14-39fd-731b-a293-2503e74c3343
title: Recovery notification covers the project, and performer assignment survives a repeated press
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/Recovery.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/RecoveryBanner.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/serving/recovery.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/routes.ts
---
Recovery live state is read from the metadata shadow Git regardless of mirror and selected branch. The surface shows the first unfinished case and the count of the rest; once completed, the next appears. The assigned thread is stored with the incident, and the first message carries the incident key: a repeated act opens the same performer. Threads creates and starts the thread on the operator's press, the graph stores the case and publishes the finished solution; the UI only shows state and forwards the act.

A lost watch of the records directory — the watch process died, a ticket was refused, or a stealth→team move renamed `graph.git` away under it — never ends the feed: it reopens after a pause and rescans, and the reopen recreates only the records directory inside an existing shadow Git, never the Git itself. Ending the feed left the window with a failure no later notice could clear, and birthing the Git mid-move would plant an empty graph at the old place before the policy switches. The operator can dismiss the banner; it returns when what it shows changes.
