---
id: 01a1447a-d5c9-726c-8b02-3941e75b3793
title: "A parent cannot answer its harness child's question: the question never reaches it, and there is no choice-answer operation"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141bd-4d86-7052-9111-958c8dc139ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14279-4e36-79fc-9c92-411f051da475
  - kind: implements
    to: 01a141bd-0e7f-7dc8-8ef7-ab6a510a47c0
---
The plain thread `01a14479-bc79-7b53-8290-e1fc3677632b` (polygon), born of the runlith thread `01a125fe-…` through `spawn_agent project: polygon`, raised the on-screen question `harness-screen:8f077dd2-0ed0-4070-97a6-2072ab73c74c` (choice: "No, exit" / "Yes, I trust this folder", `route: terminal`). The operator sees it in the UI as buttons. The parent:
- received it in neither an envelope nor a notification;
- has no operation answering a child's choice question: `answer_approval` is allow/deny for approval questions only, takes no `project`, and answers `unknown-question`.

The agent that starts and leads a harness thread (the polygon experiments) must answer its CLI's questions itself. Needed: a child's question the parent may answer reaches the parent (like an approval question — an envelope with an id), and there is a choice-answer operation (a variant by value) addressing another project's thread through `project`. Who may answer follows the same policy as approvals (the operator always; a parent for its own children).

Done when: the parent receives the plain child's trust question, answers "Yes" through the operation, the answer leaves as keys, the turn runs to the report; a test on the owner's layer.
