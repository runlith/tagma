---
id: 01a1283a-5861-76bb-aef5-965cd81b1676
title: A new migration does not scan history; heavy work is declared before the update
ord: 4
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "migrations",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: .
---
The table's owner declares it in the manifest as entities or history. In a new migration catalog, any operator naming a history table is refused, except ADD COLUMN without CHECK, STORED, and verifiable NOT NULL, with NULL or a constant default, and creating or dropping a trigger. An unparsed operator refuses. A history table's foreign key carries a full index with the key columns first. Other work over history carries heavy.json with a non-empty cause and an estimate by max(rowid) of the touched tables and snapshot file volume before the predecessor's departure. A new journal-form step carries a name strictly after all already-landed steps; that step changes stored bodies when the thread is accessed.
