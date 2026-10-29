---
id: 01a14c05-71a7-71c8-88a1-ee500e5b49b2
title: The user puts the Tagma command first in their shell's PATH
ord: 23
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee45adeff637
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/command.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/launcher.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/cli.ts
---
**Value.** The Tagma command is found in a new terminal and leads to the selected installation, not to a random checkout or an old file.

**How.** An Install command in the installation chip, `place_command`, `tagma release path`.

**Behaviour.** The launcher uses the selected installation and its runtime; the explicit action prepends its directory to the used shell's profile and reports that a previous command was shadowed. A repeat does not add another such line. A release installation creates the launcher separately, without changing the profile on its own.

**Limits.** An already open shell does not get the new PATH automatically. An unavailable profile may leave the launcher created but unreachable by name — the result directly offers to add the path by hand. Connecting Tagma to a repository and installing hooks is a different capability, not `release path`.
