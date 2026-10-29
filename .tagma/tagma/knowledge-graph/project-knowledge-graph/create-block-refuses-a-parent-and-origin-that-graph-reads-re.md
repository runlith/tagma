---
id: 01a18515-0ded-79a8-9dd8-ba593440a852
title: create_block refuses a parent and origin that graph reads resolve
ord: 247
tags: ["reflection"]
fields:
  {
    "actual": "Refused not-found: that block does not exist; searching again resolves both blocks and the refusal does not identify which reference is absent.",
    "command": "create_block(project: 5, checkout: \"~/.tagma-dev/worktrees/tagma/feed-e2e\", parentId: \"5/00ddf0e5\", tags: [\"task\"], claim: true, edges: [{kind: \"discovered-from\", to: \"5/3787b73c\"}])",
    "expected": "Create and claim a task beneath the module that read_owners, search_blocks and read_block resolve in this checkout, linking the readable reflection."
  }
---
Filed from project `tagma`.

The first call used unqualified names and default place; a second used explicit project and checkout; a third used qualified 5/name references. read_block(project: 5, blockIds: ["00ddf0e5", "3787b73c"]) continues to return both standing blocks. The refusal's search_blocks recovery cannot distinguish the missing reference.