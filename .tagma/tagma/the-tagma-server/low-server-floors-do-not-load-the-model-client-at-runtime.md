---
id: 01a0d863-425b-7aac-b5c1-7ca10d2c66a9
title: Low server floors do not load the model client at runtime
ord: 43
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [
        {
          "commit": "7e7ef397b7eebaeff5d2856b4ef8fb709c769a12",
          "fingerprint": "workspace/testing/rowsFixture.ts -> @runlith/agent",
          "fix": "In `apps/tagma/server/src/threads/threads.ts`, load `@runlith/agent/protocol` or `@runlith/agent/paging` or `@runlith/agent/ToolPage` or `@runlith/agent/ToolOutputSpool` or `@runlith/agent/tool` or `@runlith/agent/permissions` or `@runlith/agent/contracts` or `@runlith/agent/callProgress` or `@runlith/agent/transcript/entries` or `@runlith/agent/thread/cache/ThreadCacheWarmth` or `@runlith/agent/thread/persisted` or `@runlith/agent/thread/storage/settlement` or `@runlith/agent/collaboration/label` or `@runlith/agent/collaboration/CollaborationConfig` instead of `@runlith/agent/modes/ApprovalModes`, or cut the chain at its first hop `../../composition/testing/migrations.js`.",
          "line": 1,
          "path": "apps/tagma/server/src/workspace/testing/rowsFixture.ts",
          "said": "loads `@runlith/agent/modes/ApprovalModes` · via apps/tagma/server/src/composition/testing/migrations.ts → apps/tagma/server/src/composition/core.ts → apps/tagma/server/src/threads/threads.ts → @runlith/agent/modes/ApprovalModes"
        },
        {
          "commit": "7e7ef397b7eebaeff5d2856b4ef8fb709c769a12",
          "fingerprint": "workspace/testing/rowsFixture.ts -> @runlith/agent-tools",
          "fix": "In `apps/tagma/server/src/native-harness/contract/wire/settings.ts`, load `@runlith/agent-tools/world` or `@runlith/agent-tools/WorkspaceChanges` instead of `@runlith/agent-tools/workspace`, or cut the chain at its first hop `../../composition/testing/migrations.js`.",
          "line": 1,
          "path": "apps/tagma/server/src/workspace/testing/rowsFixture.ts",
          "said": "loads `@runlith/agent-tools/workspace` · via apps/tagma/server/src/composition/testing/migrations.ts → apps/tagma/server/src/composition/core.ts → apps/tagma/server/src/native-harness/native-harness.ts → apps/tagma/server/src/native-harness/contract/wire/settingDeclarations.ts → apps/tagma/server/src/native-harness/contract/wire/settings.ts → @runlith/agent-tools/workspace"
        },
        {
          "commit": "7e7ef397b7eebaeff5d2856b4ef8fb709c769a12",
          "fingerprint": "workspace/testing/rowsFixture.ts -> @runlith/agent/collaboration",
          "fix": "In `apps/tagma/server/src/native-harness/turns/delegationRule.ts`, load `@runlith/agent/collaboration/label` or `@runlith/agent/collaboration/CollaborationConfig` instead of `@runlith/agent/collaboration/CollaborationVoice`, or cut the chain at its first hop `../../composition/testing/migrations.js`.",
          "line": 1,
          "path": "apps/tagma/server/src/workspace/testing/rowsFixture.ts",
          "said": "loads `@runlith/agent/collaboration/CollaborationVoice` · via apps/tagma/server/src/composition/testing/migrations.ts → apps/tagma/server/src/composition/core.ts → apps/tagma/server/src/native-harness/native-harness.ts → apps/tagma/server/src/native-harness/turns/delegationRule.ts → @runlith/agent/collaboration/CollaborationVoice"
        },
        {
          "commit": "7e7ef397b7eebaeff5d2856b4ef8fb709c769a12",
          "fingerprint": "workspace/testing/rowsFixture.ts -> @runlith/mcp",
          "fix": "In `apps/tagma/server/src/mcp/contract/wire/servers.ts`, load `@runlith/mcp/declaration` instead of `@runlith/mcp/grant`, or cut the chain at its first hop `../../composition/testing/migrations.js`.",
          "line": 1,
          "path": "apps/tagma/server/src/workspace/testing/rowsFixture.ts",
          "said": "loads `@runlith/mcp/grant` · via apps/tagma/server/src/composition/testing/migrations.ts → apps/tagma/server/src/composition/core.ts → apps/tagma/server/src/mcp/mcp.ts → apps/tagma/server/src/mcp/contract/wire/feeds.ts → apps/tagma/server/src/mcp/contract/wire/servers.ts → @runlith/mcp/grant"
        }
      ],
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
