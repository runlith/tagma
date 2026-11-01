---
id: 01a14c05-71a7-71c8-88a1-ee49a186ad90
title: A developer builds the installed Tagma from HEAD or the working tree and checks it separately
ord: 61
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee460a9ce615
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4cea7d76f8
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/cli.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/runner.ts
  - kind: file
    ref: apps/tagma/server/src/composition/developer/bindings.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/build.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cut/try.ts
---
**Value.** A developer checks fresh Tagma code as an installed program, apart from the working source tree.

**How.** In a developer build — the installation chip, `tagma build --head` or `--tree`, `tagma update` with the same choice, `install_next` and `stop_installing`; the direct build entry is `bun run tagma:build`. Its own check server is started by `bun run tagma:try`.

**Behaviour.** HEAD builds in a separate temporary worktree with lockfile dependencies. A direct `bun run tagma:build` includes uncommitted lines only when the change record proves they all belong to its calling session, or to the operator for an unsigned shell invocation. Another holder, nobody's lines or unproven attribution refuses before installation files are written, naming the affected paths and holders. The check runs again before selecting the installation. `.tagma` storage does not count. Without readable attribution, any other dirty path refuses; commit the changes or use `bun run tagma:build --tree` to deliberately include the whole working tree. `tagma build --tree` and `tagma update --tree` carry that deliberate choice. Building selects a ready installation; update also asks for a restart. Direct builds retain their restart default and `--no-restart` choice. Outcome and output stay with the server, and replacing an already running build refers to exactly the attempt the caller saw. A trial server has its own data and address and does not stand in for the working one. Its launcher retains those bindings after a rebuild, while checkout builds use the launching developer's home for toolchains and signing rather than the trial server's isolated home.

**Limits.** A plain release does not connect a source from a checkout. With no source checkout there is nothing to build. Stopping after a ready installation is selected does not cancel the made choice; after a restart request the installation can no longer be stopped. A build without restart does not change the working server.
