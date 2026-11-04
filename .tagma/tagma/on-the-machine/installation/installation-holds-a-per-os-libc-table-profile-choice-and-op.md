---
id: 01a1a76d-60c4-736c-9176-aa410c9f97cb
title: Installation holds a per-OS libc table, profile choice and opener command in shared code
ord: 101
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/lifetime.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/launcher.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/machine.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/server.ts
---
`installation/setup/macos.ts` fills the module's `MachinePlatform` port for macOS and is an adapter (composition binds it in `composition/release/bindings.ts`); it is fine. The shared files around it still branch.

Read at ee24295b8e:
- `process/lifetime.ts:7-10` darwin and linux libc names and close-on-exec codes; `:34` lookup by `process.platform`.
- `setup/launcher.ts:27` the bash profile is `.bash_profile` on darwin and `.bashrc` elsewhere.
- `operations/machine.ts:67` passes `process.platform` to `launcherStands`.
- `cli/server.ts:161` `OPENER` is `open` on darwin and `xdg-open` elsewhere.

Done when the lifetime pipe, the profile files and the opener come from ports the module declares, filled per OS by composition, and the module's tests pass on a Linux runner.