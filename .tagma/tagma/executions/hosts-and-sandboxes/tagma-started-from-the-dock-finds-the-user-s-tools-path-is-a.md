---
id: 01a14c14-6895-75c6-80f2-47c5bf46debd
title: "Tagma, started from the Dock, finds the user's tools: PATH is assembled from the login shell profile, version managers, and Homebrew"
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4aba458262
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c0788868e6
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/userEnvironment.ts
  - kind: file
    ref: apps/tagma/server/src/mac-user-environment/shell.ts
---
**Value.** Agents' commands and terminals find `node`, `bun`, `brew`, and other user tools, although an app opened from Finder or Dock gets only the system PATH from macOS.

**How.** On its own, at server startup on macOS.

**Behaviour.**
- If the server started with a bare system PATH, it reads PATH from the user's interactive login shell and folds it together with version-manager directories (nvm by its default, Volta, asdf, fnm, mise, bun), the source PATH, and the usual places (Homebrew, /usr/local, Nix, pnpm, yarn, ~/.local/bin).
- While the profile reads, PATH is already assembled from the rest; the read profile stands first.
- The read also parses the profile's whole environment, kept only in memory. Adapters register the variable names they need (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) with `retain`, and mise's `__MISE_DIFF` is retained by the owner; only retained names are answered, spelled exactly as the profile gives them, and a name the profile does not set is absent. Other variables are never logged, stored or handed over.
- The successor server receives the read profile and the retained variables from the predecessor and does not read it again.
- Program lookup also peers into every installed node version from nvm.

**Limits.** macOS only. A profile that did not answer in time, failed, or gave no paths is skipped, and this is written to the log. After a forced stop the reading finishes when the profile process group is gone. Starting from a terminal with a full PATH changes nothing.
