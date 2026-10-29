---
id: 01a146aa-653b-7c68-b9cf-940222643a8d
title: "Refusals in the thread feed: a collapsed orange row instead of an expanded red `Gate refused` card"
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14694-b5a4-7373-a56f-b8a49336431b",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a118f1-5f59-7eb8-856a-a0deb7bb8a8f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ToolResultRow.svelte
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
---
A call refusal (`output-refused`) is addressed to the agent: the agent reads the code, the reason, and the `unblock` and changes course with the next step. Right now the feed shows every refusal to the person as an expanded red "Gate refused" card: the code in the heading, the reason and agent instructions in view, the same fact repeated four times. In a sample of 30,000 calls since October 15 there are 241 refusals (0.8%, 37 codes). None of the frequent codes (`not-found`, `law-violated`, `thread-running`, `body-shape`, `exit`) needs a person's action. The operator accepted the option analysis: a refusal the agent itself will fix is a quiet collapsed row; disclosure and red are for failure.

What to do:
- **Chat kit** (`packages/chat-ui`). A refused step does not disclose itself, even when `display.opens` asks. A refusal is distinct from a failure: the dot is an orange ring (`chat-refused`), the row text is ordinary, the status is the refusal-code word, unless the producer fact already said it. The step-group heading counts failures and refusals separately. The "disclose by default" rule is one on ActivityStep and height estimation.
- **Server renderings.** An operation-answer refusal and a send refusal do not set `opens` and do not duplicate the code with a `refused` fact.
- **Words for the person.** The rules court puts `words` into `law-violated`/`inspection-failed` refusals: which rule was broken and where. Landing builds the GateRefusal from the court report in one place.
- **The card in the app.** Instead of "Gate refused" — `Told`: human text (`words`, otherwise the reason), with the code, reason, and `unblock` collapsed under "What the agent was told". Operator-action refusal toasts go through `Told` too.

Done when: the feed shows a refusal as one orange row without disclosure, the disclosed card starts from human text, `law-violated` carries `words`, and typecheck and the affected package tests are green.
