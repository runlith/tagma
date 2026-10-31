---
id: 01a193f6-b4ca-74f6-b5e2-c1556eaff70f
title: Place member calls on barrel-exported library namespaces
ord: 167
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75d-7c61-9922-072b8ace875a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19101-f7d4-7d4c-af5f-7bfd934642cc
  - kind: relates
    to: 01a18745-8035-7554-91b6-fa5bb14d1306
  - kind: relates
    to: 01a190e5-ae6b-761d-9a49-aac323bfdacb
---
A member call on a library namespace imported through a barrel (`import { Context } from "effect"` where the package says `export * as Context from "./Context.ts"`) could not be placed: the receiver chain's alias resolution skipped the namespace-export step, so the library's declaration file was never read and a peer's same-named member (a Proxy trap `get`) refused the landing by name. Fixed in the receiver-chain walk of `placing` in `@runlith/code-facts` (each alias step contributes its module); the red-then-green scenario and the still-refused genuine peer member are in `dependencyMembers.itest.ts`.

Investigated and left unchanged, contracts intact:
- The false refusals of the second reflection (`writes`, `run`, `session`) reproduce through `submit_work`, but their cause is the standing rule that a file landing whole is checked over its entire text, HEAD lines included (note 0c6f0a9e; `submitBindings.itest.ts`, `independentMoved`), with spellings the checker cannot place — an `any`-typed receiver, a conditional type, an imported function named like a member — linking by name. Narrowing that check to changed lines contradicts the tested contract and was reverted.
- The open-merge refusal was not reproduced on current code: the earlier investigation of it closed with a passing native merge scenario.
