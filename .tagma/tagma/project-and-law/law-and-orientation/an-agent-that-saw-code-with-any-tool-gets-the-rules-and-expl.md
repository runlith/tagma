---
id: 01a14c14-a11c-7ce8-9d84-632f2c5e9bd2
title: An agent that saw code with any tool gets the rules and explanations of that place and learns who else works on it
ord: 6
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69345496a638
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6330ccb2aa49
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adapter/claudeFormat.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/touches.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/touchRule.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/orientation.ts
    symbol: ORIENTATION_OPERATIONS
---
**Value.** Decisions recorded in the graph about a file reach the agent the moment it reads or writes that file — before it offers to break them — and it sees that a colleague already edits the same file.

**How.** By itself, after a tool call: native `read`, `edit`, `write`, `grep`, and `bash` name the shown files themselves, a foreign CLI in a thread reports them with a hook; the `touch_path` operation.

**Behaviour.**
- A read or written file brings the rules delivered by `code` whose reach covers it, explanations of its place, tag prompts of those nodes not yet received, and a row about another session reading or writing the file under its task in work. A rule delivered by `finding` never rides a touch: its text stands only in its check's results.
- A file noticed only in search output brings no rule, and an explanation as a "read the file" pointer; it does not count as a task touch.
- Every text arrives in a thread once; a native thread gets it again after compaction.
- A touch records on the tasks the session holds — that is how colleagues learn about it.
- Another project's file brings that project's law; an unreadable place graph is named in the answer.

**Limits.**
- Readings inside scripts (`python`, `node`) and paths in variables are not recognized.
- Gemini CLI reports neither files nor shell output: its thread gets no law of the place at all.
- Codex, Devin, Cursor, and Grok parse shell and search by Claude event fields; no end-to-end check exists for them ([[be69f3ea]]).
- A CLI session outside a Tagma thread gets only the orientation at session start.
