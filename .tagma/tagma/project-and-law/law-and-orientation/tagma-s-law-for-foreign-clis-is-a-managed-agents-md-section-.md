---
id: 01a14c14-a11c-7ce8-9d84-632bd215090b
title: Tagma's law for foreign CLIs is a managed AGENTS.md section assembled for the project's settings
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694ce885261c
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-633db6de3aa7
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/cli/law.ts
  - kind: file
    ref: apps/tagma/server/src/threads/doctrine/render.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/orientation/law.ts
    symbol: lawReads
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
    symbol: stripManagedLaw
---
**Value.** Claude Code, Codex, and other CLIs reading AGENTS.md get the same working rules for Tagma as native agents — adjusted for how this project is set up.

**How.** `tagma law` prints the section, `tagma law --write <path>` writes it to a file; the `read_law` operation; `tagma install` and `tagma upgrade` write it into AGENTS.md.

**Behaviour.**
- The section assembles from Tagma law sections and depends on project settings: shared or single checkout, whether agents commit their own work, comment policy, whether the dictionary declares a graph over code, strict provenance.
- The section stands between markers and is replaced whole; text outside the markers is untouched.
- Native agents receive the same law from their instructions and cut the managed section out of instruction files they read, so as not to read it twice.

**Limits.** The project's rules (`#rule`) aren't in the section: they reach agents via thread start and code touch. The file doesn't update itself when settings change.
