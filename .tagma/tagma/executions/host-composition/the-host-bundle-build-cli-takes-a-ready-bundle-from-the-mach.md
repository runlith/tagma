---
id: 01a13f55-ee92-7f8b-9662-fdf33634462d
title: The host-bundle build CLI takes a ready bundle from the machine cache by hashing all inputs and clones it into the call directory
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13f55-a0e1-7a12-b89d-7e1585320461
sources:
  - kind: symbol
    ref: packages/execution-host/src/buildArtifact.ts
    symbol: cachedArtifact
---
CLI `buildArtifact.ts <dir> <label>` and the shared bundle test world call one `cachedArtifact`, so one closure is not rebuilt for every world. A cache refusal leaves them a normal build with a named reason.

- **Key** — sha256 over `src/**` (minus test files) and `drizzle/**` of the `@runlith/execution-host` prod closure along `workspace:` dependencies. `package.json`, `bunfig.toml`, `tsconfig*.json` and `jsconfig.json` are picked at the workspace root and its prod packages; `extends` chains are read recursively, including configurations outside the prod closure. A test report does not become a build input from its JSON extension alone. Additionally hashed: `bun.lock`, `patches/`, the native library and holder, the target platform and architecture, the runtime path, the Bun version and revision, and bundling options. File paths are workspace-relative, so plain worktrees share the record. An unresolvable configuration leaves a normal cacheless build.
- **The record is published** only if after the build the key matches the pre-build key and every bundler input sits in the hashed `src` or in `node_modules`. Otherwise the world gets the built bundle and the cache stays untouched: a neighbouring agent's edit mid-build never lands in the cache under someone else's key.
- **Place** — `userInfo().homedir`, not `HOME`: the test layer swaps `HOME` and `XDG_CACHE_HOME` for the run directory, and the cache would stop being shared.
- **Concurrency**: misses and prune go under one cache flock (`lock`, the file is never deleted). Publishing renames a finished `<key>.<pid>`, so nobody sees a partial record. Hits go lock-free and utimes before copying. Prune rechecks that a record is untouched for over an hour and outside the 16 newest, then moves it away by rename and only then deletes it. A prune error cancels the cache for that build, not the world: the world builds cacheless.
- **Layout into the world** copies the parts (clonefile on APFS), with the world's labelled `artifact.json` written last: an interrupted layout leaves no root that later gets rejected as already built. The digest does not depend on the label.
- CLI with `--inputs`, `--maps` or `--sign` goes direct. A `cachedArtifact` call with source maps, signing or plugins also builds cacheless: laying out ready parts produces no side results, and plugin code does not describe all its inputs.
