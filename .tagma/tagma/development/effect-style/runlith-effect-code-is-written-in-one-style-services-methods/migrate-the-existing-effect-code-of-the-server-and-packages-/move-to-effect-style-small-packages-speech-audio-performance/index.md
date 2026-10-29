---
id: 01a13d2f-3989-7140-b4b7-a20c407453a6
title: "Move to Effect style: small packages (speech, audio, performance, llm, credential-file, git and others)"
ord: 26
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: dir
    ref: packages/llm
  - kind: dir
    ref: packages/performance
  - kind: dir
    ref: packages/speech
---
Finish migrating the production code and tests of all remaining `packages/` to the `effect4` skill shape, except `agent`, `execution-host`, `executions`, `chat-ui` and `effect-test`, assigned to other runners. A changed API and its real consumers migrate together. Commits go per package or small group; proof is zero effect-style in the assigned area, narrow types and owner tests green, spans preserved; one independent Sol reviewer checks all the assigned work. Heavy measuring benchmarks and paid vendor captures are not part of this migration's proof. The code and linked consumers were delivered in af163c65fb; the single review's seven findings fixed. One bun-install-written audio-darwin/effect-test devDependency line remains in bun.lock: submit_work refused lines-held because the same file holds 44 lines of a live neighbouring holder. Whole/taking takes its unfinished delivery and is out of this work; there are no more held paths of our own.
