---
id: 01a0f01d-9a06-78da-87fc-8eef6b3210c7
title: A Tagma source file holds no more than 700 lines excluding import
ord: 12
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enabled": true,
    "enforcement": {
      "debt": [
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/executions/terminal/Input.ts",
          "owner": "e239d4dc",
          "value": 1123
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/executions/terminal/Keymap.ts",
          "owner": "e239d4dc",
          "value": 791
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/executions/terminal/Output.ts",
          "owner": "e239d4dc",
          "value": 1134
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.ts",
          "owner": "e239d4dc",
          "value": 1303
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/executions/terminal/ScrollIntent.svelte.ts",
          "owner": "e239d4dc",
          "value": 702
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/executions/terminal/links.ts",
          "owner": "e239d4dc",
          "value": 1015
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/features/graph/spatial/GraphView.svelte",
          "owner": "e239d4dc",
          "value": 795
        },
        {
          "fingerprint": "F4 apps/tagma/app/src/lib/shared/terminalThemes.ts",
          "owner": "e239d4dc",
          "value": 789
        },
        {
          "fingerprint": "F4 packages/execution-host/src/ExecutionRecord.ts",
          "owner": "2ea22ce5",
          "value": 1186
        },
        {
          "fingerprint": "F4 packages/execution-host/src/store/ExecutionStore.ts",
          "owner": "2ea22ce5",
          "value": 1150
        },
        {
          "fingerprint": "F4 packages/layer/src/Graph.ts",
          "owner": "b24693d3",
          "value": 945
        },
        {
          "fingerprint": "F4 packages/performance/src/store/store.ts",
          "owner": "4b32fa34",
          "value": 999
        }
      ],
      "escaped": [
        {
          "commit": "9d9be8780f24b3283be69fc8019c3f69f5497352",
          "fingerprint": "F4 apps/tagma/app/src/lib/app/chrome/StandingChip.svelte",
          "fix": "Decide by the file's shape, never by the count: name the file's main subject and find what is foreign to it. Nothing foreign: raise `lines` of its allowance `{ path: 'apps/tagma/app/src/lib/app/chrome/StandingChip.svelte' }` to 712 in `checks.F4.allowances` of the `names` inspection in `tagma.config.ts`, its why naming that subject, and land it with the file. Foreign, with an owner and mechanical consumers: move it to that owner in this work, largest first; a small helper moved instead does not count. Foreign, needing a new owner, a spec or rewrites beyond the module, or left after a move: absorb it as debt on this area's debt task, or a new one naming the mix, and take that task right after this work.",
          "line": 1,
          "path": "apps/tagma/app/src/lib/app/chrome/StandingChip.svelte",
          "said": "F4: holds 712 lines outside its imports, over 705"
        }
      ],
      "inspection": "names",
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
Region: `apps/tagma/server/src`, `apps/tagma/app`, `apps/tagma/desktop`, `apps/tagma/inspection` and every package named by the [[083d37f1|module rule]], plus `paging` and `held`.

Counted: every line of a `.ts`, `.tsx` or `.svelte` file outside import statements — including blank lines and comments; `testing/` and `conformance/` sources count. Not counted: test files (`*.test`, `*.itest`, `*.stest`, `*.spec`, `*.bench`), generated files, `.d.ts` and `node_modules`.

A file crossing the ceiling for the first time is decided by its shape, not by the count: name the file's main subject and find what is foreign in it. Shrinking, reformatting, or extracting a piece that is not a subject of its own is forbidden.
- **Nothing foreign** — the file gets an allowance in `checks.F4.allowances` of the `names` description — the `names` key in `tagma.config.ts`, the description itself lives in `checks/builtins.ts` — with its own ceiling and a why naming that subject, and lands together with it.
- **Foreign code is extracted with no decision about shape** — it has an owner, consumers move over mechanically: extraction in the same job, starting with the largest foreign subject, into its own file with its own name, on its own layer, in its own module. A small helper instead of a large foreign subject is not an extraction.
- **Foreign code needs a new owner, a spec, or rewriting outside the module, or foreign code remains after extraction** — `enforce_rule` records debt on this area's debt task, and when there is none, on a new one naming what the file mixes. Whoever recorded it picks it up right after the current work.

A file's size in debt is not judged: growth does not refuse and is recorded in the debt measurement.
