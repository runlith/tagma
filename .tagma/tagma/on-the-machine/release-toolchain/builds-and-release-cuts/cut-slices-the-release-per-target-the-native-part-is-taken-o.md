---
id: 01a175fa-0796-7d73-bb31-52776a1d5919
title: "\"Cut slices the release per target: the native part is taken or built for it and lands in that target's place\""
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a175e1-b116-7055-8be6-30f9fb401399
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/locked.ts
  - kind: file
    ref: apps/tagma/server/src/cut/runtime.ts
  - kind: file
    ref: apps/tagma/server/src/cut/target.ts
  - kind: symbol
    ref: apps/tagma/server/src/cut/packages.ts
    symbol: nativeCarried
---
One release is cut from one commit for `darwin-arm64` and `darwin-x64` on an Apple silicon Mac. The target is part of `ReleaseCut`, and release hands it to every native-part producer. A checkout build (Tagma Dev, beside, try) gets no target: it builds for the machine out of `node_modules`, as before.

- **Every target writes to its own place.** SQLite goes to `build/targets/darwin-<arch>`, the tracking engine and the execution holder to cargo's `target/<triple>`, Whisper to its own cache, the sound helper to `bin/darwin-<arch>`, Electron to the distribution unpacked next to the cut's app. Two targets never wipe each other or the checkout build the developer's running server uses. So the arm64 target is rebuilt once, even though it matches the machine.
- **The release's bun** is the official `bun-darwin-<aarch64|x64>` at the `packageManager` version. The zip from Oven's release is checked against `SHASUMS256.txt` and lands in `cut-cache/runtimes` together with the binary's sha256, which is verified on every cache take. The build machine's bun only builds, so it must be the same version, not the same binary. x64 is not taken as baseline: every Intel Mac that macOS 13 installs on knows AVX2.
- **Platform npm packages** — sharp and libvips, the oxc-parser binding, Cursor SDK, opencode, ripgrep, TS 7 — are taken at the exact version their `node_modules` parent declares in `optionalDependencies`, and at that version's integrity in `bun.lock`. The registry tarball is checked against the integrity and unpacked into `cut-cache/packages/proven-1`, beside the tarball itself; every take reads that stored tarball (checked against the `bun.lock` integrity again), derives the expected files, links and executable bits from its tar stream and refuses an entry whose files, links or entries differ, naming it — it is never used or silently replaced. Entries of the earlier unproven layout stand outside `proven-1` and are ignored: `node_modules` holds only the machine's platform. Which packages a cut carries beside the bundle, and which of their platform packages it takes, every workspace package the server depends on declares in its `package.json` under `tagma.carried`, so a builtin package dropped from the server's dependencies leaves nothing to carry. A binary a vendor's install script lays from its platform package (OpenCode's `bin/opencode.exe`) is laid by the cut from the target's platform package, because the install script ran only for the build machine. Electron is the `darwin-<arch>` distribution at the workspace version through `@electron/get`, checked against the `electron` package's `checksums.json`.
- **The cut's checks are run by the target's bun:** native module loading, the tools' `--version`, and a trial launch. macOS itself runs x64 Mach-O under Rosetta, so x64 is checked under Rosetta on the build machine; that proves neither Intel-processor operation nor its speed.
- **The `cut-cache` cache is shared by all cuts on the machine**, so writing into it is only a rename of a ready directory: published entries are never deleted, and the race loser takes the winner's directory when it is whole (bun — by the binary's sha256, a package — by its stored tarball's `bun.lock` integrity and a tree equal to that tarball's).
- **Whatever the machine lacks, the cut refuses before building** and names the command: no target in rustup — `rustup target add <triple>`, no Rosetta — `softwareupdate --install-rosetta`.
