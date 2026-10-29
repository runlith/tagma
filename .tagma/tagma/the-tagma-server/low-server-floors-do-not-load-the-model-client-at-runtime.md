---
id: 01a0d863-425b-7aac-b5c1-7ca10d2c66a9
title: Low server floors do not load the model client at runtime
ord: 43
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "loads-0d2c66a9",
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
    ref: apps/tagma/server/src
---
Shipped files under `apps/tagma/server/src` in `platform/`, `projects/`, `settings/`, `thread-record/`, `workspace/`, `graph/`, `change-record/`, `power/`, `worktrees/` and `threads/doctrine/` — modules below `threads` that never load the model — load none of this at runtime, directly or through what they load:
- `@runlith/llm`, `@runlith/agent`, `@runlith/agent-tools` and `@runlith/mcp` with all their doors not permitted below;
- `@bufbuild/protobuf`, `@mixmark-io/domino`, `turndown`, `ajv`, `zod`, `sharp`, `@modelcontextprotocol/sdk`;
- the `@effect/platform-bun` and `effect/http-api` barrels, whose subpaths stay permitted.

Permitted doors: `@runlith/llm/models`, `@runlith/llm/schema`, `@runlith/agent/{protocol,page,tool,permissions,collaboration/label}`, `@runlith/agent-tools/{world,WorkspaceChanges}`, `@runlith/mcp/declaration`. A type-only import and a lazy `import()` load nothing; what is heavier loads where it is used, or lazily.
