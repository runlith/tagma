---
id: 01a14247-f8c5-7148-84ea-d755f311c165
title: Harness-thread operations (read_harness_screen, speak_harness, set_thread_transport) do not address another project's thread and answer with an undeclared foreign-project
ord: 179
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14248-1477-789d-9fb9-12d7da134b85",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b3-84d8-7b0e-a605-99311013e071
---
A runlith thread called `read_harness_screen threadId=01a14246-a097-70c6-93b6-5d42ff6b0f06` — a harness thread of project `polygon` (33), born by it via `spawn_agent project: polygon`. The answer is a failure, not a refusal: "an owner raised the refusal foreign-project, which its operation does not declare (not-found, not-a-harness-thread, screen-unavailable)". There is no passing `project`: the operation schema does not know it (`body-shape`).

Thread reads (`read_thread`, `read_thread_record`, `archive_thread`) take `project` and name `foreign-project` with the "pass that project here" way out. Harness-thread operations must address a thread the same way: `project` in the input, another project's thread reads by it, and without it — a declared `foreign-project` refusal with the same way out. Check every operation with a harness thread's `threadId` for the same hole.

Done when: `read_harness_screen`/`speak_harness`/`set_thread_transport` with `project` work on another project's harness thread; without `project` — a declared `foreign-project`, not a failure; a contract test on the owner's layer.
