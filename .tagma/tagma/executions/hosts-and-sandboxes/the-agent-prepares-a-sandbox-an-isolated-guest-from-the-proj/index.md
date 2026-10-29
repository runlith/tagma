---
id: 01a14c14-6895-75c6-80f2-47c6411e9f4e
title: The agent prepares a sandbox — an isolated guest from the project's commit with no network, machine files, or graph — and starts a thread in it
ord: 6
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9277306eedae
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c7b28f1d15
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47c8fe4b72a5
sources:
  - kind: file
    ref: apps/tagma/server/src/sandbox/cli/sandbox.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/doctrine/theSandboxTree.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/engine/docker/image.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/guests/environment.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/guests/lease.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/maintenance.ts
  - kind: symbol
    ref: apps/tagma/server/src/sandbox/contract/wire/operations/guest.ts
    symbol: GUEST_OPERATIONS
---
**Value.** Work that cannot be trusted with files, network, or the machine graph — third-party code, a risky experiment — the agent hands to a thread in an isolated guest and then takes back only the files it needs.

**How.** `prepare_sandbox`, `read_sandbox`, `release_sandbox` (the sandbox capability); the host binding received is passed when birthing a child or a new thread; CLI `tagma sandbox list` and `tagma sandbox run`.

**Behaviour.**
- The guest is a Docker container with the tree of one commit (HEAD by default), an empty tree, or a copy of a prepared tree; the graph directory is excluded by default. Preparation commands run inside, and any failure fails the preparation; process, memory, and CPU ceilings are set.
- Inside: a snapshot of files without `.git`, an unprivileged user, a read-only root, and no network. The thread gets a section of instructions about the isolated tree.
- A thread in the guest reads and edits files and runs commands, but a command lives only its call; the guest serves no held executions.
- The sandbox is held by one thread, born without the parent's history, of the same owner and project. Release refuses while the thread lives; deleting the thread sends the sandbox to release: the tree is exported to the machine, the guest and its storage are removed, and the export path stays in the record.
- At startup the server marks half-prepared sandboxes as failed, periodically completes started releases, and reconciles records with what actually stands in Docker, removing what vanished and what the records do not know.

**Limits.** Docker is needed on the server machine. By code the guest image builds by default from files next to the server sources; in an installed release they are absent, and the refusal directly offers a prepared tree on a compatible named image or a build from the checkout, while `prepare_sandbox` has no image parameter of its own. Sandboxes have no screen in the window: the operator sees them via the CLI and agents.
