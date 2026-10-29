---
id: 01a15025-4ae4-7156-8011-94aa66e1c289
title: A new Tagma build brings its project installations to what it distributes by itself, and CLI launch from Tagma verifies the project's MCP declaration
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15025-8dcd-71ee-84c9-4bc1e1ef400b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14fe9-0964-7561-900a-61f7987b9fc1
  - kind: relates
    to: 01a14617-3974-76a7-9555-cf6fa8ad0545
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/mcpDeclaration.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/installs/upgrade.ts
---
**Why.** The law, skill, hooks and `.mcp.json` Tagma installs into projects are refreshed only by `tagma install`, `tagma upgrade` and the developer's release build (`composition/cut/build.ts` → `refreshInstallations`). For a public-build user they stay stale after an app update. After the `harness:claude` → `claude-code` rename this shows at once: a committed `.mcp.json` with `mcp-serve --harness claude` gets refused, and Claude Code in such a repo loses Tagma tools. A user who never heard the word “terminal” will never run `tagma upgrade`.

**Do.**
1. **The server refreshes installations itself on a version change.** At startup the server compares the installed build's identity against the one recorded at the last refresh. If they differ, it runs in the background what `tagma upgrade` would do (`refreshInstallations` over the project registry) and records the new identity. Server startup and door answers never wait for it. Projects are walked one by one; one project's failure stops no others and is logged, like `homesIntegrated`. The identity is the installed build's digest (`installation`); for a server from an uninstalled checkout — what cut yields. An identical identity reads and writes nothing, so an ordinary startup pays nothing for the walk.
2. **CLI launch from Tagma verifies the project declaration.** The terminal (`sessions/launcher.ts`) and ACP (`protocol/launcher.ts`) call `declareInto` over the project root before starting the process, for adapters whose MCP declaration lives in the project (`mcp.file._tag === 'Project'`, `.mcp.json` for Claude Code). A current declaration answers `current` and writes nothing. This covers a project registered or cloned after the refresh. A project without Tagma (`skillStatus` = `missing`, or a private project) is untouched: `refreshInstallations` decides the same way.
3. **One door.** The “where Tagma stands, what to refresh” check already lives in `refreshInstallations`. Item 2 uses the same check for one project, not a second copy.

**Proof.**
- Through the public road: a project with Tagma installed and a stale `.mcp.json` (`--harness claude`), a server start with a different build identity → the file rewritten, the signature key kept. A repeat start with the same identity writes nothing.
- CLI launch in a project with a stale declaration rewrites it before the process starts.
- Typecheck and tests of affected owners.
