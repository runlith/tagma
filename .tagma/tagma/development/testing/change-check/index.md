---
id: 01a16bf0-c986-7cdf-aa48-6dda48c1dabd
title: Change check
ord: 4
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "testing/",
        "role": "testing"
      }
    ],
    "id": "@runlith/change-check",
    "kind": "surface"
  }
edges:
  - kind: imports
    to: 01a0d564-ec47-7645-8756-ec405e1647fa
  - kind: imports
    to: 01a12c51-8120-7250-9703-61feea5c74f4
  - kind: imports
    to: 01a16b71-3a1f-7cfb-a633-2283feef9784
sources:
  - kind: dir
    ref: scripts/change
  - kind: file
    ref: scripts/package.json
  - kind: file
    ref: scripts/tsconfig.json
---
The developer command selects tests by the code they load: by runtime imports, including lazy ones, and where the import path is computed — by what that test's run recorded, or by what the package declared in `changeCheck.loads`. The default change is the lines this Tagma session holds in the checkout (change record); outside a session — the diff against the branch base; the module map and the Tagma server aren't needed for selection, so the command also works in CI. The worktree-shared cache holds an input-hash-confirmed file result, and a read discovered outside the key and the stand's isolated directories disables reuse. In Bun a passed file can be reused even when a neighboring file failed: the stand confirms completion together with tests and hooks, and a shared run failure stays a failure. A fully skipped Bun file doesn't fail the command: it shows the reason separately from run files, doesn't count it as a confirmed pass and doesn't reuse its result. Selection, hashing and each file's witness check are its own; it takes chunking, side-by-side runs on the machine budget, guards, environment isolation and run cost from the testbed — it has no process counts or deadlines of its own — and import facts from code-facts. The shared test:all uses the same workspace-package enumeration, runs their test and test:integration together with preparatory steps, and keeps a report by suites. Each suite's output appends to its .log as the run goes: stopping the command keeps the output already produced, even if a suite never finished.
