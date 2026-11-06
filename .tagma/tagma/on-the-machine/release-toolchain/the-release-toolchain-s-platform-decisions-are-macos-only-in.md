---
id: 01a1a76d-60cf-76c9-950a-c692ccd28d77
title: The release toolchain's platform decisions are macOS-only inside a generically named module
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a928-24ed-7a10-a589-fa733c4dcf06",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/engine.ts
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: apps/tagma/server/src/cut/target.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/dmg.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/notarize.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/signing.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/transition.ts
  - kind: file
    ref: apps/tagma/server/src/mac-release/world.ts
---
The cut decides what it may build by `process.platform` and a `Target` type that admits only darwin, and the signing, notarization and disk-image steps call Apple tools. The module is not named or contracted as a macOS adapter, so a second release target would edit it.

Read at ee24295b8e:
- `cut/target.ts:5,10-11` `Target.os` is the literal `darwin`; `:17` `rustTriple` is Apple only; `:19` `machineTarget` is non-null only on darwin; `:27` the refusal text names macOS and Intel.
- `cut/release.ts:271` the platform from `process.platform`; `:310` refuses any `os` but darwin.
- `cut/transition.ts:219` refuses when no darwin target exists.
- `cut/engine.ts:34` the Whisper engine is built only on darwin.

Unclear:
- `cut/signing.ts:27-29` `/usr/bin/security`, `/usr/bin/codesign`; `cut/world.ts:29-30` `codesign` and `lsregister`; `cut/notarize.ts:81` and `cut/dmg.ts:44` `ditto` and `xattr`; `cut/sealing.ts:4`, `cut/dmg.ts:5`, `cut/notarize.ts:4` import `@runlith/codesign`. The pipeline is macOS by nature and `@runlith/codesign` is a macOS adapter, but the steps stand in a module with no macOS in its name or contract; whether the module is the macOS adapter or needs a release-target contract is the owner's call.

Linux CI run 41895806886 at dcd1721ea confirms two shared tests are blocked by those choices: `cut/release.itest.ts:130` receives the `platform` refusal before reaching its failed producer, and `cut/target.itest.ts:31` receives no Rust-install remedy because `targetTrouble` returns the macOS-only refusal at `target.ts:27`. Built: the cut declares `ReleasePlatform` (`cut/platform.ts`), which `Distribution.platform` carries; the `mac-release` module fills it with the Apple steps (targets, Rust and Rosetta checks, Bun runtime name, keychain signing, codesign sealing, BSD tar archive, disk image, notarization, the trial world and `tagma:transition`). `cut/release.itest.ts` runs on every OS over a fixture platform; `mac-release/target.darwin.itest.ts` stays macOS. The DMG and notarization subjects run on macOS; archive content, developer-input and source-comment proof remains in an unmarked suite.

Done when the cut declares a release-target contract (platform, archive, signing, notarization), the Apple steps are one macOS adapter behind it, and the cut's OS-independent parts pass on a Linux runner.