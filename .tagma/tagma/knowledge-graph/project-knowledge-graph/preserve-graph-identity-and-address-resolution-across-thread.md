---
id: 01a1941f-f2bb-77f3-9717-654dea161cff
title: Preserve graph identity and address resolution across thread copies
ord: 262
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-876ef883c647",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0e8af-1e11-745f-825a-639a45ed43fe
  - kind: relates
    to: 01a12c8b-92e6-7ee7-9b2b-f9ef3751ed77
  - kind: relates
    to: 01a12cad-06a8-7ae6-89b4-136c2477ffa3
---
Reproduce the parent→child→grandchild graph read of [[45ed43fe|the grandchild read refusal]] with its home, worktree and graph copy, and investigate the identity loss of [[2477ffa3|the mirror-repair deletion]] at its producer. No new recovery feature, no manual `.tagma` restore.

**Grandchild read (45ed43fe).** The original record: wave-power (thread 01a0e816-42ad-7160-9b82-7a68c689e4cd) and its child m2-a (01a0e87e-5f92-7f94-bb92-194e203676c1) both stood in the `restructure` worktree (m2-a's `pwd` at record 52). m2-a never called the native `read_block`, though `tool_search` told it the tool was offered directly (records 10, 34). It called `lode op read_block` and `lode op search_blocks` from bash in that worktree (records 95–121, 458–539): the CLI answered `not-found` for 08edfbc5 and later aa1b0681 — blocks that were stealth then — while it found the older f7e0b9dd. The parent read the same names with the native door. The source of that time is gone (history squashed on 2026-10-26, `~/.lode` removed, tool outputs not retained), so why the two doors read different copies then is not established; the record fits a worktree twin born before those blocks were written in main.

Current code, through the real doors in an isolated door world: a stealth project, a worktree whose twin was born by a worktree write, a block written in main after that, the root thread moved into the worktree, a child and a grandchild started with `spawn_agent` by grant. Both generations stand in the worktree; native `read_block` and HTTP `read_block` with the thread's grant and cwd answer the same; the main-only block reads from the worktree copy and the worktree-only block from main, by cross-copy name resolution ([[c7c0b002]]). No current defect; the probe was not kept as a test.

**Repair deletion (2477ffa3).** The producer — `repairMirror` deleting the displaced row with `removeBlock` — was fixed by [[70f08c53]]: repair and rebuild move a gone or displaced block to trash with a journalled `delete` batch that `restore_block` brings back under its id, and two files with one id refuse `duplicate-identity` ([[62d9a6f4]], `graph/tree/repairMatrix.itest.ts`, green at 2ea5191285; `mirror.ts` unchanged since). The only remaining hard delete, `purgeUnjournaled`, takes trashed rows with no journal event, which repair never leaves. Both lost identities, 55b5437b and 97fdddaf4476 (`ddaf4476`), stand in the graph at 09dee3c4f. Re-birth from a git revision under the original id, as the reflection asks, is a new operation and the operator's decision.
