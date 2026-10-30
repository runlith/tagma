---
id: 01a18cf1-83eb-780f-96a6-5a70e0faa87f
title: "App: one model picker per ask kind for the lens, the ask settings and the summarizer list"
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
  - kind: waits-on
    to: 01a18cf1-4277-77ed-b6af-3214f1fc96ce
---
Build the app half of spec bcec10b7 once the server task publishes each served model's ask kinds:

- **One picker per kind.** Every place that picks a model for an ask uses the composer's model picker component, filtered by the kind its role needs: the translation lens chip, the `translation.model`, `threads.titleModel` and `threads.decisionModel` settings, and the members of `agent.compactionSummarizers`.
- **New settings control kind.** It writes model and rung together, in place of the two separate catalog controls.
- **Empty state.** When nothing answers, it names what to connect.
- **Removed.** The `model` and `decision-model` choice sets in `features/providers/choices.ts`.
- **Refusal words.** The translation strip shows the ask refusal set.
