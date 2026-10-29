---
id: 01a17ae4-e99c-7a84-8f27-dfb955b6930a
title: check:change in a shared checkout verifies every agent's uncommitted edits, not the change of whoever ran it
ord: 54
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ba9-8778-73dc-b0e7-ff35b2598e85",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a16ac4-44bf-7e0a-8178-b70405af9265
---
On 2026-10-27 three agents in a row ran `bun run check:change` for edits of 2–5 files. Each time the command selected 648 server integration files plus 179 app files: the shared checkout held uncommitted edits from a dozen other agents. All three runs were killed by the command life rule at 10 minutes, and no change was verified for anyone. A manual way out already exists: `--paths-from <file>` takes paths from a file, and the `tests` skill now names it. But without a selector the command verifies the whole dirty checkout by default. The change an agent verifies is its own lines: the change record knows them by session. Decide how `check:change` receives that change — paths from the caller or the session's holdings — and how that meets the actually-loaded-code selection from [[05af9265]]. Goal: change verification in about a minute on any size of machine.

A second width cause shows even with `--paths-from`: editing `speech/world.ts` and five test files produced a `cards: 951, imports: 14, runtime: 140` plan. Nearly all of it came from the "module-card reach covers a nonliteral import" rule — an indirect import in a module pulls in every file the module card touches. Selection by code the test actually loads ([[05af9265]]) should replace it.
