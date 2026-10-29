---
id: 01a0c702-a15a-7740-ab79-497190d97bc9
title: Ripgrep
ord: 20
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/index.ts",
        "for": [
          "5565be05",
          "13182a9f",
          "9f0b5fe1",
          "411a495f"
        ]
      },
      {
        "at": "src/run.ts",
        "for": [
          "5565be05",
          "9f0b5fe1",
          "411a495f",
          "90491249"
        ]
      }
    ],
    "id": "@runlith/ripgrep",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/ripgrep
---
The agent's glob and grep tools and the file manager's file search run ripgrep, and the package owns everything needed for that except choosing the place: the binary path (an explicitly passed path, then `RUNLITH_RIPGREP_PATH`, else the `@vscode/ripgrep` dependency's binary), an environment with no variable pointing ripgrep at a config file, and the launch — a `Match | FileDone | Summary` event stream from `--json` and `Listed | Summary` from `--files`, a time ceiling, signal cancellation, and process completion down the stop ladder. Failures are typed in ripgrep's words (`SearchFailed`, `SearchLapsed`, `SearchAborted`); the process is spawned by `ChildProcessSpawner` from the caller's context. Whether ripgrep is needed at all, which binary and which ceiling, what a missing binary means, and how to show a failure are the callers' call.
