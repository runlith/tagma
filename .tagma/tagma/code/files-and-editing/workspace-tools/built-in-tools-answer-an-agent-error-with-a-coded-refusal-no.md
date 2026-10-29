---
id: 01a14727-e5dc-731d-8890-9440cda3e050
title: Built-in tools answer an agent error with a coded refusal, not an execution failure
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14694-b5a4-7373-a56f-b8a49336431b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a146aa-653b-7c68-b9cf-940222643a8d
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
---
Built-in tools (`grep`, `glob`, `ls`, `edit`, `write`, `delete`, `rename`, `read`, `webfetch`, `bash`) answer an agent error — a nonexistent path, a path of the wrong kind, a stale cursor, a bad argument combination, a file changed after reading — with codeless `ToolFailed`. The feed records it as an execution failure (`output-error`) and expands the line, although for `read` the same case is a `not-found` refusal. Moreover the hosted path (`thread/run/hostedRecords.ts` `callFailed`) turns even coded `ToolFailed` into a failure, so declared refusals of external harness tools are lost.

To do:
- in `packages/agent-tools` one refusal-code dictionary; every domain condition answers `ToolFailed` with a code, every tool declares codes in `refusals`; environment failures (filesystem answered with an error, PDFium, network, change record) stay codeless;
- leaving the workspace (`WorkspaceRefused`) is also a coded refusal;
- the hosted path writes coded `ToolFailed` as a refusal, as the native turn already does.

Done when: `grep`/`glob`/`ls`/`edit`/`delete`/`rename` on a nonexistent path are written `output-refused` with a `not-found` code on both paths, `agent-tools` and `agent` tests are green.
