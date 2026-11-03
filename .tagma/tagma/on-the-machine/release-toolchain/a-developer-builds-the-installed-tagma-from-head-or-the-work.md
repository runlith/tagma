---
id: 01a14c05-71a7-71c8-88a1-ee49a186ad90
title: A developer builds the installed Tagma from HEAD or the working tree and checks it separately
ord: 3
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
    ref: apps/tagma/server/src/cut/build.ts
  - kind: file
    ref: apps/tagma/server/src/cut/try.ts
---
**Value.** A developer checks fresh Tagma code as an installed program, apart from the working source tree.

**How.** In a developer build — the installation chip, `tagma build --head` or `--tree`, `tagma update` with the same choice, `install_next` and `stop_installing`; the direct build entry is `bun run tagma:build`. Its own check server is started by `bun run tagma:try`.

**Behaviour.** A direct `bun run tagma:build` captures committed HEAD, opens a disposable detached checkout with each submodule at the commit HEAD pins — taken from the checkout's own submodule repository, so a pin nobody pushed builds and a submodule left uninitialized refuses — installs its frozen-lockfile dependencies and runs that commit's build entry there. Its sources stay on that generation even if the original checkout changes or advances. This is the default for one developer and shared agent checkouts alike: uncommitted edits, including the builder's own, and files absent from the commit are outside the build. It names the chosen commit and omitted staged, unstaged and untracked paths outside `.tagma`; holder labels from one bounded change-record page are advisory, and unread attribution is named. Commit changes to include them in HEAD, or deliberately build the working tree with `bun run tagma:build --tree`, `tagma build --tree` or `tagma update --tree`: it captures tracked and untracked unignored files plus the ignored files the distribution names, as they stand at the start, and builds that copy, so edits made during the build stay out. The direct and server-managed HEAD builds share the same source preparation. Before a HEAD or tree build, the steps the enabled apps of the checkout's project declare run in order: a step may land a commit, which is then the one built, or stop the update unbuilt with its reason and a thread to open. Building selects a ready installation; update also asks for a restart. Direct builds retain their restart default and `--no-restart` choice. Outcome and output stay with the server, and replacing an already running build refers to exactly the attempt the caller saw. A trial server has its own data and address and does not stand in for the working one. Its launcher retains those bindings after a rebuild, while checkout builds use the launching developer's home for toolchains and signing rather than the trial server's isolated home.

**Limits.** A plain release does not connect a source from a checkout. With no source checkout there is nothing to build. Stopping after a ready installation is selected does not cancel the made choice; after a restart request the installation can no longer be stopped. A build without restart does not change the working server.
