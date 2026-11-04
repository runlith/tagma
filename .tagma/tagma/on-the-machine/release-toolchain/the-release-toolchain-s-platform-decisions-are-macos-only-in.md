---
id: 01a1a76d-60cf-76c9-950a-c692ccd28d77
title: The release toolchain's platform decisions are macOS-only inside a generically named module
ord: 8
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
    ref: apps/tagma/server/src/cut/dmg.ts
  - kind: file
    ref: apps/tagma/server/src/cut/engine.ts
  - kind: file
    ref: apps/tagma/server/src/cut/notarize.ts
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/cut/signing.ts
  - kind: file
    ref: apps/tagma/server/src/cut/target.ts
  - kind: file
    ref: apps/tagma/server/src/cut/transition.ts
  - kind: file
    ref: apps/tagma/server/src/cut/world.ts
---
The cut decides what it may build by `process.platform` and a `Target` type that admits only darwin, and the signing, notarization and disk-image steps call Apple tools. The module is not named or contracted as a macOS adapter, so a second release target would edit it.

Read at ee24295b8e:
- `cut/target.ts:5,10-11` `Target.os` is the literal `darwin`; `:17` `rustTriple` is Apple only; `:19` `machineTarget` is non-null only on darwin; `:27` the refusal text names macOS and Intel.
- `cut/release.ts:271` the platform from `process.platform`; `:310` refuses any `os` but darwin.
- `cut/transition.ts:219` refuses when no darwin target exists.
- `cut/engine.ts:34` the Whisper engine is built only on darwin.

Unclear:
- `cut/signing.ts:27-29` `/usr/bin/security`, `/usr/bin/codesign`; `cut/world.ts:29-30` `codesign` and `lsregister`; `cut/notarize.ts:81` and `cut/dmg.ts:44` `ditto` and `xattr`; `cut/sealing.ts:4`, `cut/dmg.ts:5`, `cut/notarize.ts:4` import `@runlith/codesign`. The pipeline is macOS by nature and `@runlith/codesign` is a macOS adapter, but the steps stand in a module with no macOS in its name or contract; whether the module is the macOS adapter or needs a release-target contract is the owner's call.

Done when the cut declares a release-target contract (platform, archive, signing, notarization), the Apple steps are one macOS adapter behind it, and the cut's OS-independent parts pass on a Linux runner.