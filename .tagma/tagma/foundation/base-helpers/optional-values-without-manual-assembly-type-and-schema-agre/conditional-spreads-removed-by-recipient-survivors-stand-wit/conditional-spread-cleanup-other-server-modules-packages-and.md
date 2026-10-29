---
id: 01a12812-89b3-78cf-8d61-fdfaaf87e6d5
title: "Conditional spread cleanup: other server modules, packages, and checks"
ord: 8
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
---
The [[40ffd688|spec]] step-4 procedure over the rest: `apps/tagma/server/src/` modules except executions, threads, native-harness, external-harnesses, composition, graph, enforcement; the `performance`, `code-facts`, `git`, `ndjson-rpc`, `acp`, `activity`, `speech-openai`, `speech-soniox`, `credential-file`, `files`, `audio`, `paging`, `ripgrep`, `sqlite-process`, `tsconfig` packages; `checks/law` — about 330 sites. `pickDefined` and `pickPresent` are removed from `packages/utils/src/object.ts` once the last call is gone. Done when the `optional-spread` inspection over these areas finds only recorded needed sites, and typecheck and tests are green.
