---
id: 01a17389-01ba-757b-a971-4c06c6481519
title: "A bash call description stands in the feed without the tool verb: the agent writes it as a ready action phrase"
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/agent-tools/src/bash/answers.ts
    symbol: commandTitle
  - kind: symbol
    ref: packages/chat-ui/src/activity.ts
    symbol: chatToolActivityLine
---
Models write `description` as an imperative phrase ("Run the tests", "Find migration files"), so `Ran` before it gave two predicates in a row: `Ran Run the tests`. The bash owner marks such a title `alone`, and the feed puts it in the line without the tool words. Without a description the title is the command head — not a phrase — and `Ran`/`Running` before it stay. A verb the answer declared itself (`Left running`, `Moved to the background`) still leads the line: it names a state the description lacks. Display head copies (a partial projection during streaming, an answer head without its own display) carry `alone` with the `title`, otherwise the line regains a verb at one of the call's stages.
