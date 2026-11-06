---
id: 01a1b1a9-3c5b-7962-8236-16a49d7d0b8c
title: A question of a plugin's thread goes to the plugin while it can take it, and back to the person the moment it cannot
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12337-633e-7f16-ab51-06c3f2afdfd3
  - kind: relates
    to: 01a15225-ddb1-7c13-9b6b-ef1cfb0986e6
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/pluginQuestions.ts
  - kind: file
    ref: apps/tagma/server/src/threads/approvers.ts
---
The route answers `plugin:<id>` (why `owner`) ahead of the parent and grant cases when the thread's `bindings.plugin` names a plugin that registered `on.asked` and runs in the thread's project, and the question carries asked actions. A secret prompt carries none, so it stays with the person. A routed question has an approver, so it leaves Attention and push like a parent's.

`notify` never waits on the plugin: the question lock is held while it runs, and a cold process can sit behind a backoff gate for a minute. The delivery is forked and calls the `asked` tool through the contribution's caller, which opens an idle process. A failed call, an error answer or `{question: "left"}` (the SDK's `leave()`) marks that question left and reroutes the thread. The route then reads the mark first, so that question stands with the person while the thread's next question still goes to the plugin.

The marks and the delivered notice ids live in memory. After a restart, the registration reroute delivers each open question again, once; plugins take it idempotently by `questionId`. The plugin answers with `answer_question` on its own thread; the person may answer first.