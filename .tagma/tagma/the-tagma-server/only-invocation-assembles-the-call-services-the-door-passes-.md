---
id: 01a0edf7-b380-7879-96e5-60994657a163
title: Only `invocation` assembles the call services; the door passes it the request and provides none of them itself
ord: 68
tags: ["rule"]
fields:
  {
    "enabled": true,
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "call-services",
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
Call services are who calls, aim (project, cwd, branch), workspace place, current project and graph, served tree, and the call's own marks. `invocation` builds them in one place from the admitted call and the lifetimes their owners declare. A door — HTTP, socket, CLI, MCP, native tool — decodes its transport, calls `invocation`, and renders the result; it provides none of these tags itself. A test fixture may provide them only through a testing double at invocation.
