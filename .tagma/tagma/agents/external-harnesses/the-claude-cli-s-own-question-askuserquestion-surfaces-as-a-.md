---
id: 01a1473e-4691-79cc-9996-b491fe4f0d1a
title: "The Claude CLI's own question (AskUserQuestion) surfaces as a question to the parent and is answered in the TUI: an option, own words, or multiple marks"
ord: 75
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1471b-cac7-7c39-9177-f1b525cd4ada",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1471b-345d-7530-9b68-c6c71f4ed21a
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/harness/screen.ts
---
A Claude Code child on the terminal transport opened the AskUserQuestion menu, and the parent received nothing: the Claude screen reader did not recognize that widget. The work — recognize the question (single and multiple choice, tabs, verification screen), raise it as a question to the parent with option descriptions, own words and multiple values, and type the answer with keys the way a user would. Proof — reader tests on captured Claude Code 2.1.302 screens and an `answer_approval` reply on notification. What was measured in the TUI is [[c4f1800d]].
