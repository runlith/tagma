---
id: 01a14c14-a11c-7ce8-9d84-632a7054398a
title: Tagma installs into a repository with one command and updates everywhere it already stands
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9292bfecd8d9
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632bd215090b
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/setupSteps.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/law.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/setup.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/skillInstall.ts
    symbol: installInto
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
    symbol: declaredForLaunch
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
    symbol: refreshedFor
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
    symbol: refreshInstallations
---
**Value.** Foreign CLIs in a repository know Tagma's law at once and can reach it: law, skill, hooks, and the MCP server install in one step, and after a new Tagma release all places update themselves at its first start or with one command.

**How.** `tagma install` inside a git repository; `tagma upgrade` — across all registered projects; a server start on a new build and a CLI launch from Tagma.

**Behaviour.**
- Install lays the managed law section into AGENTS.md: creates the file, replaces the section between markers, or appends it at the end. Into CLAUDE.md — only if the file exists and doesn't import AGENTS.md.
- The skill lands in `.agents/skills/tagma` with a link from `.claude`, beside it the hooks of every supported CLI and MCP server declarations.
- A broken law section (one marker without the other) refuses installation.
- A private project receives skill and hooks at user level; the repository is untouched.
- Upgrade refreshes every place in its own form; a place where Tagma never stood is named and skipped. One place's failure doesn't stop the rest and yields a nonzero exit code.
- A server started on a build it hasn't yet refreshed installations for does what upgrade does, for checkouts itself (the server rewrites user level at every start anyway): in the background, without delaying startup, once per build (the installation digest, for a server from a checkout — its HEAD). On the same build, startup reads and writes nothing.
- A CLI launch from Tagma whose MCP declaration lies in the project (for Claude Code — `.mcp.json`) brings it to the current form before the process starts, keeping the signature key — where Tagma stands by upgrade's decision. This repairs a project registered or cloned after an update.
- A server whose HOME isn't the account's home directory (a trial `tagma:try`) doesn't write into checkouts itself: its entry point isn't the one this account's CLIs call.

**Limits.** Install and upgrade exist only in the CLI — neither in the window nor among operations. Upgrade creates nothing anew. A settings change the law section depends on doesn't rewrite AGENTS.md on its own.
