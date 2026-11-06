---
id: 01a123b3-b8cd-7701-8c87-60d0b02966b8
title: "A plugin acts on the threads it owns: the named thread's binding is checked once at admission, and its subtree counts as its work"
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a123ab-f138-71e5-a304-1358f3764a88
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/plugin.ts
---
An operation declared `external: 'own'` — `stop_run`, `answer_question`, `set_thread_model`, `restart_thread`, `continue_thread`, `archive_thread` — admits a `plugin:<id>` caller only on a thread whose `bindings.plugin` names it, and any other outside caller not at all. Admission reads the addressed thread's row once, where it checks `external`; no body repeats it. Only the named thread is checked: archiving a plugin's root puts away its descendants too, whatever their own bindings, since they are its work. An absent thread passes admission so the body answers its own `not-found`. Operator and agent paths keep their own conditions.