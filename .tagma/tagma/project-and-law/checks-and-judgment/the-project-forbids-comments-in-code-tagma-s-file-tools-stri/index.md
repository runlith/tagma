---
id: 01a14c14-a11c-7ce8-9d84-633db6de3aa7
title: "The project forbids comments in code: Tagma's file tools strip added prose, explanations go to the graph"
ord: 10
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633e55d13f13
sources:
  - kind: dir
    ref: packages/source-comments
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/WritingSection.svelte
  - kind: symbol
    ref: apps/tagma/server/src/graph/settings.ts
    symbol: commentPolicy
  - kind: symbol
    ref: packages/agent-tools/src/prose.ts
    symbol: withoutAddedProse
---
**Value.** Code doesn't overgrow with prose that goes stale: everything wider than a one-line "why" is recorded in the graph, where it's found by code.

**How.** The `writing.comments` setting — Allowed or Forbidden, for the user or the project, Settings → Writing.

**Behaviour.**
- Under Forbidden, Tagma's file tools — `write`, `edit`, and file import of the native agent and of a CLI on ACP — delete prose comments from lines this edit wrote, and name the stripped lines; standing comments are untouched.
- A `!`-opened comment and tool pragmas stay; a file that doesn't parse is written as-is with a mark.
- The law states the policy in words — to native agents in instructions, to foreign CLIs in the AGENTS.md section.
- The `strip_comments` tool appears for the agent only where comments are forbidden.

**Limits.** The setting description and the law promise a landing door will drop the comment, but only Tagma's file tools strip it: terminal CLIs' writes with their own tools, shell commands, and the operator's editor edits keep comments, and `submit_work` doesn't check them.
