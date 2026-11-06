---
id: 01a1b1a9-3c5b-7962-8236-16a49d7d0b8c
title: A question of a plugin's thread goes to the plugin while it can take it, and to the person — never a parent — when it cannot
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
The route answers `plugin:<id>` (why `owner`) when the thread's `bindings.plugin` names a plugin that registered `on.asked`, runs in the thread's project and is not broken, and the question carries asked actions. A thread bound to a plugin that cannot take it now answers the person (why `owner-away`), never the thread's parent: such a thread is the plugin's conversation, and a parent's grant would otherwise answer what the operator decided only the plugin or the person answers. A secret prompt carries no asked actions, so it stays with the person. A routed question has an approver, so it leaves Attention and push like a parent's.

`notify` never waits on the plugin: the question lock is held while it runs, and a cold process can sit behind a backoff gate for a minute. The delivery is forked and calls the `asked` tool through the contribution's caller, which opens an idle process. A failed call, an error answer or `{question: "left"}` (the SDK's `leave()`) is a hand-back: `Questions.decline` drops the approver and writes `declinedBy` on the question entry, and the kit's route keeps a declined question with the person for good. The mark lives on the entry so a restart, a reroute or a returning plugin never sends a left question back; the thread's next question still goes to the plugin.

Who can take a question changes in three places, each rerouting only the open questions of plugin-bound threads (the open-question selection of [[fb0986e6]] joined to the binding): the plugin's `on` contribution is published or withdrawn, the enabled set of a project changes, or plugin-host marks the plugin broken or whole again (a resident process that crashed or a manifest refused). A withdrawal, a switch-off or a break reroutes only the questions whose route changes. A publication or a recovery is a new delivery episode: it reroutes every open question of that plugin's threads, so each is delivered again — including at server start, when contributions are published — and plugins take a question idempotently by `questionId`. An idle process is not broken: its next call opens it.

The plugin answers with `answer_question` on its own thread; the person may answer first.
