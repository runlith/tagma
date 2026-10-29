---
id: 01a15134-0b9f-7e2c-809e-ec1577445f9b
title: An unreadable ripgrep stdout JSON line drops the stream instead of skipping the line
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-4984-7146-a28a-9d93e64082da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: packages/ripgrep/src/run.ts
---
In `packages/ripgrep/src/run.ts:243–263` contentReading already skips syntactically broken JSON lines, unknown types, and entries with no path, but `null\n` throws a TypeError on `entry.data` (:251), and a match with `lines.text:42` — on `body.endsWith` (:261). Public searchContent with synthetic `null\n` stdout and exit 0 reproduced the defect; this audit attributes no such bytes to real ripgrep. The reader's existing tolerance for unreadable lines is broken: the stream never reaches its Summary; consumers `agent-tools/grep.ts:153–156` and `search.ts:11–21` do not translate the defect. Close exactly these consumed-shape check gaps at the stdout reader, keeping its current contract of skipping unreadable lines rather than introducing a new refusal for them. Fix: a partial Schema decoder accepts only the consumed stdout shape; an unreadable line stays a skip. Public searchContent in run.itest.ts keeps a normal Match after a syntactically broken line, null, a wrong lines.text, and a null submatch, then yields Summary. The file — 10 pass; the package's bun run typecheck with dependency closure passed.
