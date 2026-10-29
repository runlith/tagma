---
id: 01a175e1-b116-7055-8be6-30f9fb401399
title: "Mac release for both architectures: cut for the stated platform, feed with per-platform archive, DMG per architecture"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/installation/cut
  - kind: dir
    ref: apps/tagma/server/src/release-channel
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/feed.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/layout.ts
---
Tagma installs on any Mac with macOS 13+ — Apple silicon and Intel. Each architecture has its own DMG. Update downloads only its own architecture's archive.

## What the user gets

- **DMG per architecture**: `Tagma-<v>-arm64.dmg` and `Tagma-<v>-x64.dmg`. A human takes his Mac's DMG.
- **Update** takes the `darwin-arm64` or `darwin-x64` archive from the feed — by machine processor, not the process one.
- **x64 install on Apple silicon** runs under Rosetta: an x64 DMG downloaded by mistake, or a Migration Assistant move from an Intel Mac. Its server gets the `darwin-arm64` archive in the next update, the app is replaced with the native one. Until then the `tagma` command refuses naming the cause, as now: the launcher sees Apple silicon by `hw.optional.arm64`.
- **arm64 DMG on Intel** never launches: macOS itself refuses it.
- **Whisper works on Intel too.** Speed on real Intel never measured.

## Decision

### Cut for the stated platform

`bun run tagma:release` cuts one release from one commit for `darwin-arm64` and `darwin-x64`. The target is a parameter cut hands to every native-part producer. A producer puts the result in its own target's directory, so different targets' builds never overwrite each other or the checkout build. Checkout builds never change: their target is the machine.

| Part | How taken for the target |
| --- | --- |
| release bun | official `bun-darwin-<aarch64\|x64>` of the `packageManager` version from the official archive, checked against `SHASUMS256.txt`. The build machine's bun only builds, its version still must equal `packageManager`. x64 is not baseline: every Intel Mac taking macOS 13 is Kaby Lake or newer and does AVX2 |
| Electron | `darwin-<arch>` dist of the workspace's version, through `@electron/get` with checksum verification |
| Platform npm packages (sharp and libvips, oxc-parser binding, Cursor SDK, opencode, ripgrep, TS 7) | packages with `os`/`cpu` fields in `bun.lock` — its versions and integrity, registry tarball, integrity check, machine cache. The target's opencode binary lands where the package `postinstall` puts it. Platform-independent packages — from `node_modules`, as now |
| Rust: execution holder with its library, tracking engine | `cargo --target <triple>`. No target in rustup — cut refuses with `rustup target add x86_64-apple-darwin` |
| SQLite | `cc -arch <arch>` |
| Whisper | `CMAKE_OSX_ARCHITECTURES=<arch>`. The server enables Whisper wherever the engine is, with no arm64 check |
| Sound helper | `swift build --arch <arch>`. Input helper and window addons already universal |

Cut checks — native module loading, tool `--version`, trial run — execute the target's bun: x64 runs under Rosetta on the build machine. No Rosetta — cut refuses with `softwareupdate --install-rosetta`.

### Feed and cut record

- In the feed record a release has `platforms: {"<os>-<arch>": {archive, sha256, size}}`. Flat `archive`, `sha256` and `size` stay the `darwin-arm64` archive: issued 0.1.x read them, and they skip the extra field (Schema ignores unknown keys by default, checked on workspace). Flat fields stay while update from 0.1.x is supported.
- The client takes its own machine platform's archive. On Mac one installation owner picks the platform by the same sign as the launcher. A release with no archive for the machine's platform is not offered, and `tagma status` names the cause.
- The cut record (`release.json`) carries every platform's archive and DMG. `publish` uploads all archives and DMGs, commits the feed last, as now.

### DMG per architecture

- Cut builds two thin `Tagma.app` — they are the update archives too — and puts each in its own DMG with the same window as now. The release layout inside the app never changes (`Contents/Resources/release`): issued 0.1.x read it when installing the update.
- Two apps and two DMGs are notarized.

Rejected:
- **Universal app for DMG** — one file for any Mac. The DMG would grow from ~315 MB to ~600 MB by estimate for a choice the Tagma audience makes itself. The operator's decision.
- **Universal release inside** — glued binaries and both package sets in one tree. The install manifest, host bundle and launcher would have to learn "several architectures", official bun would lose Oven's signature, and the install would weigh double on every machine.

### Trial run

Runs for each architecture: x64 — under Rosetta, arm64 — with transition from the standing predecessor, as now. That transition runs on the new-format `file:` feed and proves an issued 0.1.x reads it.

### Cost

Cut builds two targets, so it runs longer than the old 2–3 minutes: the first full cut of both targets with trial runs took 7 min 17 s (one measurement on M2 Max). First x64 Rust and Whisper builds — from scratch.

## What the implementer proves

- `bun run tagma:release` from a clean tree on a Mac with Apple silicon cuts the release: `tagma-<v>-darwin-arm64.tar.gz`, `tagma-<v>-darwin-x64.tar.gz`, `Tagma-<v>-arm64.dmg`, `Tagma-<v>-x64.dmg`. `file` names each thin app's every Mach-O with its architecture; only the input helper and window addons stay universal.
- The trial run passes for both architectures: x64 under Rosetta (CLI, server, execution host, `speech_status` — `present`), arm64 — with transition from the predecessor on the new-format feed.
- A `darwin-x64` client under Rosetta on Apple silicon is offered the `darwin-arm64` archive. A client whose platform has no archive in the newest release gets no offer and names the cause. Tests run through the same door as `tagma status` and `install_next`.
- Without `x86_64-apple-darwin` in rustup or without Rosetta, cut refuses with the command that fixes it.
- Whisper x64 builds, and the x64 server under Rosetta declares it available.
- `codesign --verify --deep --strict` passes on both apps and both DMGs. Notarization sends two apps and two DMGs — itest with a fake `notarytool`. Real submission to Apple — on the operator's word.

## What the operator or tester checks

- Intel Mac: x64 DMG opens without warnings, Tagma works, updates, Whisper answers at acceptable speed.
